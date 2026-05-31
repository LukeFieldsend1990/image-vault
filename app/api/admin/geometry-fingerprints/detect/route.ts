export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles, users, licences, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq, and, inArray } from "drizzle-orm";
import { slotDirection } from "@/lib/geo-fingerprint/payload";

// POST /api/admin/geometry-fingerprints/detect?packageId=xxx&fileId=xxx
// Body: raw OBJ file bytes (Content-Type: application/octet-stream)
//
// Streams the uploaded suspect file in a single pass without buffering it.
// Uses the original file's vertex count (from R2 range reads) to determine
// which ~640 vertex indices to collect — memory is O(640 positions) regardless
// of file size.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const packageId = searchParams.get("packageId");
  const fileId = searchParams.get("fileId") || null;

  if (!packageId) {
    return NextResponse.json({ error: "packageId query param required" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "Request body (OBJ file) required" }, { status: 400 });
  }

  const db = getDb();

  // Find all ready fingerprints for this package (optionally filtered to a file)
  const fps = await db
    .select({
      id: geometryFingerprints.id,
      licenceId: geometryFingerprints.licenceId,
      licenseeId: geometryFingerprints.licenseeId,
      fileId: geometryFingerprints.fileId,
      fingerprintBits: geometryFingerprints.fingerprintBits,
      fingerprintBitsLength: geometryFingerprints.fingerprintBitsLength,
      repeatFactor: geometryFingerprints.repeatFactor,
      originalR2Key: scanFiles.r2Key,
      originalFilename: scanFiles.filename,
      originalSize: scanFiles.sizeBytes,
    })
    .from(geometryFingerprints)
    .innerJoin(scanFiles, eq(scanFiles.id, geometryFingerprints.fileId))
    .where(
      and(
        eq(geometryFingerprints.packageId, packageId),
        eq(geometryFingerprints.status, "ready"),
        ...(fileId ? [eq(geometryFingerprints.fileId, fileId)] : []),
      ),
    )
    .all();

  if (fps.length === 0) {
    return NextResponse.json({ ok: true, packageId, matches: [], message: "No issued fingerprints found" });
  }

  const { env } = getRequestContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  // Group by fileId — we compare the suspect against each distinct original
  const byFile = new Map<string, typeof fps[number][]>();
  for (const fp of fps) {
    if (!byFile.has(fp.fileId)) byFile.set(fp.fileId, []);
    byFile.get(fp.fileId)!.push(fp);
  }

  // For the first (or only) file group, get original vertex count
  // If checking multiple files, we assume vertex counts match across all — take first
  const firstGroup = [...byFile.values()][0];
  const { vertexCount } = await streamCountVertices(bucket, firstGroup[0].originalR2Key, firstGroup[0].originalSize);

  // Build the union of all selected vertex indices across all fingerprints
  const allHmacBytes = fps.map((fp) => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);
    return { fp, hmacBytes: bytes };
  });

  const targetIndices = new Set<number>();
  for (const { fp, hmacBytes } of allHmacBytes) {
    const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
    for (const vi of selectVerticesFromHmac(hmacBytes, fp.fileId, vertexCount, slotCount)) {
      targetIndices.add(vi);
    }
  }

  // Stream the suspect file (request body) once, collecting positions at target indices
  const suspectPositions = await streamCollectFromRequest(req.body, targetIndices);

  // For each file group, also collect original positions and compare
  type Match = {
    fingerprintId: string; licenceId: string; licenseeId: string;
    fileId: string; originalFilename: string;
    confidence: number; bitsRecovered: number; bitsExpected: number;
    bitErrorRate: number; evidenceSummary: string;
  };
  const allMatches: Match[] = [];

  for (const [fid, fileFps] of byFile) {
    const { originalR2Key, originalSize, originalFilename } = fileFps[0];
    const origPositions = await streamCollectVertexPositions(bucket, originalR2Key, originalSize, targetIndices);

    for (const fp of fileFps) {
      const hmacBytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) hmacBytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);

      const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
      const selectedVertices = selectVerticesFromHmac(hmacBytes, fp.fileId, vertexCount, slotCount);
      const expectedBits = bitsFromHex(fp.fingerprintBits, fp.fingerprintBitsLength);
      const extractedBits: boolean[] = new Array(slotCount).fill(false);

      for (let i = 0; i < slotCount; i++) {
        const vi = selectedVertices[i];
        const orig = origPositions.get(vi);
        const susp = suspectPositions.get(vi);
        if (!orig || !susp) continue;
        const [dirX, dirY, dirZ] = slotDirection(hmacBytes, i);
        extractedBits[i] = (susp[0] - orig[0]) * dirX + (susp[1] - orig[1]) * dirY + (susp[2] - orig[2]) * dirZ > 0;
      }

      let correctBits = 0;
      for (let j = 0; j < fp.fingerprintBitsLength; j++) {
        const start = j * fp.repeatFactor;
        let votes = 0;
        for (let k = 0; k < fp.repeatFactor; k++) votes += extractedBits[start + k] ? 1 : 0;
        if ((votes > fp.repeatFactor / 2) === expectedBits[j]) correctBits++;
      }

      const confidence = correctBits / fp.fingerprintBitsLength;
      if (confidence < 0.6) continue;

      allMatches.push({
        fingerprintId: fp.id,
        licenceId: fp.licenceId,
        licenseeId: fp.licenseeId,
        fileId: fid,
        originalFilename,
        confidence,
        bitsRecovered: correctBits,
        bitsExpected: fp.fingerprintBitsLength,
        bitErrorRate: 1 - confidence,
        evidenceSummary: confidence >= 0.9
          ? `Strong match — ${fp.licenceId}`
          : confidence >= 0.75
          ? `Possible match — manual review advised`
          : `Weak signal`,
      });
    }
  }

  allMatches.sort((a, b) => b.confidence - a.confidence);

  // Enrich with licensee emails + licence details
  const licenceIds = [...new Set(allMatches.map((m) => m.licenceId))];
  const licenseeIds = [...new Set(allMatches.map((m) => m.licenseeId))];

  const [licenceRows, licenseeUsers, pkgRow] = await Promise.all([
    licenceIds.length > 0
      ? db.select({ id: licences.id, projectName: licences.projectName, validFrom: licences.validFrom, validTo: licences.validTo })
          .from(licences).where(inArray(licences.id, licenceIds)).all()
      : Promise.resolve([]),
    licenseeIds.length > 0
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, licenseeIds)).all()
      : Promise.resolve([]),
    db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, packageId)).get(),
  ]);

  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));
  const emailMap = new Map(licenseeUsers.map((u) => [u.id, u.email]));

  function ts(unix: number | null): string | null {
    if (!unix) return null;
    return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  const enriched = allMatches.map((m) => {
    const lic = licenceMap.get(m.licenceId);
    return {
      ...m,
      licenseeEmail: emailMap.get(m.licenseeId) ?? null,
      projectName: lic?.projectName ?? null,
      validFrom: ts(lic?.validFrom ?? null),
      validTo: ts(lic?.validTo ?? null),
    };
  });

  return NextResponse.json({
    ok: true,
    packageId,
    packageName: pkgRow?.name ?? packageId,
    fileId: fileId ?? null,
    vertexCount,
    fingerprintsChecked: fps.length,
    matches: enriched,
    message: enriched.length === 0 ? "No fingerprint matched above threshold" : undefined,
  });
}

