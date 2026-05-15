export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanFiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq, and, inArray } from "drizzle-orm";
import { detectFingerprint } from "@/lib/geo-fingerprint/detect";

// POST /api/admin/geometry-fingerprints/detect
// Upload a suspect OBJ and compare against all issued fingerprints for a package file.
// Body: multipart/form-data — file (suspect.obj), packageId, fileId (optional)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const suspectFile = formData.get("file") as File | null;
  const packageId = formData.get("packageId") as string | null;
  const fileId = formData.get("fileId") as string | null;

  if (!suspectFile || !packageId) {
    return NextResponse.json({ error: "file and packageId are required" }, { status: 400 });
  }
  if (!suspectFile.name.toLowerCase().endsWith(".obj")) {
    return NextResponse.json({ error: "Only .obj files are supported" }, { status: 400 });
  }

  const suspectObjText = await suspectFile.text();

  const db = getDb();

  // Find all ready fingerprints for this package (optionally filtered to a file)
  const fpQuery = db
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
    })
    .from(geometryFingerprints)
    .innerJoin(scanFiles, eq(scanFiles.id, geometryFingerprints.fileId))
    .where(
      and(
        eq(geometryFingerprints.packageId, packageId),
        eq(geometryFingerprints.status, "ready"),
        ...(fileId ? [eq(geometryFingerprints.fileId, fileId)] : []),
      ),
    );

  const fps = await fpQuery.all();

  if (fps.length === 0) {
    return NextResponse.json({
      ok: true,
      packageId,
      matches: [],
      message: "No issued fingerprints found for this package",
    });
  }

  // Group by fileId — we need the original OBJ for each file
  const byFile = new Map<string, typeof fps[number][]>();
  for (const fp of fps) {
    if (!byFile.has(fp.fileId)) byFile.set(fp.fileId, []);
    byFile.get(fp.fileId)!.push(fp);
  }

  const { env } = getRequestContext();
  const allMatches: Array<{
    fingerprintId: string;
    licenceId: string;
    licenseeId: string;
    licenseeEmail?: string;
    fileId: string;
    originalFilename: string;
    confidence: number;
    bitsRecovered: number;
    bitsExpected: number;
    bitErrorRate: number;
    evidenceSummary: string;
  }> = [];

  for (const [fid, fileFps] of byFile) {
    const originalR2Key = fileFps[0].originalR2Key;
    const originalFilename = fileFps[0].originalFilename;

    const originalObj = await env.SCANS_BUCKET.get(originalR2Key);
    if (!originalObj) continue;
    const originalObjText = await originalObj.text();

    const detectionInput = fileFps.map((fp) => ({
      id: fp.id,
      licenceId: fp.licenceId,
      licenseeId: fp.licenseeId,
      fileId: fp.fileId,
      fingerprintBits: fp.fingerprintBits,
      fingerprintBitsLength: fp.fingerprintBitsLength,
      repeatFactor: fp.repeatFactor,
    }));

    const matches = await detectFingerprint(suspectObjText, originalObjText, detectionInput);

    for (const m of matches) {
      allMatches.push({ ...m, fileId: fid, originalFilename });
    }
  }

  // Resolve licensee emails for matched results
  const licenseeIds = [...new Set(allMatches.map((m) => m.licenseeId))];
  const licenseeUsers =
    licenseeIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, licenseeIds))
          .all()
      : [];
  const emailMap = new Map(licenseeUsers.map((u) => [u.id, u.email]));

  const enriched = allMatches
    .map((m) => ({ ...m, licenseeEmail: emailMap.get(m.licenseeId) }))
    .sort((a, b) => b.confidence - a.confidence);

  return NextResponse.json({
    ok: true,
    packageId,
    fileId: fileId ?? null,
    fingerprintsChecked: fps.length,
    matches: enriched,
    message:
      enriched.length === 0
        ? "No issued fingerprint matched above threshold"
        : undefined,
  });
}
