import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users, productions, licences, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { validateCountry } from "@/lib/organisations/country";
import { syncOrgCountryAcrossProductions } from "@/lib/productions/vendors";
import { eq, and, desc, inArray } from "drizzle-orm";

// GET /api/organisations/[id] — org details + member list
// Accessible by: org members, talent, rep, admin (talent/rep get read-only view for licence approval)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, id))
    .limit(1)
    .all();

  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Access model:
  //  - admins: full view.
  //  - org members: full view (with member emails).
  //  - talent/rep: read-only view ONLY when they are a counterparty to a licence
  //    held by this org (the licence-approval context). They do NOT get the member
  //    email roster — that would let any talent/rep harvest emails for every org.
  const orgAdmin = isAdmin(session.email);
  let isMember = false;
  if (!orgAdmin) {
    const [membership] = await db
      .select({ memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
      .limit(1)
      .all();
    isMember = !!membership;

    if (!isMember) {
      // Non-member: require a licence relationship with this org.
      let hasLicenceTie = false;
      if (session.role === "talent") {
        const tie = await db
          .select({ id: licences.id })
          .from(licences)
          .where(and(eq(licences.organisationId, id), eq(licences.talentId, session.sub)))
          .limit(1)
          .all();
        hasLicenceTie = tie.length > 0;
      } else if (session.role === "rep") {
        const managed = await db
          .select({ talentId: talentReps.talentId })
          .from(talentReps)
          .where(eq(talentReps.repId, session.sub))
          .all();
        const managedIds = managed.map((m) => m.talentId);
        if (managedIds.length > 0) {
          const tie = await db
            .select({ id: licences.id })
            .from(licences)
            .where(and(eq(licences.organisationId, id), inArray(licences.talentId, managedIds)))
            .limit(1)
            .all();
          hasLicenceTie = tie.length > 0;
        }
      }
      if (!hasLicenceTie) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const canSeeMemberEmails = orgAdmin || isMember;
  const members = canSeeMemberEmails
    ? await db
        .select({
          userId: organisationMembers.userId,
          email: users.email,
          memberRole: organisationMembers.memberRole,
          joinedAt: organisationMembers.joinedAt,
        })
        .from(organisationMembers)
        .innerJoin(users, eq(users.id, organisationMembers.userId))
        .where(eq(organisationMembers.organisationId, id))
        .all()
    : [];

  // Productions this org owns — surfaced in the org view so an industry member
  // can see and seed productions for the organisation they're populating.
  const orgProductions = await db
    .select({
      id: productions.id,
      name: productions.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      shortCode: productions.shortCode,
      createdAt: productions.createdAt,
    })
    .from(productions)
    .where(eq(productions.organisationId, id))
    .orderBy(desc(productions.createdAt))
    .all();

  return NextResponse.json({ organisation: org, members, productions: orgProductions });
}

// PATCH /api/organisations/[id] — update org details (owner/admin members only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const [membership] = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
    .limit(1)
    .all();

  const isOrgAdmin = membership?.memberRole === "owner" || membership?.memberRole === "admin";
  if (!isOrgAdmin && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; website?: string; billingEmail?: string; country?: string; countryTopLevelId?: string; ownerImplicitAccess?: boolean; setupDismissed?: boolean };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (body.name?.trim()) updates.name = body.name.trim();
  if ("website" in body) updates.website = body.website?.trim() ?? null;
  if ("billingEmail" in body) updates.billingEmail = body.billingEmail?.trim() ?? null;
  // Permanently dismiss the org's "finish setting up" checklist (owner/admin).
  if ("setupDismissed" in body) updates.setupDismissed = Boolean(body.setupDismissed);
  // Owner-only governance toggle — admins can edit other org details but not this.
  if ("ownerImplicitAccess" in body) {
    const isOwner = membership?.memberRole === "owner" || session.role === "admin";
    if (!isOwner) {
      return NextResponse.json({ error: "Only an organisation owner can change implicit production access." }, { status: 403 });
    }
    updates.ownerImplicitAccess = Boolean(body.ownerImplicitAccess);
  }
  if (body.country !== undefined || body.countryTopLevelId !== undefined) {
    const v = validateCountry(body.country, body.countryTopLevelId);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    updates.country = v.country;
    updates.countryTopLevelId = v.topLevelId;
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, id));

  // When the org's country is (re)set, fan it out to every production the org
  // is attached to as a vendor — productions inherit vendor jurisdictions.
  if ("country" in updates) {
    try { await syncOrgCountryAcrossProductions(db, id); } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true });
}