// ── Streaming helpers ─────────────────────────────────────────────────────────

const RANGE_CHUNK = 32 * 1024 * 1024;
const DECODE_BATCH = 256 * 1024;

async function streamCountVertices(bucket: R2Bucket, r2Key: string, fileSize: number): Promise<{ vertexCount: number }> {
  const decoder = new TextDecoder();
  let remainder = "", vertexCount = 0;
  for (let offset = 0; offset < fileSize; offset += RANGE_CHUNK) {
    const length = Math.min(RANGE_CHUNK, fileSize - offset);
    const isLast = offset + length >= fileSize;
    const obj = await bucket.get(r2Key, { range: { offset, length } });
    if (!obj) continue;
    const raw = new Uint8Array(await obj.arrayBuffer());
    for (let b = 0; b < raw.length; b += DECODE_BATCH) {
      const decoded = decoder.decode(raw.subarray(b, b + DECODE_BATCH), { stream: !(isLast && b + DECODE_BATCH >= raw.length) });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const t = text.slice(start, nl).trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) vertexCount++;
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  if (remainder.trimStart().match(/^v[\t ]/)) vertexCount++;
  return { vertexCount };
}

async function streamCollectVertexPositions(
  bucket: R2Bucket, r2Key: string, fileSize: number, targetIndices: Set<number>,
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
      const decoded = decoder.decode(raw.subarray(b, b + DECODE_BATCH), { stream: !(isLast && b + DECODE_BATCH >= raw.length) });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const t = text.slice(start, nl).trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) {
          if (targetIndices.has(vertexIdx)) { const p = t.split(/\s+/); positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); }
          vertexIdx++;
        }
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  if (remainder) { const t = remainder.trimStart(); if ((t.startsWith("v ") || t.startsWith("v\t")) && targetIndices.has(vertexIdx)) { const p = t.split(/\s+/); positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); } }
  return positions;
}

