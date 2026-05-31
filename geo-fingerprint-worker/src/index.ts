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
const RANGE_CHUNK  = 32 * 1024 * 1024; // 32 MB per R2 range request.
                                        // 8 MB OOMed due to FixedLengthStream copying buf; that's
                                        // fixed now (direct Uint8Array uploadPart). 32 MB keeps
                                        // subrequest count under 1000 for 3 GB files: ~97 reads
                                        // per pass + ~390 uploadPart = ~580 per file.
const DECODE_BATCH = 256 * 1024;       // decode raw bytes in 256 KB slices (avoids 32 MB JS string)
const PART_SIZE    = 8 * 1024 * 1024;  // 8 MB per multipart part (≥5 MB required by R2)
const LINE_FLUSH   = 128 * 1024;       // flush lineOutput to part buffer every 128 KB

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
    const rawBytes = new Uint8Array(await obj.arrayBuffer());

    // Decode in 256 KB sub-batches: rawBytes (32 MB Uint8Array) stays compact;
    // decoded string is at most 256 KB at any time.
    for (let b = 0; b < rawBytes.length; b += DECODE_BATCH) {
      const isLastBatch = isLast && b + DECODE_BATCH >= rawBytes.length;
      const slice = rawBytes.subarray(b, b + DECODE_BATCH);
      const decoded = decoder.decode(slice, { stream: !isLastBatch });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        processLine(text.slice(start, nl));
        start = nl + 1;
      }
      remainder = text.slice(start);
      if (isLastBatch && remainder) { processLine(remainder); remainder = ""; }
    }
  }

  if (vertexCount === 0) throw new Error("OBJ has no vertices");
  if (vertexCount < 10) throw new Error("OBJ has too few vertices for fingerprinting");
  const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1, dz = (maxZ - minZ) || 1;
  return { vertexCount, diagonal: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

// ── Pass 2: apply mods + multipart upload using R2 Range reads ────────────────
// Supports resuming a previously interrupted upload via chkpt/saveChkpt.

interface Pass2Checkpoint {
  fileId: string;
  watermarkedKey: string;
  uploadId: string;
  nextByteOffset: number;
  partNum: number;
  partFilled: number; // bytes in the partial partBuf (stored separately in R2)
  vertexIdx: number;
  remainder: string;  // partial last line from the previous chunk
  parts: { partNumber: number; etag: string }[];
}

async function rangeModifyAndUpload(
  mods: Map<number, [number, number, number]>,
  bucket: R2Bucket,
  srcKey: string,
  fileSize: number,
  destKey: string,
  contentType: string,
  chkpt?: Pass2Checkpoint,
  saveChkpt?: (c: Pass2Checkpoint) => Promise<void>,
): Promise<void> {
  const chkBufKey = `${destKey}.chkbuf`;

  // Create or resume the multipart upload
  const multipart = chkpt
    ? bucket.resumeMultipartUpload(destKey, chkpt.uploadId)
    : await bucket.createMultipartUpload(destKey, { httpMetadata: { contentType } });
  console.log(`[geo-fingerprint] pass2 ${chkpt ? `resuming uploadId=${chkpt.uploadId} from byte=${chkpt.nextByteOffset}` : `created upload, chunks=${Math.ceil(fileSize / RANGE_CHUNK)}`}`);

  const uploadedParts: R2UploadedPart[] = chkpt
    ? chkpt.parts.map(p => ({ partNumber: p.partNumber, etag: p.etag })) as R2UploadedPart[]
    : [];

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let remainder = chkpt?.remainder ?? "";
  let vertexIdx = chkpt?.vertexIdx ?? 0;
  let partNum = chkpt?.partNum ?? 1;
  const startOffset = chkpt?.nextByteOffset ?? 0;

  let partBuf = new Uint8Array(PART_SIZE);
  let partFilled = 0;

  // Restore partial partBuf from R2 checkpoint buffer
  if (chkpt?.partFilled) {
    const chkBufObj = await bucket.get(chkBufKey);
    if (chkBufObj) {
      const bytes = new Uint8Array(await chkBufObj.arrayBuffer());
      partBuf.set(bytes, 0);
      partFilled = chkpt.partFilled;
      console.log(`[geo-fingerprint] restored ${partFilled} bytes from checkpoint buffer`);
    }
  }

  const feedBytes = async (encoded: Uint8Array) => {
    let off = 0;
    while (off < encoded.length) {
      const take = Math.min(encoded.length - off, PART_SIZE - partFilled);
      partBuf.set(encoded.subarray(off, off + take), partFilled);
      partFilled += take;
      off += take;
      if (partFilled === PART_SIZE) {
        console.log(`[geo-fingerprint] uploading part ${partNum} (${PART_SIZE} bytes)`);
        uploadedParts.push(await multipart.uploadPart(partNum++, partBuf));
        console.log(`[geo-fingerprint] part ${partNum - 1} ok`);
        partBuf = new Uint8Array(PART_SIZE);
        partFilled = 0;
      }
    }
  };

  const pushOutput = async (text: string) => { await feedBytes(encoder.encode(text)); };

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
    for (let offset = startOffset; offset < fileSize; offset += RANGE_CHUNK) {
      const length = Math.min(RANGE_CHUNK, fileSize - offset);
      const isLast = offset + length >= fileSize;
      console.log(`[geo-fingerprint] pass2 range offset=${offset} loading...`);
      const obj = await bucket.get(srcKey, { range: { offset, length } });
      if (!obj) throw new Error(`Range read failed at offset ${offset}`);
      const rawBytes = new Uint8Array(await obj.arrayBuffer());
      console.log(`[geo-fingerprint] pass2 range loaded ${rawBytes.length} bytes, decoding in ${Math.ceil(rawBytes.length / DECODE_BATCH)} sub-batches`);

      const totalBatches = Math.ceil(rawBytes.length / DECODE_BATCH);
      for (let b = 0; b < rawBytes.length; b += DECODE_BATCH) {
        const batchIdx = b / DECODE_BATCH;
        const isLastBatch = isLast && b + DECODE_BATCH >= rawBytes.length;
        const slice = rawBytes.subarray(b, b + DECODE_BATCH);
        try {
          const decoded = decoder.decode(slice, { stream: !isLastBatch });
          const text = remainder + decoded;
          let start = 0, nl: number, lineOutput = "", lineCount = 0;
          while ((nl = text.indexOf("\n", start)) !== -1) {
            lineOutput += processLine(text.slice(start, nl)) + "\n";
            start = nl + 1;
            lineCount++;
            if (lineOutput.length >= LINE_FLUSH) { await pushOutput(lineOutput); lineOutput = ""; }
          }
          remainder = text.slice(start);
          if (isLastBatch && remainder) { lineOutput += processLine(remainder); remainder = ""; }
          if (lineOutput) await pushOutput(lineOutput);
          if (batchIdx === 0 || batchIdx === totalBatches - 1) {
            console.log(`[geo-fingerprint] sub-batch ${batchIdx}/${totalBatches} ok — ${lineCount} lines, partFilled=${partFilled}`);
          }
        } catch (subErr) {
          console.error(`[geo-fingerprint] CRASH in sub-batch ${batchIdx}: ${subErr instanceof Error ? subErr.message : String(subErr)}`);
          throw subErr;
        }
      }
      console.log(`[geo-fingerprint] pass2 range offset=${offset} done`);

      // Save checkpoint after each range chunk so the next invocation can resume here.
      // The partial partBuf is stored separately in R2 (too large for a JSON column).
      if (saveChkpt) {
        if (partFilled > 0) {
          await bucket.put(chkBufKey, partBuf.subarray(0, partFilled));
        }
        await saveChkpt({
          fileId: "", // caller fills this in
          watermarkedKey: destKey,
          uploadId: multipart.uploadId,
          nextByteOffset: offset + length,
          partNum,
          partFilled,
          vertexIdx,
          remainder,
          parts: uploadedParts.map(p => ({ partNumber: p.partNumber, etag: p.etag })),
        });
      }
    }

    if (partFilled > 0) {
      const lastBuf = partBuf.subarray(0, partFilled);
      console.log(`[geo-fingerprint] uploading final part ${partNum} (${lastBuf.byteLength} bytes)`);
      uploadedParts.push(await multipart.uploadPart(partNum++, lastBuf));
    }
    // Clean up checkpoint buffer
    await bucket.delete(chkBufKey).catch(() => {});
  } catch (err) {
    await multipart.abort();
    throw err;
  }

  await multipart.complete(uploadedParts);
  console.log(`[geo-fingerprint] multipart complete: ${uploadedParts.length} parts`);
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
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[geo-fingerprint] job ${jobId} CAUGHT ERROR: ${errMsg}`);
        try {
          await db
            .update(geometryFingerprintJobs)
            .set({ status: "failed", error: errMsg, completedAt: Math.floor(Date.now() / 1000) })
            .where(eq(geometryFingerprintJobs.id, jobId));
        } catch (dbErr) {
          console.error(`[geo-fingerprint] DB update failed: ${dbErr}`);
        }
        message.ack();
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

  // Start from persisted progress — don't re-do files that already succeeded.
  let filesDone = job.filesDone;

  for (const file of objFiles) {
    // Skip files that already have a ready fingerprint from a previous run.
    // This prevents re-processing LR/MR (390+ R2 ops) on every HR retry,
    // which was causing cumulative runtime memory to exceed 128 MB.
    const alreadyDone = await db
      .select({ id: geometryFingerprints.id })
      .from(geometryFingerprints)
      .where(
        and(
          eq(geometryFingerprints.jobId, jobId),
          eq(geometryFingerprints.fileId, file.id),
          eq(geometryFingerprints.status, "ready"),
        ),
      )
      .get();
    if (alreadyDone) {
      console.log(`[geo-fingerprint] [${file.filename}] already fingerprinted — skipping`);
      continue;
    }

    const fingerprintId = crypto.randomUUID();

    try {
      // Verify file exists before starting
      const probe = await env.SCANS_BUCKET.head(file.r2Key);
      if (!probe) {
        console.warn(`[geo-fingerprint] file ${file.id} not found in R2, skipping`);
        continue;
      }

      const fileSize = probe.size;
      console.log(`[geo-fingerprint] [${file.filename}] pass 1 — counting vertices (size: ${fileSize} bytes, chunks: ${Math.ceil(fileSize / RANGE_CHUNK)}, chunkSize: ${RANGE_CHUNK})`);
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

      // Load checkpoint if this file was partially processed in a previous invocation
      const watermarkedKey = `watermarks/${job.licenceId}/${file.id}.obj`;
      let chkpt: Pass2Checkpoint | undefined;
      if (job.fileCheckpointJson) {
        try {
          const parsed = JSON.parse(job.fileCheckpointJson) as Pass2Checkpoint;
          if (parsed.fileId === file.id && parsed.uploadId) {
            chkpt = parsed;
            console.log(`[geo-fingerprint] [${file.filename}] checkpoint found — resuming from byte ${chkpt.nextByteOffset}, part ${chkpt.partNum} (${chkpt.parts.length} parts already uploaded)`);
          }
        } catch { /* invalid checkpoint, start fresh */ }
      }

      await rangeModifyAndUpload(
        result.mods, env.SCANS_BUCKET, file.r2Key, fileSize, watermarkedKey, "application/obj",
        chkpt,
        async (c) => {
          const saved = JSON.stringify({ ...c, fileId: file.id });
          await db.update(geometryFingerprintJobs)
            .set({ fileCheckpointJson: saved })
            .where(eq(geometryFingerprintJobs.id, jobId));
        },
      );
      console.log(`[geo-fingerprint] [${file.filename}] pass 2 done in ${Date.now() - t1}ms — uploaded to ${watermarkedKey}`);

      // Clear checkpoint on success
      await db.update(geometryFingerprintJobs)
        .set({ fileCheckpointJson: null })
        .where(eq(geometryFingerprintJobs.id, jobId));

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
