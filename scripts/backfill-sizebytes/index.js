// One-off backfill: corrects scan_files.size_bytes from actual R2 Content-Length.
//
// Background: before 2026-05-19 the upload/complete route wrote the client-declared
// size instead of the confirmed R2 size, causing false tamper_detected events from
// render bridge agents.
//
// Run (from this directory):
//   wrangler dev --remote
//   curl "http://localhost:8787"            # dry run
//   curl "http://localhost:8787?apply=true" # apply

const BATCH = 20; // concurrent R2 HEAD calls

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apply = url.searchParams.get("apply") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500"), 1000);

    const { results: rows } = await env.DB
      .prepare("SELECT id, filename, r2_key, size_bytes FROM scan_files WHERE upload_status = 'complete' LIMIT ?")
      .bind(limit)
      .all();

    const changes = [];
    const errors = [];
    let alreadyCorrect = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.all(
        rows.slice(i, i + BATCH).map(async (row) => {
          try {
            const head = await env.SCANS_BUCKET.head(row.r2_key);
            if (!head) {
              errors.push({ id: row.id, filename: row.filename, error: "not found in R2" });
              return;
            }
            if (head.size === row.size_bytes) {
              alreadyCorrect++;
              return;
            }
            changes.push({ id: row.id, filename: row.filename, old: row.size_bytes, new: head.size });
            if (apply) {
              await env.DB
                .prepare("UPDATE scan_files SET size_bytes = ? WHERE id = ?")
                .bind(head.size, row.id)
                .run();
            }
          } catch (err) {
            errors.push({ id: row.id, filename: row.filename, error: String(err) });
          }
        })
      );
    }

    return Response.json({
      dryRun: !apply,
      checked: rows.length,
      alreadyCorrect,
      needsUpdate: changes.length,
      updated: apply ? changes.length : 0,
      errors: errors.length,
      changes,
      errorDetails: errors,
    }, { headers: { "Content-Type": "application/json" } });
  },
};
