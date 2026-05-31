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
import { buildFingerprintMods } from "./geoFingerprint";

// R2 may return an entire large file (344 MB) as a single stream chunk, causing
// OOM when decoded to a JS string. Fix: use R2 Range reads to pull the file in
// RANGE_CHUNK slices — never more than ~8 MB in memory at once.
// Peak memory per iteration: 8 MB raw bytes + 8 MB decoded text + 8 MB part buffer
// + 8 MB FixedLengthStream ≈ 32 MB regardless of file size.
const RANGE_CHUNK = 8 * 1024 * 1024; // 8 MB per R2 range request
const PART_SIZE   = 8 * 1024 * 1024; // 8 MB per multipart part (≥5 MB required by R2)
const LINE_FLUSH  = 128 * 1024;       // flush lineOutput to part buffer every 128 KB

// ── Pass 1: count vertices + bbox using R2 Range reads ────────────────────────

async function countVerticesAndBbox(
  bucket: R2Bucket,
  r2Key: string,
  fileSize: number,
): Promise<{ vertexCount: number; diagonal: number }> {
  const decoder = new TextDecoder();
  let remainder = "";
  let vertexCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const processLine = (line: string) => {
    const t = line.trimStart();
    if (!t.startsWith("v ") && !t.startsWith("v\t")) return;
    const p = t.split(/\s+/);
    const x = parseFloat(p[1]), y = parseFloat(p[2]), z = parseFloat(p[3]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return;
    vertexCount++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };

  for (let offset = 0; offset < fileSize; offset += RANGE_CHUNK) {
    const length = Math.min(RANGE_CHUNK, fileSize - offset);
    const isLast = offset + length >= fileSize;
    const obj = await bucket.get(r2Key, { range: { offset, length } });
    if (!obj) throw new Error(`Range read failed at offset ${offset}`);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const decoded = decoder.decode(bytes, { stream: !isLast });
    const text = remainder + decoded;

    let start = 0, nl: number;
    while ((nl = text.indexOf("\n", start)) !== -1) {
      processLine(text.slice(start, nl));
      start = nl + 1;
    }
    remainder = text.slice(start);
    if (isLast && remainder) processLine(remainder);
  }

  if (vertexCount === 0) throw new Error("OBJ has no vertices");
  if (vertexCount < 10) throw new Error("OBJ has too few vertices for fingerprinting");
  const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1, dz = (maxZ - minZ) || 1;
  return { vertexCount, diagonal: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

// ── Pass 2: apply mods + multipart upload using R2 Range reads ────────────────

async function rangeModifyAndUpload(
  mods: Map<number, [number, number, number]>,
  bucket: R2Bucket,
  srcKey: string,
  fileSize: number,
  destKey: string,
  contentType: string,
): Promise<void> {
  const multipart = await bucket.createMultipartUpload(destKey, { httpMetadata: { contentType } });
  const uploadedParts: R2UploadedPart[] = [];

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let remainder = "";
  let vertexIdx = 0;
  let partNum = 1;
  let partChunks: Uint8Array[] = [];
  let partBuffered = 0;

  const flushPart = async () => {
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
    console.log(`[geo-fingerprint] uploaded part ${partNum - 1} (${buf.byteLength} bytes)`);
  };

  const pushOutput = async (text: string) => {
    const encoded = encoder.encode(text);
    partChunks.push(encoded);
    partBuffered += encoded.length;
    if (partBuffered >= PART_SIZE) await flushPart();
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
    for (let offset = 0; offset < fileSize; offset += RANGE_CHUNK) {
      const length = Math.min(RANGE_CHUNK, fileSize - offset);
      const isLast = offset + length >= fileSize;
      const obj = await bucket.get(srcKey, { range: { offset, length } });
      if (!obj) throw new Error(`Range read failed at offset ${offset}`);
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const decoded = decoder.decode(bytes, { stream: !isLast });
      const text = remainder + decoded;

      let start = 0, nl: number;
      let lineOutput = "";
      while ((nl = text.indexOf("\n", start)) !== -1) {
        lineOutput += processLine(text.slice(start, nl)) + "\n";
        start = nl + 1;
        if (lineOutput.length >= LINE_FLUSH) { await pushOutput(lineOutput); lineOutput = ""; }
      }
      remainder = text.slice(start);

      if (isLast && remainder) { lineOutput += processLine(remainder); remainder = ""; }
      if (lineOutput) await pushOutput(lineOutput);
    }
    await flushPart();
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

      const fileSize = probe.size;
      console.log(`[geo-fingerprint] [${file.filename}] pass 1 — counting vertices (size: ${fileSize} bytes, chunks: ${Math.ceil(fileSize / RANGE_CHUNK)})`);
      const t0 = Date.now();

      const { vertexCount, diagonal } = await countVerticesAndBbox(env.SCANS_BUCKET, file.r2Key, fileSize);
      const result = await buildFingerprintMods(vertexCount, diagonal, {
        licenceId: job.licenceId,
        licenseeId: licence.licenseeId,
        packageId: job.packageId,
        fileId: file.id,
      }, env.FINGERPRINT_SIGNING_KEY);

      console.log(`[geo-fingerprint] [${file.filename}] pass 1 done in ${Date.now() - t0}ms — ${result.vertexCount} vertices, ${result.regionCount} modified. pass 2 — writing watermarked OBJ`);
      const t1 = Date.now();

      const watermarkedKey = `watermarks/${job.licenceId}/${file.id}.obj`;
      await rangeModifyAndUpload(result.mods, env.SCANS_BUCKET, file.r2Key, fileSize, watermarkedKey, "application/obj");
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
