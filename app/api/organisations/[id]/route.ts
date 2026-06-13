export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";

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

  // Licensees must be members; talent/rep/admin can view for licence context
  if (isIndustryRole(session.role)) {
    const [membership] = await db
      .select({ memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
      .limit(1)
      .all();
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const members = await db
    .select({
      userId: organisationMembers.userId,
      email: users.email,
      memberRole: organisationMembers.memberRole,
      joinedAt: organisationMembers.joinedAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(eq(organisationMembers.organisationId, id))
    .all();

  return NextResponse.json({ organisation: org, members });
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

  let body: { name?: string; website?: string; billingEmail?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (body.name?.trim()) updates.name = body.name.trim();
  if ("website" in body) updates.website = body.website?.trim() ?? null;
  if ("billingEmail" in body) updates.billingEmail = body.billingEmail?.trim() ?? null;

  await db.update(organisations).set(updates).where(eq(organisations.id, id));

  return NextResponse.json({ ok: true });
}
