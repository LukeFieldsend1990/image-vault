import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionMembers, organisationMembers, organisations, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveOwnerAccess, getProductionOwnerIds } from "@/lib/productions/access";
import { eq, and } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

async function loadProduction(db: Db, productionId: string) {
  return db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
}

// GET /api/productions/[id]/team — production team + (for managers) the org
// members who can still be added.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await loadProduction(db, id);
  if (!production) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = isAdmin(session.email);
  const access = admin
    ? null
    : isIndustryRole(session.role)
      ? await resolveOwnerAccess(db, id, production.organisationId, session.sub)
      : null;
  if (!admin && !access?.isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canManage = admin || Boolean(access?.canManageTeam);

  // Explicitly-added team members.
  const team = await db
    .select({
      userId: productionMembers.userId,
      email: users.email,
      role: productionMembers.role,
      addedAt: productionMembers.addedAt,
    })
    .from(productionMembers)
    .innerJoin(users, eq(users.id, productionMembers.userId))
    .where(eq(productionMembers.productionId, id))
    .all();

  // The production owner (coordinator / org founder) runs the production
  // implicitly — surface them, and exclude them from the "addable" list.
  // When the org's owner-implicit-access toggle is on, every org owner is an
  // implicit owner too. Everyone else is a candidate to add.
  let owners: { userId: string; email: string }[] = [];
  let candidates: { userId: string; email: string }[] = [];
  if (production.organisationId) {
    const ownerIds = await getProductionOwnerIds(db, id);
    const org = await db
      .select({ implicit: organisations.ownerImplicitAccess })
      .from(organisations)
      .where(eq(organisations.id, production.organisationId))
      .get();
    const orgMembers = await db
      .select({ userId: organisationMembers.userId, email: users.email, memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, production.organisationId))
      .all();
    const isImplicitOwner = (m: { userId: string; memberRole: string }) =>
      ownerIds.has(m.userId) || (Boolean(org?.implicit) && m.memberRole === "owner");
    owners = orgMembers.filter(isImplicitOwner).map((m) => ({ userId: m.userId, email: m.email }));
    const teamIds = new Set(team.map((t) => t.userId));
    candidates = orgMembers
      .filter((m) => !isImplicitOwner(m) && !teamIds.has(m.userId))
      .map((m) => ({ userId: m.userId, email: m.email }));
  }

  return NextResponse.json({ team, owners, candidates, canManage });
}

// POST /api/productions/[id]/team — add (or re-tier) an org member on the team.
// Body: { userId, role: 'viewer' | 'editor' }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await loadProduction(db, id);
  if (!production) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = isAdmin(session.email);
  const access = admin
    ? null
    : isIndustryRole(session.role)
      ? await resolveOwnerAccess(db, id, production.organisationId, session.sub)
      : null;
  if (!admin && !access?.canManageTeam) {
    return NextResponse.json({ error: "Forbidden — only the production owner can manage the team" }, { status: 403 });
  }
  if (!production.organisationId) {
    return NextResponse.json({ error: "This production has no owning organisation to draw a team from." }, { status: 400 });
  }

  let body: { userId?: unknown; role?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = body.role === "editor" ? "editor" : "viewer";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  // The target must be a member of the owning org — we never grant access to
  // anyone outside it. What matters beyond that is that they don't already have
  // full access implicitly (as the production owner, or as an org owner while
  // the org's owner-implicit-access toggle is on).
  const membership = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(
      eq(organisationMembers.organisationId, production.organisationId),
      eq(organisationMembers.userId, userId),
    ))
    .get();
  if (!membership) {
    return NextResponse.json({ error: "That person isn't a member of your organisation." }, { status: 400 });
  }
  const ownerIds = await getProductionOwnerIds(db, id);
  const org = await db
    .select({ implicit: organisations.ownerImplicitAccess })
    .from(organisations)
    .where(eq(organisations.id, production.organisationId))
    .get();
  if (ownerIds.has(userId) || (org?.implicit && membership.memberRole === "owner")) {
    return NextResponse.json({ error: "That person already has full access to this production." }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ userId: productionMembers.userId })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, id), eq(productionMembers.userId, userId)))
    .get();

  if (existing) {
    await db
      .update(productionMembers)
      .set({ role })
      .where(and(eq(productionMembers.productionId, id), eq(productionMembers.userId, userId)));
    return NextResponse.json({ ok: true, mode: "updated" });
  }

  await db.insert(productionMembers).values({
    productionId: id,
    userId,
    role,
    addedBy: session.sub,
    addedAt: now,
  });
  return NextResponse.json({ ok: true, mode: "added" }, { status: 201 });
}
