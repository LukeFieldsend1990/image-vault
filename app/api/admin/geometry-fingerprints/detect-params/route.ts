import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, and } from "drizzle-orm";

// GET /api/admin/geometry-fingerprints/detect-params?packageId=xxx&fileId=xxx
// Returns the data needed for client-side vertex extraction:
//   - per-fingerprint: hmacBytes (hex), fileId, bitLength, repeatFactor, originalVertexCount
// The client uses this to compute targetIndices, stream the suspect file locally,
// and extract only ~640 vertex positions — never uploading the full file.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const packageId = searchParams.get("packageId");
  const fileId = searchParams.get("fileId") || null;

  if (!packageId) {
    return NextResponse.json({ error: "packageId required" }, { status: 400 });
  }

  const db = getDb();

  const fps = await db
    .select({
      id: geometryFingerprints.id,
      fileId: geometryFingerprints.fileId,
      fingerprintBits: geometryFingerprints.fingerprintBits,
      fingerprintBitsLength: geometryFingerprints.fingerprintBitsLength,
      repeatFactor: geometryFingerprints.repeatFactor,
      originalR2Key: scanFiles.r2Key,
      originalSize: scanFiles.sizeBytes,
      originalFilename: scanFiles.filename,
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
    return NextResponse.json({ fingerprints: [], message: "No issued fingerprints found" });
  }

  // For each distinct file, count vertices from the original via R2 range reads
  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  const byFile = new Map<string, typeof fps[number]>();
  for (const fp of fps) {
    if (!byFile.has(fp.fileId)) byFile.set(fp.fileId, fp);
  }

  const vertexCounts: Record<string, number> = {};
  await Promise.all(
    [...byFile.entries()].map(async ([fid, fp]) => {
      vertexCounts[fid] = await streamCountVertices(bucket, fp.originalR2Key, fp.originalSize);
    }),
  );

  return NextResponse.json({
    fingerprints: fps.map((fp) => ({
      id: fp.id,
      fileId: fp.fileId,
      originalFilename: fp.originalFilename,
      fingerprintBits: fp.fingerprintBits,
      fingerprintBitsLength: fp.fingerprintBitsLength,
      repeatFactor: fp.repeatFactor,
      originalVertexCount: vertexCounts[fp.fileId] ?? 0,
    })),
  });
}

const RANGE_CHUNK = 32 * 1024 * 1024;
const DECODE_BATCH = 256 * 1024;

async function streamCountVertices(bucket: R2Bucket, r2Key: string, fileSize: number): Promise<number> {
  const decoder = new TextDecoder();
  let remainder = "", count = 0;
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
        if (t.startsWith("v ") || t.startsWith("v\t")) count++;
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  if (remainder.trimStart().match(/^v[\t ]/)) count++;
  return count;
}
