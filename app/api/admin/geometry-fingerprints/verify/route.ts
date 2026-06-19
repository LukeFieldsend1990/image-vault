import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { slotDirection } from "@/lib/geo-fingerprint/payload";
import { licences, scanPackages, users } from "@/lib/db/schema";

// POST /api/admin/geometry-fingerprints/verify
// Server-side streaming verification of a stored watermarked OBJ against its fingerprint.
// Both original and watermarked files are read from R2 using range reads — no file upload,
// no full-file buffering. Memory use: ~15 KB regardless of file size.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { fingerprintId?: string } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  if (!body.fingerprintId) {
    return NextResponse.json({ error: "fingerprintId required" }, { status: 400 });
  }

  const db = getDb();

  const fp = await db
    .select({
      id: geometryFingerprints.id,
      fileId: geometryFingerprints.fileId,
      licenceId: geometryFingerprints.licenceId,
      licenseeId: geometryFingerprints.licenseeId,
      packageId: geometryFingerprints.packageId,
      watermarkedR2Key: geometryFingerprints.watermarkedR2Key,
      fingerprintBits: geometryFingerprints.fingerprintBits,
      fingerprintBitsLength: geometryFingerprints.fingerprintBitsLength,
      repeatFactor: geometryFingerprints.repeatFactor,
      fingerprintPayloadHash: geometryFingerprints.fingerprintPayloadHash,
      createdAt: geometryFingerprints.createdAt,
      status: geometryFingerprints.status,
    })
    .from(geometryFingerprints)
    .where(eq(geometryFingerprints.id, body.fingerprintId))
    .get();

  if (!fp) return NextResponse.json({ error: "Fingerprint not found" }, { status: 404 });
  if (fp.status !== "ready") return NextResponse.json({ error: "Fingerprint not ready" }, { status: 409 });

  const file = await db
    .select({ r2Key: scanFiles.r2Key, sizeBytes: scanFiles.sizeBytes, filename: scanFiles.filename })
    .from(scanFiles)
    .where(eq(scanFiles.id, fp.fileId))
    .get();

  if (!file) return NextResponse.json({ error: "Source file not found" }, { status: 404 });

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  // Get watermarked file size
  const wmHead = await bucket.head(fp.watermarkedR2Key);
  if (!wmHead) return NextResponse.json({ error: "Watermarked file not found in R2" }, { status: 404 });

  // Reconstruct hmacBytes from stored bits hex (first 16 bytes = 128-bit fingerprint)
  const hmacBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    hmacBytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);
  }

  const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;

  // Pass 1: count vertices in original to determine selected indices
  const { vertexCount } = await streamCountVertices(bucket, file.r2Key, file.sizeBytes);

  if (vertexCount < 10) {
    return NextResponse.json({ error: "File has too few vertices" }, { status: 409 });
  }

  // Compute which vertex indices are needed
  const selectedVertices = selectVerticesFromHmac(hmacBytes, fp.fileId, vertexCount, slotCount);
  const targetIndices = new Set(selectedVertices);

  // Pass 2: collect those vertex positions from original and watermarked (in parallel)
  const [origPositions, wmPositions] = await Promise.all([
    streamCollectVertexPositions(bucket, file.r2Key, file.sizeBytes, targetIndices),
    streamCollectVertexPositions(bucket, fp.watermarkedR2Key, wmHead.size, targetIndices),
  ]);

  // Recover bits from displacements
  const expectedBits = bitsFromHex(fp.fingerprintBits, fp.fingerprintBitsLength);
  const extractedBits: boolean[] = new Array(slotCount).fill(false);

  for (let i = 0; i < slotCount; i++) {
    const vi = selectedVertices[i];
    const orig = origPositions.get(vi);
    const wm = wmPositions.get(vi);
    if (!orig || !wm) continue;
    const [dirX, dirY, dirZ] = slotDirection(hmacBytes, i);
    const dx = wm[0] - orig[0], dy = wm[1] - orig[1], dz = wm[2] - orig[2];
    extractedBits[i] = dx * dirX + dy * dirY + dz * dirZ > 0;
  }

  // Majority vote per logical bit
  let correctBits = 0;
  for (let j = 0; j < fp.fingerprintBitsLength; j++) {
    const start = j * fp.repeatFactor;
    let votes = 0;
    for (let k = 0; k < fp.repeatFactor; k++) votes += extractedBits[start + k] ? 1 : 0;
    if ((votes > fp.repeatFactor / 2) === expectedBits[j]) correctBits++;
  }

  const confidence = correctBits / fp.fingerprintBitsLength;
  const bitErrorRate = 1 - confidence;

  // Resolve human-readable payload fields
  const [licenceRow, licenseeRow, pkgRow] = await Promise.all([
    db.select({ projectName: licences.projectName, validFrom: licences.validFrom, validTo: licences.validTo })
      .from(licences).where(eq(licences.id, fp.licenceId)).get(),
    db.select({ email: users.email }).from(users).where(eq(users.id, fp.licenseeId)).get(),
    db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, fp.packageId)).get(),
  ]);

  function ts(unix: number | null | undefined): string | null {
    if (!unix) return null;
    return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  return NextResponse.json({
    ok: true,
    fingerprintId: fp.id,
    filename: file.filename,
    vertexCount,
    slotsChecked: slotCount,
    correctBits,
    totalBits: fp.fingerprintBitsLength,
    bitErrorRate: Math.round(bitErrorRate * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    verdict: confidence >= 0.95 ? "confirmed" : confidence >= 0.75 ? "likely" : "weak",
    // Decoded watermark payload — the exact data baked into the geometry
    encodedPayload: {
      fileId: fp.fileId,
      filename: file.filename,
      licenceId: fp.licenceId,
      projectName: licenceRow?.projectName ?? null,
      validFrom: ts(licenceRow?.validFrom),
      validTo: ts(licenceRow?.validTo),
      licenseeId: fp.licenseeId,
      licenseeEmail: licenseeRow?.email ?? null,
      packageId: fp.packageId,
      packageName: pkgRow?.name ?? null,
      payloadHash: fp.fingerprintPayloadHash,
      issuedAt: ts(fp.createdAt),
    },
  });
}

// ── Streaming helpers ─────────────────────────────────────────────────────────

const RANGE_CHUNK = 32 * 1024 * 1024;
const DECODE_BATCH = 256 * 1024;

async function streamCountVertices(
  bucket: R2Bucket, r2Key: string, fileSize: number,
): Promise<{ vertexCount: number }> {
  const decoder = new TextDecoder();
  let remainder = "", vertexCount = 0;
  for (let offset = 0; offset < fileSize; offset += RANGE_CHUNK) {
    const length = Math.min(RANGE_CHUNK, fileSize - offset);
    const isLast = offset + length >= fileSize;
    const obj = await bucket.get(r2Key, { range: { offset, length } });
    if (!obj) continue;
    const raw = new Uint8Array(await obj.arrayBuffer());
    for (let b = 0; b < raw.length; b += DECODE_BATCH) {
      const isLastBatch = isLast && b + DECODE_BATCH >= raw.length;
      const decoded = decoder.decode(raw.subarray(b, b + DECODE_BATCH), { stream: !isLastBatch });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const t = text.slice(start, nl).trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) vertexCount++;
        start = nl + 1;
      }
      remainder = text.slice(start);
      if (isLastBatch && remainder.trimStart().startsWith("v ")) vertexCount++;
    }
  }
  return { vertexCount };
}

