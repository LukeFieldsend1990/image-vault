export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles, users, licences, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq, and, inArray } from "drizzle-orm";
import { slotDirection } from "@/lib/geo-fingerprint/payload";

// POST /api/admin/geometry-fingerprints/detect-compare
// Body: { packageId, fileId?, suspectVertexCount, suspectPositions: { [idx]: [x,y,z] } }
// The client extracts ~640 vertex positions locally and sends them here.
// This endpoint loads the originals' same positions from R2 and computes confidence.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    packageId?: string;
    fileId?: string;
    suspectVertexCount?: number;
    suspectPositions?: Record<string, [number, number, number]>;
  } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  const { packageId, fileId = null, suspectVertexCount, suspectPositions } = body;

  if (!packageId || !suspectVertexCount || !suspectPositions) {
    return NextResponse.json({ error: "packageId, suspectVertexCount, suspectPositions required" }, { status: 400 });
  }

  const suspectMap = new Map<number, [number, number, number]>(
    Object.entries(suspectPositions).map(([k, v]) => [parseInt(k), v]),
  );

  const db = getDb();
  const fps = await db
    .select({
      id: geometryFingerprints.id,
      licenceId: geometryFingerprints.licenceId,
      licenseeId: geometryFingerprints.licenseeId,
      fileId: geometryFingerprints.fileId,
      packageId: geometryFingerprints.packageId,
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
    return NextResponse.json({ ok: true, packageId, matches: [], message: "No issued fingerprints found" });
  }

  const { env } = getRequestContext();
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  // Collect all needed vertex indices across all fingerprints
  const allHmac = fps.map((fp) => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);
    return { fp, hmacBytes: bytes };
  });

  const targetIndices = new Set<number>();
  for (const { fp, hmacBytes } of allHmac) {
    for (const vi of selectVertices(hmacBytes, fp.fileId, suspectVertexCount, fp.fingerprintBitsLength * fp.repeatFactor)) {
      targetIndices.add(vi);
    }
  }

  // Collect original positions from R2 (one pass per distinct file)
  const byFile = new Map<string, typeof fps[number]>();
  for (const fp of fps) if (!byFile.has(fp.fileId)) byFile.set(fp.fileId, fp);

  const origPositionsByFile = new Map<string, Map<number, [number, number, number]>>();
  await Promise.all([...byFile.entries()].map(async ([fid, fp]) => {
    origPositionsByFile.set(fid, await streamCollectPositions(bucket, fp.originalR2Key, fp.originalSize, targetIndices));
  }));

  type Match = {
    fingerprintId: string; licenceId: string; licenseeId: string; fileId: string;
    originalFilename: string; confidence: number; bitsRecovered: number;
    bitsExpected: number; bitErrorRate: number; evidenceSummary: string;
  };
  const allMatches: Match[] = [];

  for (const { fp, hmacBytes } of allHmac) {
    const origPositions = origPositionsByFile.get(fp.fileId);
    if (!origPositions) continue;

    const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
    const selectedVerts = selectVertices(hmacBytes, fp.fileId, suspectVertexCount, slotCount);
    const expectedBits = bitsFromHex(fp.fingerprintBits, fp.fingerprintBitsLength);
    const extracted: boolean[] = new Array(slotCount).fill(false);

    for (let i = 0; i < slotCount; i++) {
      const vi = selectedVerts[i];
      const orig = origPositions.get(vi);
      const susp = suspectMap.get(vi);
      if (!orig || !susp) continue;
      const [dx, dy, dz] = slotDirection(hmacBytes, i);
      extracted[i] = (susp[0]-orig[0])*dx + (susp[1]-orig[1])*dy + (susp[2]-orig[2])*dz > 0;
    }

    let correct = 0;
    for (let j = 0; j < fp.fingerprintBitsLength; j++) {
      let votes = 0;
      for (let k = 0; k < fp.repeatFactor; k++) votes += extracted[j * fp.repeatFactor + k] ? 1 : 0;
      if ((votes > fp.repeatFactor / 2) === expectedBits[j]) correct++;
    }

    const conf = correct / fp.fingerprintBitsLength;
    if (conf < 0.6) continue;

    allMatches.push({
      fingerprintId: fp.id, licenceId: fp.licenceId, licenseeId: fp.licenseeId,
      fileId: fp.fileId, originalFilename: fp.originalFilename,
      confidence: conf, bitsRecovered: correct, bitsExpected: fp.fingerprintBitsLength,
      bitErrorRate: 1 - conf,
      evidenceSummary: conf >= 0.9 ? `Strong match — ${fp.licenceId}` : conf >= 0.75 ? `Possible match — review advised` : `Weak signal`,
    });
  }

  allMatches.sort((a, b) => b.confidence - a.confidence);

  // Enrich with licence + user details
  const licenceIds = [...new Set(allMatches.map((m) => m.licenceId))];
  const licenseeIds = [...new Set(allMatches.map((m) => m.licenseeId))];
  const [licRows, userRows, pkgRow] = await Promise.all([
    licenceIds.length ? db.select({ id: licences.id, projectName: licences.projectName, validFrom: licences.validFrom, validTo: licences.validTo }).from(licences).where(inArray(licences.id, licenceIds)).all() : Promise.resolve([]),
    licenseeIds.length ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, licenseeIds)).all() : Promise.resolve([]),
    db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, packageId)).get(),
  ]);

  const licMap = new Map(licRows.map((l) => [l.id, l]));
  const emailMap = new Map(userRows.map((u) => [u.id, u.email]));
  function ts(u?: number | null) { return u ? new Date(u * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null; }

  return NextResponse.json({
    ok: true, packageId, packageName: pkgRow?.name ?? packageId,
    fileId: fileId ?? null, fingerprintsChecked: fps.length,
    matches: allMatches.map((m) => {
      const lic = licMap.get(m.licenceId);
      return { ...m, licenseeEmail: emailMap.get(m.licenseeId) ?? null, projectName: lic?.projectName ?? null, validFrom: ts(lic?.validFrom), validTo: ts(lic?.validTo) };
    }),
    message: allMatches.length === 0 ? "No fingerprint matched above threshold" : undefined,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RANGE_CHUNK = 32 * 1024 * 1024, DECODE_BATCH = 256 * 1024;

async function streamCollectPositions(bucket: R2Bucket, r2Key: string, fileSize: number, targets: Set<number>): Promise<Map<number, [number, number, number]>> {
  const decoder = new TextDecoder();
  const positions = new Map<number, [number, number, number]>();
  let remainder = "", vi = 0;
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
          if (targets.has(vi)) { const p = t.split(/\s+/); positions.set(vi, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); }
          vi++;
        }
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  if (remainder) { const t = remainder.trimStart(); if ((t.startsWith("v ") || t.startsWith("v\t")) && targets.has(vi)) { const p = t.split(/\s+/); positions.set(vi, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]); } }
  return positions;
}

function makeXorshift32(seed: number) { let s = (seed >>> 0) || 0x12345678; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; }; }

function selectVertices(hmacBytes: Uint8Array, fileId: string, vertexCount: number, slotCount: number): number[] {
  let fh = 0; for (let i = 0; i < fileId.length; i++) fh = (Math.imul(fh, 31) + fileId.charCodeAt(i)) | 0;
  const seed = (((hmacBytes[0] << 24) | (hmacBytes[1] << 16) | (hmacBytes[2] << 8) | hmacBytes[3]) >>> 0 ^ (fh >>> 0)) >>> 0;
  const rng = makeXorshift32(seed);
  return Array.from({ length: slotCount }, () => Math.floor(rng() * vertexCount));
}

function bitsFromHex(hex: string, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => ((parseInt(hex.slice(Math.floor(i/8)*2, Math.floor(i/8)*2+2), 16) >> (7-(i%8))) & 1) === 1);
}
