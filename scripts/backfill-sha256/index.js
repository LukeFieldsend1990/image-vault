// One-off backfill: populates scan_files.sha256 for completed files that
// predate server-side hashing at upload completion.
//
// Background: scan_files.sha256 used to be left null, so the render-bridge grant
// manifest carried no content hash and the bridge fell back to a size-only
// integrity check. The upload/complete route now computes the SHA-256 at
// completion; this backfills the rows uploaded before that change.
//
// Hashing streams the R2 object through crypto.DigestStream so large scans are
// never buffered in memory.
//
// Run (from this directory):
//   wrangler dev --remote
//   curl "http://localhost:8787"            # dry run
//   curl "http://localhost:8787?apply=true" # apply
//   curl "http://localhost:8787?apply=true&limit=200"

const BATCH = 8; // concurrent objects hashed at once (each streams a full file)

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256HexFromStream(stream) {
  const digestStream = new crypto.DigestStream("SHA-256");
  await stream.pipeTo(digestStream);
  return toHex(await digestStream.digest);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apply = url.searchParams.get("apply") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200"), 500);

    const { results: rows } = await env.DB
      .prepare(
        "SELECT id, filename, r2_key FROM scan_files WHERE upload_status = 'complete' AND (sha256 IS NULL OR sha256 = '') LIMIT ?"
      )
      .bind(limit)
      .all();

    const updated = [];
    const errors = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.all(
        rows.slice(i, i + BATCH).map(async (row) => {
          try {
            const obj = await env.SCANS_BUCKET.get(row.r2_key);
            if (!obj || !obj.body) {
              errors.push({ id: row.id, filename: row.filename, error: "not found in R2" });
              return;
            }
            const sha256 = await sha256HexFromStream(obj.body);
            updated.push({ id: row.id, filename: row.filename, sha256 });
            if (apply) {
              await env.DB
                .prepare("UPDATE scan_files SET sha256 = ? WHERE id = ?")
                .bind(sha256, row.id)
                .run();
            }
          } catch (err) {
            errors.push({ id: row.id, filename: row.filename, error: String(err) });
          }
        })
      );
    }

    return Response.json(
      {
        dryRun: !apply,
        checked: rows.length,
        hashed: updated.length,
        updated: apply ? updated.length : 0,
        errors: errors.length,
        sample: updated.slice(0, 20),
        errorDetails: errors,
      },
      { headers: { "Content-Type": "application/json" } }
    );
  },
};
