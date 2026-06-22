import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, vendorAuthorisations, organisationMembers, organisations, talentProfiles, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, inArray } from "drizzle-orm";

// GET /api/productions/[id]/vendor-access
// The scans on this production that the caller's org(s) have been authorised to
// pull (producer→vendor authorisation). Read-only surface for the vendor side —
// the actual pull happens through the Render Bridge once the org's audit passes.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const orgRows = await db
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .where(eq(organisationMembers.userId, session.sub))
    .all();
  const orgIds = orgRows.map((r) => r.organisationId);
  if (orgIds.length === 0) return NextResponse.json({ scans: [], auditPassed: false });

  // Render Bridge only serves an org once its environment audit has passed.
  const orgs = await db
    .select({ audit: organisations.vendorAuditPassed })
    .from(organisations)
    .where(inArray(organisations.id, orgIds))
    .all();
  const auditPassed = orgs.some((o) => o.audit);

  const rows = await db
    .select({
      licenceId: licences.id,
      talentId: licences.talentId,
      packageName: scanPackages.name,
      licenceType: licences.licenceType,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      status: licences.status,
    })
    .from(vendorAuthorisations)
    .innerJoin(licences, eq(licences.id, vendorAuthorisations.licenceId))
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .where(and(
      inArray(vendorAuthorisations.vendorOrgId, orgIds),
      eq(vendorAuthorisations.status, "active"),
      eq(licences.productionId, id),
    ))
    .all();

  const talentIds = [...new Set(rows.map((r) => r.talentId))];
  const profiles = talentIds.length > 0
    ? await db.select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName }).from(talentProfiles).where(inArray(talentProfiles.userId, talentIds)).all()
    : [];
  const nameMap = new Map(profiles.map((p) => [p.userId, p.fullName]));

  // Dedupe by licence — a scan can be authorised to more than one of the caller's orgs.
  const seen = new Set<string>();
  const scans = rows
    .filter((r) => (seen.has(r.licenceId) ? false : (seen.add(r.licenceId), true)))
    .map((r) => ({
      licenceId: r.licenceId,
      talentName: nameMap.get(r.talentId) ?? null,
      packageName: r.packageName ?? null,
      licenceType: r.licenceType,
      validFrom: r.validFrom,
      validTo: r.validTo,
      status: r.status,
    }));

  return NextResponse.json({ scans, auditPassed });
}
