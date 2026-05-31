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
import { computeFingerprintMods } from "./geoFingerprint";

// Pass 2 + multipart upload in a single streaming loop.
//
// Processes the R2 stream line-by-line using indexOf("\n") rather than
// split("\n") — this avoids materialising a million-element string array
// for large OBJ files, which was causing OOM crashes in pass 2.
//
// Output is buffered into 8 MB parts (well above R2's 5 MB minimum) and
// each part is wrapped in FixedLengthStream, which CF Workers requires for
// multipart uploadPart bodies.
const PART_SIZE = 8 * 1024 * 1024; // 8 MB per part
const LINE_FLUSH = 128 * 1024;      // encode output text every 128 KB

async function streamModifyAndUpload(
  inputStream: ReadableStream<Uint8Array>,
  mods: Map<number, [number, number, number]>,
  bucket: R2Bucket,
  key: string,
  contentType: string,
): Promise<void> {
  const multipart = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
  const uploadedParts: R2UploadedPart[] = [];

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = inputStream.getReader();

  let remainder = "";
  let vertexIdx = 0;
  let partNum = 1;
  let partChunks: Uint8Array[] = [];
  let partBuffered = 0;

  const uploadPart = async () => {
    if (partChunks.length === 0) return;
    const buf = new Uint8Array(partBuffered);
    let off = 0;
    for (const c of partChunks) { buf.set(c, off); off += c.length; }
    partChunks = [];
    partBuffered = 0;
    const { readable, writable } = new FixedLengthStream(buf.byteLength);
    const w = writable.getWriter();
    await w.write(buf);
    await w.close();
    uploadedParts.push(await multipart.uploadPart(partNum++, readable));
  };

  const pushOutput = async (text: string) => {
    const encoded = encoder.encode(text);
    partChunks.push(encoded);
    partBuffered += encoded.length;
    if (partBuffered >= PART_SIZE) await uploadPart();
  };

  const processLine = (line: string): string => {
    const t = line.trimStart();
    if (t.startsWith("v ") || t.startsWith("v\t")) {
      const idx = vertexIdx++;
      const mod = mods.get(idx);
      if (mod) {
        const p = t.split(/\s+/);
        const x = parseFloat(p[1]) + mod[0];
        const y = parseFloat(p[2]) + mod[1];
        const z = parseFloat(p[3]) + mod[2];
        return `v ${x.toFixed(8)} ${y.toFixed(8)} ${z.toFixed(8)}`;
      }
      return line;
    }
    return line;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      const text = remainder + decoder.decode(value, { stream: !done });

      // Process one line at a time — indexOf avoids split() materialising
      // a ~1M-element array for large files, keeping memory bounded.
      let start = 0;
      let lineOutput = "";

      let nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        lineOutput += processLine(text.slice(start, nl)) + "\n";
        start = nl + 1;
        if (lineOutput.length >= LINE_FLUSH) {
          await pushOutput(lineOutput);
          lineOutput = "";
        }
      }

      remainder = text.slice(start);

      // On the final chunk, flush the last (possibly newline-less) line
      if (done && remainder) {
        lineOutput += processLine(remainder);
        remainder = "";
      }

      if (lineOutput) await pushOutput(lineOutput);
      if (done) { await uploadPart(); break; }
    }
  } catch (err) {
    await multipart.abort();
    throw err;
  }

  await multipart.complete(uploadedParts);
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
      const getBucket = async () => {
        const obj = await env.SCANS_BUCKET.get(file.r2Key);
        if (!obj) throw new Error(`File ${file.id} missing from R2`);
        return obj;
      };

      const result = await computeFingerprintMods(
        getBucket,
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

      const watermarkedKey = `watermarks/${job.licenceId}/${file.id}.obj`;
      const obj2 = await env.SCANS_BUCKET.get(file.r2Key);
      if (!obj2) throw new Error(`File ${file.id} missing from R2 on pass 2`);
      await streamModifyAndUpload(obj2.body, result.mods, env.SCANS_BUCKET, watermarkedKey, "application/obj");
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
