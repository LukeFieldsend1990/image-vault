export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceGrants, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import { eq, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

const SUBTYPES = ["union", "regulator", "insurer"] as const;
const SCOPES = ["platform", "organisation", "production", "talent"] as const;

// GET /api/admin/compliance-grants — list active grants with the watcher's email
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const watcher = alias(users, "watcher");
  const rows = await db
    .select({
      id: complianceGrants.id,
      complianceUserId: complianceGrants.complianceUserId,
      email: watcher.email,
      subtype: complianceGrants.subtype,
      scope: complianceGrants.scope,
      scopeId: complianceGrants.scopeId,
      createdAt: complianceGrants.createdAt,
    })
    .from(complianceGrants)
    .leftJoin(watcher, eq(watcher.id, complianceGrants.complianceUserId))
    .where(isNull(complianceGrants.revokedAt))
    .orderBy(desc(complianceGrants.createdAt))
    .all();

  return NextResponse.json({ grants: rows });
}

// POST /api/admin/compliance-grants — grant a compliance user access to a scope
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { complianceUserId?: string; subtype?: string; scope?: string; scopeId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.complianceUserId) return NextResponse.json({ error: "complianceUserId is required" }, { status: 400 });
  if (!body.subtype || !(SUBTYPES as readonly string[]).includes(body.subtype)) {
    return NextResponse.json({ error: "subtype must be union | regulator | insurer" }, { status: 400 });
  }
  if (!body.scope || !(SCOPES as readonly string[]).includes(body.scope)) {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }
  if (body.scope !== "platform" && !body.scopeId) {
    return NextResponse.json({ error: "scopeId is required unless scope is platform" }, { status: 400 });
  }

  const db = getDb();
  const target = await db.select({ id: users.id, role: users.role, trueRole: users.trueRole }).from(users).where(eq(users.id, body.complianceUserId)).get();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Effective role = true_role ?? role. Compliance accounts persist role="licensee"
  // with true_role="compliance", so check the effective role, not the raw column.
  if (!isComplianceRole(target.trueRole ?? target.role)) {
    return NextResponse.json({ error: "Target user is not a compliance account" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(complianceGrants).values({
    id,
    complianceUserId: body.complianceUserId,
    subtype: body.subtype as (typeof SUBTYPES)[number],
    scope: body.scope as (typeof SCOPES)[number],
    scopeId: body.scope === "platform" ? null : (body.scopeId ?? null),
    grantedBy: session.sub,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ id }, { status: 201 });
}

