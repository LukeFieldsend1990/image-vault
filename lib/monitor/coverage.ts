/**
 * Detection-coverage payload builder, shared by the talent-facing
 * reference-set route and the rep roster monitor view. Pure data assembly —
 * auth and role checks stay in the routes.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  geometryFingerprints,
  monitorPhashIndex,
  scanPackages,
  talentProfiles,
} from "@/lib/db/schema";
import {
  computeDetectionCoverage,
  coverageInputFromReferences,
  type ReferenceImage,
} from "./reference-set";

type Db = ReturnType<typeof getDb>;

export async function buildCoveragePayload(db: Db, talentId: string, refs: ReferenceImage[]) {
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

  const phashRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(monitorPhashIndex)
    .where(and(eq(monitorPhashIndex.talentId, talentId), eq(monitorPhashIndex.status, "hashed")))
    .get();

  const coverage = computeDetectionCoverage(
    coverageInputFromReferences(refs, {
      geometryFingerprintCount: fingerprintCount,
      hasProfileImage: !!profile?.url,
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
    geometryFingerprintCount: fingerprintCount,
    hasProfileImage: !!profile?.url,
    /** Reference stills carrying a dHash in the derivation index. Shown as
     *  its own line, deliberately outside the coverage score: the index
     *  strengthens the derivation layer, not face matching. */
    phashIndexedCount: phashRow?.n ?? 0,
  };
}

export type CoveragePayload = Awaited<ReturnType<typeof buildCoveragePayload>>;
