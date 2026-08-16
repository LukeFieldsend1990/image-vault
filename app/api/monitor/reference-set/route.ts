import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { geometryFingerprints, scanPackages, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import {
  computeDetectionCoverage,
  coverageInputFromReferences,
  getActiveReferences,
  getVaultPackageSummary,
  syncReferenceSet,
  type ReferenceImage,
} from "@/lib/monitor/reference-set";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

// GET  /api/monitor/reference-set — the talent's detection coverage: which
//      vault scans anchor identity matching, and what to add to strengthen it.
// POST /api/monitor/reference-set — re-sync the reference set against the
//      vault now (also happens lazily at the top of every sweep).

async function buildPayload(db: ReturnType<typeof getDb>, talentId: string, refs: ReferenceImage[]) {
  const packages = await db
    .select({ id: scanPackages.id, name: scanPackages.name })
    .from(scanPackages)
    .where(and(eq(scanPackages.talentId, talentId), isNull(scanPackages.deletedAt)))
    .all();

  let fingerprintCount = 0;
  if (packages.length) {
    const row = await db
      .select({ n: sql<number>`count(*)` })
      .from(geometryFingerprints)
      .where(inArray(geometryFingerprints.packageId, packages.map((p) => p.id)))
      .get();
    fingerprintCount = row?.n ?? 0;
  }

  const profile = await db
    .select({ url: talentProfiles.profileImageUrl })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, talentId))
    .get();

  // What the vault actually holds, so coverage never asks for a scan type the
  // talent has already uploaded — including packages whose files are all
  // meshes and textures and so contribute no reference stills.
  const vault = await getVaultPackageSummary(db, talentId);

  const coverage = computeDetectionCoverage(
    coverageInputFromReferences(refs, {
      geometryFingerprintCount: fingerprintCount,
      hasProfileImage: !!profile?.url,
      vaultPackages: { total: vault.total, faceCount: vault.faceCount, bodyCount: vault.bodyCount },
    })
  );

  const packageNames = new Map(packages.map((p) => [p.id, p.name]));
  return {
    coverage,
    referenceCount: refs.length,
    faceReferenceCount: refs.filter((r) => r.kind === "face").length,
    bodyReferenceCount: refs.filter((r) => r.kind === "full_body").length,
    packagesContributing: [...new Set(refs.map((r) => r.packageId))].map((id) => ({
      id,
      name: packageNames.get(id) ?? "Scan package",
    })),
    vaultPackages: {
      total: vault.total,
      faceCount: vault.faceCount,
      bodyCount: vault.bodyCount,
    },
    geometryFingerprintCount: fingerprintCount,
    hasProfileImage: !!profile?.url,
  };
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts have a likeness monitor" }, { status: 403 });
  }

  const db = getDb();
  const refs = await getActiveReferences(db, session.sub);
  return NextResponse.json(await buildPayload(db, session.sub, refs));
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts have a likeness monitor" }, { status: 403 });
  }

  const db = getDb();
  const refs = await syncReferenceSet(db, session.sub);
  return NextResponse.json(await buildPayload(db, session.sub, refs));
}
