/**
 * Geo-Fingerprint Worker
 *
 * Queue consumer for `geo-fingerprint-jobs`. For each approved licence,
 * finds OBJ files in the package, embeds a unique geometric fingerprint
 * derived from licence/licensee IDs, and writes watermarked copies to R2.
 *
 * Originals are never modified. Watermarked copies are served on download.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, like } from "drizzle-orm";
import {
  licences,
  scanFiles,
  geometryFingerprintJobs,
  geometryFingerprints,
} from "./schema";
import { embedFingerprintStreaming } from "./geoFingerprint";

// R2 put() requires a known content-length for ReadableStream — use multipart upload instead.
// Parts must be ≥5 MB except the final part; 8 MB gives comfortable headroom.
const PART_SIZE = 8 * 1024 * 1024;

async function putStreamMultipart(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
  contentType: string,
): Promise<void> {
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });
  const parts: R2UploadedPart[] = [];
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let partNum = 1;

  const flushPart = async () => {
    if (chunks.length === 0) return;
    const buf = new Uint8Array(buffered);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    // CF Workers requires the readable half of a FixedLengthStream — a plain
    // Uint8Array or ReadableStream without a fixed length is rejected.
    const { readable, writable } = new FixedLengthStream(buf.byteLength);
    const w = writable.getWriter();
    await w.write(buf);
    await w.close();
    try {
      parts.push(await upload.uploadPart(partNum++, readable));
    } catch (err) {
      await upload.abort();
      throw err;
    }
    chunks.length = 0;
    buffered = 0;
  };

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value?.length) {
        chunks.push(value);
        buffered += value.length;
        if (buffered >= PART_SIZE) await flushPart();
      }
      if (done) { await flushPart(); break; }
    }
  } catch (err) {
    await upload.abort();
    throw err;
  }
  await upload.complete(parts);
}

interface Env {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  FINGERPRINT_SIGNING_KEY: string;
}

interface JobMessage {
  jobId: string;
}

export default {
  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    const db = drizzle(env.DB);

    for (const message of batch.messages) {
      const { jobId } = message.body;

      try {
        await processJob(db, env, jobId);
        message.ack();
      } catch (err) {
        console.error(`[geo-fingerprint] job ${jobId} failed:`, err);
        await db
          .update(geometryFingerprintJobs)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            completedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(geometryFingerprintJobs.id, jobId));
        message.ack(); // don't retry on hard failure
      }
    }
  },
};

async function processJob(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const [job] = await db
    .select()
    .from(geometryFingerprintJobs)
    .where(eq(geometryFingerprintJobs.id, jobId))
    .limit(1)
    .all();

  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "complete") { console.log(`[geo-fingerprint] job ${jobId} already complete, skipping`); return; }

  console.log(`[geo-fingerprint] job ${jobId} starting (licence ${job.licenceId})`);
  await db
    .update(geometryFingerprintJobs)
    .set({ status: "processing" })
    .where(eq(geometryFingerprintJobs.id, jobId));

  // Fetch licence details
  const [licence] = await db
    .select({ licenseeId: licences.licenseeId, fileScope: licences.fileScope })
    .from(licences)
    .where(eq(licences.id, job.licenceId))
    .limit(1)
    .all();

  if (!licence) throw new Error(`Licence ${job.licenceId} not found`);

  // Fetch OBJ files for this package
  const allFiles = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename, r2Key: scanFiles.r2Key })
    .from(scanFiles)
    .where(
      and(
        eq(scanFiles.packageId, job.packageId),
        eq(scanFiles.uploadStatus, "complete"),
      ),
    )
    .all();

  // Filter to OBJ files in scope
  const scopedIds: Set<string> | null =
    licence.fileScope === "all"
      ? null
      : new Set(JSON.parse(licence.fileScope) as string[]);

  const objFiles = allFiles.filter(
    (f) =>
      f.filename.toLowerCase().endsWith(".obj") &&
      (scopedIds === null || scopedIds.has(f.id)),
  );

  await db
    .update(geometryFingerprintJobs)
    .set({ filesTotal: objFiles.length })
    .where(eq(geometryFingerprintJobs.id, jobId));

  console.log(`[geo-fingerprint] found ${objFiles.length} OBJ files to process`);

  if (objFiles.length === 0) {
    await db
      .update(geometryFingerprintJobs)
      .set({ status: "complete", completedAt: now })
      .where(eq(geometryFingerprintJobs.id, jobId));
    return;
  }

  let filesDone = 0;

  for (const file of objFiles) {
    const fingerprintId = crypto.randomUUID();

    try {
      // Verify file exists before starting
      const probe = await env.SCANS_BUCKET.head(file.r2Key);
      if (!probe) {
        console.warn(`[geo-fingerprint] file ${file.id} not found in R2, skipping`);
        continue;
      }

      console.log(`[geo-fingerprint] [${file.filename}] pass 1 — counting vertices (size: ${probe.size} bytes)`);
      const t0 = Date.now();

      // Two-pass streaming embed: pass 1 counts vertices, pass 2 writes modified output
      const result = await embedFingerprintStreaming(
        async () => {
          const obj = await env.SCANS_BUCKET.get(file.r2Key);
          if (!obj) throw new Error(`File ${file.id} missing from R2`);
          return obj;
        },
        {
          licenceId: job.licenceId,
          licenseeId: licence.licenseeId,
          packageId: job.packageId,
          fileId: file.id,
        },
        env.FINGERPRINT_SIGNING_KEY,
      );

      console.log(`[geo-fingerprint] [${file.filename}] pass 1 done in ${Date.now() - t0}ms — ${result.vertexCount} vertices, ${result.regionCount} modified. pass 2 — writing watermarked OBJ`);
      const t1 = Date.now();

      // Write watermarked output via multipart upload (R2 put requires known length for streams)
      const watermarkedKey = `watermarks/${job.licenceId}/${file.id}.obj`;
      await putStreamMultipart(env.SCANS_BUCKET, watermarkedKey, result.outputStream, "application/obj");
      console.log(`[geo-fingerprint] [${file.filename}] pass 2 done in ${Date.now() - t1}ms — uploaded to ${watermarkedKey}`);

      // Record fingerprint
      await db.insert(geometryFingerprints).values({
        id: fingerprintId,
        jobId,
        licenceId: job.licenceId,
        fileId: file.id,
        packageId: job.packageId,
        licenseeId: licence.licenseeId,
        watermarkedR2Key: watermarkedKey,
        fingerprintPayloadHash: result.payloadHash,
        fingerprintBits: result.fingerprintBitsHex,
        fingerprintBitsLength: 128,
        repeatFactor: 5,
        watermarkStrength: 0.00001,
        watermarkRegionCount: result.regionCount,
        fingerprintVersion: 2,
        status: "ready",
        createdAt: now,
      });

      filesDone++;
      console.log(`[geo-fingerprint] [${file.filename}] done ✓ (${filesDone}/${objFiles.length}, total ${Date.now() - t0}ms)`);
      await db
        .update(geometryFingerprintJobs)
        .set({ filesDone })
        .where(eq(geometryFingerprintJobs.id, jobId));
    } catch (err) {
      console.error(`[geo-fingerprint] [${file.filename}] FAILED:`, err);
      // Record failed fingerprint row so we know it was attempted
      await db.insert(geometryFingerprints).values({
        id: fingerprintId,
        jobId,
        licenceId: job.licenceId,
        fileId: file.id,
        packageId: job.packageId,
        licenseeId: licence.licenseeId,
        watermarkedR2Key: "",
        fingerprintPayloadHash: "",
        fingerprintBits: "",
        fingerprintBitsLength: 128,
        repeatFactor: 5,
        watermarkStrength: 0.00001,
        fingerprintVersion: 1,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        createdAt: now,
      });
    }
  }

  await db
    .update(geometryFingerprintJobs)
    .set({ status: "complete", completedAt: now, filesDone })
    .where(eq(geometryFingerprintJobs.id, jobId));
  console.log(`[geo-fingerprint] job ${jobId} complete — ${filesDone}/${objFiles.length} files watermarked`);
}
