import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, organisations, vendorAuthorisations, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isProductionSideOfLicence, isOrgMember } from "@/lib/licences/vendorAccess";
import { notifyTalentAndReps } from "@/lib/notifications/create";
import { eq, and, desc } from "drizzle-orm";

// GET /api/licences/[id]/vendors — list vendor authorisations for a licence
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const licence = await db
    .select({
      id: licences.id,
      licenseeId: licences.licenseeId,
      organisationId: licences.organisationId,
      talentId: licences.talentId,
      projectName: licences.projectName,
      status: licences.status,
      licenceType: licences.licenceType,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      productionId: licences.productionId,
      packageId: licences.packageId,
      fileScope: licences.fileScope,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });

  const rows = await db
    .select({
      id: vendorAuthorisations.id,
      vendorOrgId: vendorAuthorisations.vendorOrgId,
      orgName: organisations.name,
      orgType: organisations.orgType,
      orgShortCode: organisations.shortCode,
      vendorAuditPassed: organisations.vendorAuditPassed,
      parentAuthorisationId: vendorAuthorisations.parentAuthorisationId,
      nominatedByOrgId: vendorAuthorisations.nominatedByOrgId,
      status: vendorAuthorisations.status,
      createdAt: vendorAuthorisations.createdAt,
      revokedAt: vendorAuthorisations.revokedAt,
    })
    .from(vendorAuthorisations)
    .innerJoin(organisations, eq(organisations.id, vendorAuthorisations.vendorOrgId))
    .where(eq(vendorAuthorisations.licenceId, id))
    .orderBy(desc(vendorAuthorisations.createdAt))
    .all();

  // Caller must be either the production side or a member of an authorised vendor org.
  const isProd = await isProductionSideOfLicence(db, session, licence);
  const memberOrgIds = new Set<string>();
  if (!isProd) {
    for (const r of rows) {
      if (r.status === "active" && (await isOrgMember(db, session.sub, r.vendorOrgId))) memberOrgIds.add(r.vendorOrgId);
    }
    if (memberOrgIds.size === 0 && session.sub !== licence.talentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Fetch the package associated with this licence so the vendor page can show it.
  let pkg: { id: string; name: string; scanType: string | null; status: string } | null = null;
  if (licence.packageId) {
    pkg = await db
      .select({ id: scanPackages.id, name: scanPackages.name, scanType: scanPackages.scanType, status: scanPackages.status })
      .from(scanPackages)
      .where(eq(scanPackages.id, licence.packageId))
      .get() ?? null;
  }

  const licenceSummary = {
    id: licence.id,
    projectName: licence.projectName,
    status: licence.status,
    licenceType: licence.licenceType,
    validFrom: licence.validFrom,
    validTo: licence.validTo,
    productionId: licence.productionId ?? null,
    package: pkg ? { id: pkg.id, name: pkg.name, scanType: pkg.scanType, fileScope: licence.fileScope ?? "all" } : null,
  };

  return NextResponse.json({ canManage: isProd, memberOrgIds: Array.from(memberOrgIds), authorisations: rows, licence: licenceSummary });
}

// POST /api/licences/[id]/vendors — authorise a vendor (production) or nominate a sub-vendor (vendor)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { vendorOrgId?: string; parentAuthorisationId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.vendorOrgId) return NextResponse.json({ error: "vendorOrgId is required" }, { status: 400 });

  const db = getDb();
  const licence = await db
    .select({ id: licences.id, licenseeId: licences.licenseeId, organisationId: licences.organisationId, status: licences.status, talentId: licences.talentId, projectName: licences.projectName })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Vendors can only be authorised on an approved licence" }, { status: 409 });
  }

  const vendorOrg = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, body.vendorOrgId))
    .get();
  if (!vendorOrg) return NextResponse.json({ error: "Vendor organisation not found" }, { status: 404 });

  let parentAuthorisationId: string | null = null;
  let nominatedByOrgId: string | null = null;

  if (body.parentAuthorisationId) {
    // Sub-vendor nomination — caller must be a member of the parent auth's vendor org.
    const parent = await db
      .select({ id: vendorAuthorisations.id, vendorOrgId: vendorAuthorisations.vendorOrgId, licenceId: vendorAuthorisations.licenceId, status: vendorAuthorisations.status })
      .from(vendorAuthorisations)
      .where(eq(vendorAuthorisations.id, body.parentAuthorisationId))
      .get();
    if (!parent || parent.licenceId !== id) {
      return NextResponse.json({ error: "Parent authorisation not found for this licence" }, { status: 404 });
    }
    if (parent.status !== "active") {
      return NextResponse.json({ error: "Parent authorisation is not active" }, { status: 409 });
    }
    if (!(await isOrgMember(db, session.sub, parent.vendorOrgId)) && session.role !== "admin") {
      return NextResponse.json({ error: "Only the nominating vendor can add a sub-vendor" }, { status: 403 });
    }
    parentAuthorisationId = parent.id;
    nominatedByOrgId = parent.vendorOrgId;
  } else {
    // Direct authorisation — caller must be the production side of the licence.
    if (!(await isProductionSideOfLicence(db, session, licence))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Reactivate an existing revoked auth for the same (licence, vendor) rather than duplicating.
  const existing = await db
    .select({ id: vendorAuthorisations.id, status: vendorAuthorisations.status })
    .from(vendorAuthorisations)
    .where(and(eq(vendorAuthorisations.licenceId, id), eq(vendorAuthorisations.vendorOrgId, body.vendorOrgId)))
    .get();

  const now = Math.floor(Date.now() / 1000);

  // Notify the talent + their reps that a vendor was granted access (v6 "agent notified").
  const notifyVendorGranted = () =>
    notifyTalentAndReps(db, licence.talentId, {
      type: "vendor_authorised",
      title: nominatedByOrgId ? "Sub-vendor authorised" : "Vendor authorised",
      body: `${vendorOrg.name} can now access ${licence.projectName}.`,
      href: `/licences/${id}/vendors`,
    });

  if (existing) {
    if (existing.status === "active") {
      return NextResponse.json({ error: "Vendor is already authorised" }, { status: 409 });
    }
    await db
      .update(vendorAuthorisations)
      .set({ status: "active", parentAuthorisationId, nominatedByOrgId, authorisedBy: session.sub, createdAt: now, revokedAt: null, revokedBy: null })
      .where(eq(vendorAuthorisations.id, existing.id));
    void notifyVendorGranted();
    return NextResponse.json({ id: existing.id, reactivated: true }, { status: 200 });
  }

  const authId = crypto.randomUUID();
  await db.insert(vendorAuthorisations).values({
    id: authId,
    licenceId: id,
    vendorOrgId: body.vendorOrgId,
    parentAuthorisationId,
    nominatedByOrgId,
    authorisedBy: session.sub,
    status: "active",
    createdAt: now,
  });

  void notifyVendorGranted();
  return NextResponse.json({ id: authId }, { status: 201 });
}
