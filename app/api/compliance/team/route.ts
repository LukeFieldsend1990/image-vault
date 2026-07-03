import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceGrants, invites, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import { getUnionIdsForUser } from "@/lib/compliance/grants";
import { getUnionPreset, UNION_PRESETS } from "@/lib/compliance/unions";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { sendEmail } from "@/lib/email/send";

// GET  /api/compliance/team?unionId= — union team: active grants + pending invites.
// POST /api/compliance/team — invite a new union watcher ({ email, unionId }).
//
// Access: admins (any union) + compliance users who hold a platform- or union-scoped
// union grant for the requested union.

async function resolveUnion(
  db: ReturnType<typeof getDb>,
  session: { sub: string; email: string },
  requested: string | null,
): Promise<{ available: { id: string; shortName: string }[]; unionId: string } | { error: string; status: number }> {
  const available = isAdmin(session.email)
    ? UNION_PRESETS.map((u) => ({ id: u.id, shortName: u.shortName }))
    : (await getUnionIdsForUser(db, session.sub, { scopes: ["platform", "union"] })).map((id) => ({
        id,
        shortName: getUnionPreset(id)?.shortName ?? id,
      }));
  if (available.length === 0) return { error: "Forbidden", status: 403 };

  if (requested) {
    if (!available.some((a) => a.id === requested)) return { error: "No access to that union", status: 403 };
    return { available, unionId: requested };
  }
  return { available, unionId: available[0].id };
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const ctx = await resolveUnion(db, session, new URL(req.url).searchParams.get("unionId"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const watcher = alias(users, "watcher");
  const grants = await db
    .select({
      id: complianceGrants.id,
      complianceUserId: complianceGrants.complianceUserId,
      email: watcher.email,
      scope: complianceGrants.scope,
      scopeId: complianceGrants.scopeId,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .leftJoin(watcher, eq(watcher.id, complianceGrants.complianceUserId))
    .where(
      and(
        eq(complianceGrants.subtype, "union"),
        eq(complianceGrants.unionId, ctx.unionId),
        isNull(complianceGrants.revokedAt),
      ),
    )
    .orderBy(desc(complianceGrants.createdAt))
    .all();

  const now = Math.floor(Date.now() / 1000);
  const pendingInvites = await db
    .select({
      id: invites.id,
      email: invites.email,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(
      and(
        eq(invites.role, "compliance"),
        eq(invites.orgSubtype, "union"),
        eq(invites.unionId, ctx.unionId),
        isNull(invites.usedAt),
        gt(invites.expiresAt, now),
      ),
    )
    .orderBy(desc(invites.createdAt))
    .all();

  return NextResponse.json({
    grants,
    pendingInvites,
    unions: ctx.available,
    unionId: ctx.unionId,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const ctx = await resolveUnion(db, session, typeof body.unionId === "string" ? body.unionId : null);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const ALLOWED_SCOPES = ["union", "production", "talent"] as const;
  const requestedScope = typeof body.scope === "string" ? body.scope : "union";
  const scope = isAdmin(session.email) && requestedScope === "platform"
    ? "platform"
    : (ALLOWED_SCOPES as readonly string[]).includes(requestedScope)
      ? requestedScope
      : "union";

  const now = Math.floor(Date.now() / 1000);

  const existingUser = await db
    .select({ id: users.id, role: users.role, trueRole: users.trueRole })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existingUser) {
    if (!isComplianceRole(existingUser.trueRole ?? existingUser.role)) {
      return NextResponse.json({ error: "That user already has a non-compliance account" }, { status: 409 });
    }
    const existing = await db
      .select({ id: complianceGrants.id })
      .from(complianceGrants)
      .where(
        and(
          eq(complianceGrants.complianceUserId, existingUser.id),
          eq(complianceGrants.subtype, "union"),
          eq(complianceGrants.unionId, ctx.unionId),
          isNull(complianceGrants.revokedAt),
        ),
      )
      .get();
    if (existing) return NextResponse.json({ error: "User already has access to this union" }, { status: 409 });

    const { createGrant } = await import("@/lib/compliance/grants");
    const grantId = await createGrant(db, {
      complianceUserId: existingUser.id,
      subtype: "union",
      scope: scope as "platform" | "union",
      scopeId: null,
      unionId: ctx.unionId,
      grantedBy: session.sub,
    });

    const preset = getUnionPreset(ctx.unionId);
    void sendEmail({
      to: email,
      subject: `You've been added to the ${preset?.shortName ?? "union"} team on Image Vault`,
      html: `
        <p>You now have access to the <strong>${preset?.shortName ?? ctx.unionId}</strong> union team on Image Vault.</p>
        <p><a href="${process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai"}/union-team">View your team</a></p>
      `,
    });

    return NextResponse.json({ ok: true, grantId, existing: true }, { status: 201 });
  }

  const existingInvite = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, email),
        isNull(invites.usedAt),
        gt(invites.expiresAt, now),
      ),
    )
    .get();
  if (existingInvite) return NextResponse.json({ error: "A pending invite already exists for that email" }, { status: 409 });

  const inviteId = crypto.randomUUID();
  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "compliance",
    invitedBy: session.sub,
    orgSubtype: "union",
    unionId: ctx.unionId,
    expiresAt: now + 7 * 24 * 60 * 60,
    createdAt: now,
  });

  const preset = getUnionPreset(ctx.unionId);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  void sendEmail({
    to: email,
    subject: `You've been invited to join ${preset?.shortName ?? "a union"} on Image Vault`,
    html: `
      <p>You've been invited to join the <strong>${preset?.shortName ?? ctx.unionId}</strong> union team on Image Vault.</p>
      <p><a href="${baseUrl}/signup?invite=${inviteId}">Accept invitation</a></p>
      <p>This link expires in 7 days.</p>
      <p style="color:#888;font-size:12px;">You'll create your account after clicking the link.</p>
    `,
  });

  return NextResponse.json({ ok: true, inviteId }, { status: 201 });
}