// Stream the uploaded request body directly — no buffering, single pass
async function streamCollectFromRequest(
  body: ReadableStream<Uint8Array>, targetIndices: Set<number>,
): Promise<Map<number, [number, number, number]>> {
  const decoder = new TextDecoder();
  const positions = new Map<number, [number, number, number]>();
  const reader = body.getReader();
  let remainder = "", vertexIdx = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Decode in 256 KB batches to avoid large string allocation
    for (let b = 0; b < value.length; b += DECODE_BATCH) {
      const decoded = decoder.decode(value.subarray(b, b + DECODE_BATCH), { stream: true });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const t = text.slice(start, nl).trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) {
          if (targetIndices.has(vertexIdx)) { const p = t.split(/\s+/); positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); }
          vertexIdx++;
        }
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  decoder.decode(undefined, { stream: false }); // flush
  if (remainder) { const t = remainder.trimStart(); if ((t.startsWith("v ") || t.startsWith("v\t")) && targetIndices.has(vertexIdx)) { const p = t.split(/\s+/); positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); } }
  return positions;
}

// ── Fingerprint helpers ───────────────────────────────────────────────────────

function makeXorshift32(seed: number) {
  let s = (seed >>> 0) || 0x12345678;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function selectVerticesFromHmac(hmacBytes: Uint8Array, fileId: string, vertexCount: number, slotCount: number): number[] {
  let fileHash = 0;
  for (let i = 0; i < fileId.length; i++) fileHash = (Math.imul(fileHash, 31) + fileId.charCodeAt(i)) | 0;
  const hmacSeed = ((hmacBytes[0] << 24) | (hmacBytes[1] << 16) | (hmacBytes[2] << 8) | hmacBytes[3]) >>> 0;
  const rng = makeXorshift32(((hmacSeed ^ (fileHash >>> 0)) >>> 0));
  return Array.from({ length: slotCount }, () => Math.floor(rng() * vertexCount));
}

function bitsFromHex(hex: string, bitLength: number): boolean[] {
  return Array.from({ length: bitLength }, (_, i) => {
    const byteIdx = Math.floor(i / 8), bitIdx = 7 - (i % 8);
    return ((parseInt(hex.slice(byteIdx * 2, byteIdx * 2 + 2), 16) >> bitIdx) & 1) === 1;
  });
}
