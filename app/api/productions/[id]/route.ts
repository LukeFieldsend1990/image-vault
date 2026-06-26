import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions,
  productionCompanies,
  organisations,
  licences,
  invites,
  feeObligations,
  renderBridgeAgents,
  productionInclusionRecords,
  productionCast,
  productionDefaultTerms,
  productionVendors,
  productionMembers,
  insurerPolicies,
  organisationMembers,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { getRepAgencyContext } from "@/lib/agency/rep-visibility";
import { eq, and, count } from "drizzle-orm";

// GET /api/productions/[id] — get production detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select({
      id: productions.id,
      name: productions.name,
      companyId: productions.companyId,
      companyName: productionCompanies.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      imdbId: productions.imdbId,
      tmdbId: productions.tmdbId,
      director: productions.director,
      vfxSupervisor: productions.vfxSupervisor,
      notes: productions.notes,
      organisationId: productions.organisationId,
      orgName: organisations.name,
      orgType: organisations.orgType,
      orgShortCode: organisations.shortCode,
      shortCode: productions.shortCode,
      sagProjectNumber: productions.sagProjectNumber,
      homeCountry: productions.homeCountry,
      isSag: productions.isSag,
      isEquity: productions.isEquity,
      otherUnion: productions.otherUnion,
      createdAt: productions.createdAt,
      updatedAt: productions.updatedAt,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .leftJoin(organisations, eq(organisations.id, productions.organisationId))
    .where(eq(productions.id, id))
    .limit(1)
    .all();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Work out how this viewer relates to the production. Owners/admins get the
  // full management UI; vendors/reps get scoped views; anyone else is denied.
  let viewerRole: "admin" | "owner" | "vendor" | "rep" | "none" = "none";
  // Operational rights on the owner side. Org owners/admins (and system admins)
  // get the lot; explicitly-added editors can mutate but not manage the team;
  // explicitly-added viewers are read-only.
  let viewerCanWrite = false;
  let viewerCanManageTeam = false;
  let viewerVendorType: string | null = null;
  // For reps, why are they allowed here? "cast" = directly assigned to a slot
  // (path-C invite flow); "agency" = agency-shared visibility via a colleague's
  // APPROVED licence. Drives copy and the cast-scope query.
  let viewerRepKind: "cast" | "agency" | null = null;

  if (isAdmin(session.email)) {
    viewerRole = "admin";
    viewerCanWrite = true;
    viewerCanManageTeam = true;
  } else if (isIndustryRole(session.role)) {
    const access = await resolveOwnerAccess(db, id, row.organisationId, session.sub);
    if (access.isMember) {
      viewerRole = "owner";
      viewerCanWrite = access.canWrite;
      viewerCanManageTeam = access.canManageTeam;
    }
    if (viewerRole === "none") {
      // Not an owner — are they a member of an org attached as an active vendor?
      const vendor = await db
        .select({ vendorType: productionVendors.vendorType })
        .from(productionVendors)
        .innerJoin(organisationMembers, eq(organisationMembers.organisationId, productionVendors.vendorOrgId))
        .where(and(
          eq(productionVendors.productionId, id),
          eq(productionVendors.status, "active"),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (vendor) {
        viewerRole = "vendor";
        viewerVendorType = vendor.vendorType;
      }
    }
  } else if (session.role === "rep") {
    // Reps see a production if (a) they hold a reserved cast slot on it
    // (existing path C flow), or (b) any talent managed by a rep in their
    // agency holds an APPROVED licence on it (agency-shared visibility —
    // rosters stay segregated, only the production view crosses the line).
    const repCast = await db
      .select({ id: productionCast.id })
      .from(productionCast)
      .where(and(eq(productionCast.productionId, id), eq(productionCast.repId, session.sub)))
      .get();
    if (repCast) {
      viewerRole = "rep";
      viewerRepKind = "cast";
    } else {
      const ctx = await getRepAgencyContext(db, session.sub);
      if (ctx.agencyProductionIds.includes(id)) {
        viewerRole = "rep";
        viewerRepKind = "agency";
      }
    }
  }

  if (viewerRole === "none") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Count linked licences
  const [licenceCount] = await db
    .select({ count: count() })
    .from(licences)
    .where(eq(licences.productionId, id))
    .all();

  return NextResponse.json({ production: { ...row, licenceCount: licenceCount?.count ?? 0, viewerRole, viewerCanWrite, viewerCanManageTeam, viewerVendorType, viewerRepKind } });
}

// PATCH /api/productions/[id] — update production metadata
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  // Auth: admin, rep, or someone with write access to the production's owning org
  // (org owner/admin, or an explicitly-added production editor) — so producers and
  // delegated colleagues can edit their own production's non-key details.
  let allowed = isAdmin(session.email) || session.role === "rep";
  if (!allowed && isIndustryRole(session.role)) {
    const prod = await db
      .select({ organisationId: productions.organisationId })
      .from(productions)
      .where(eq(productions.id, id))
      .get();
    if (!prod) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const access = await resolveOwnerAccess(db, id, prod.organisationId, session.sub);
    if (access.canWrite) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  const updates: Record<string, unknown> = { updatedAt: now };
  const allowedFields = ["name", "companyId", "type", "year", "status", "imdbId", "tmdbId", "director", "vfxSupervisor", "notes", "isSag", "isEquity"];
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }
  // Free-text fields are trimmed; empty string clears them to null.
  for (const field of ["sagProjectNumber", "otherUnion"] as const) {
    if (field in body) {
      const v = body[field];
      updates[field] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
  }

  await db.update(productions).set(updates).where(eq(productions.id, id));

  return NextResponse.json({ ok: true });
}

// DELETE /api/productions/[id] — permanently delete a production (admin only)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();

  const existing = await db.select({ id: productions.id }).from(productions).where(eq(productions.id, id)).get();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Clean up every table that references this production explicitly, so the
  // result is identical whether or not D1 is enforcing foreign keys.
  //
  // Real agreements / audit trails outlive the production — detach them by
  // nulling productionId rather than deleting.
  await db.update(licences).set({ productionId: null }).where(eq(licences.productionId, id));
  await db.update(invites).set({ productionId: null }).where(eq(invites.productionId, id));
  await db.update(feeObligations).set({ productionId: null }).where(eq(feeObligations.productionId, id));
  await db.update(renderBridgeAgents).set({ productionId: null }).where(eq(renderBridgeAgents.productionId, id));
  await db.update(productionInclusionRecords).set({ productionId: null }).where(eq(productionInclusionRecords.productionId, id));

  // Production-scoped records are removed with the production.
  await db.delete(insurerPolicies).where(eq(insurerPolicies.productionId, id));
  await db.delete(productionVendors).where(eq(productionVendors.productionId, id));
  await db.delete(productionDefaultTerms).where(eq(productionDefaultTerms.productionId, id));
  await db.delete(productionMembers).where(eq(productionMembers.productionId, id));
  await db.delete(productionCast).where(eq(productionCast.productionId, id));

  await db.delete(productions).where(eq(productions.id, id));

  return NextResponse.json({ ok: true });
}