async function streamCollectVertexPositions(
  bucket: R2Bucket, r2Key: string, fileSize: number,
  targetIndices: Set<number>,
): Promise<Map<number, [number, number, number]>> {
  const decoder = new TextDecoder();
  const positions = new Map<number, [number, number, number]>();
  let remainder = "", vertexIdx = 0;
  for (let offset = 0; offset < fileSize; offset += RANGE_CHUNK) {
    const length = Math.min(RANGE_CHUNK, fileSize - offset);
    const isLast = offset + length >= fileSize;
    const obj = await bucket.get(r2Key, { range: { offset, length } });
    if (!obj) continue;
    const raw = new Uint8Array(await obj.arrayBuffer());
    for (let b = 0; b < raw.length; b += DECODE_BATCH) {
      const isLastBatch = isLast && b + DECODE_BATCH >= raw.length;
      const decoded = decoder.decode(raw.subarray(b, b + DECODE_BATCH), { stream: !isLastBatch });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const line = text.slice(start, nl);
        const t = line.trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) {
          if (targetIndices.has(vertexIdx)) {
            const p = t.split(/\s+/);
            positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
          }
          vertexIdx++;
        }
        start = nl + 1;
      }
      remainder = text.slice(start);
      if (isLastBatch && remainder) {
        const t = remainder.trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) {
          if (targetIndices.has(vertexIdx)) {
            const p = t.split(/\s+/);
            positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
          }
        }
      }
    }
  }
  return positions;
}

// ── Deterministic vertex selection (mirrors worker implementation) ─────────────

function makeXorshift32(seed: number) {
  let s = (seed >>> 0) || 0x12345678;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function selectVerticesFromHmac(
  hmacBytes: Uint8Array, fileId: string, vertexCount: number, slotCount: number,
): number[] {
  let fileHash = 0;
  for (let i = 0; i < fileId.length; i++) fileHash = (Math.imul(fileHash, 31) + fileId.charCodeAt(i)) | 0;
  const hmacSeed = ((hmacBytes[0] << 24) | (hmacBytes[1] << 16) | (hmacBytes[2] << 8) | hmacBytes[3]) >>> 0;
  const seed = (hmacSeed ^ (fileHash >>> 0)) >>> 0;
  const rng = makeXorshift32(seed);
  return Array.from({ length: slotCount }, () => Math.floor(rng() * vertexCount));
}

function bitsFromHex(hex: string, bitLength: number): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < bitLength; i++) {
    const byteIdx = Math.floor(i / 8), bitIdx = 7 - (i % 8);
    bits.push(((parseInt(hex.slice(byteIdx * 2, byteIdx * 2 + 2), 16) >> bitIdx) & 1) === 1);
  }
  return bits;
}
