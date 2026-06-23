import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceGrants, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import {
  createGrant,
  GrantScopeError,
  isAllowedScopeForSubtype,
  INSURER_ALLOWED_SCOPES,
  type ComplianceScope,
  type ComplianceSubtype,
} from "@/lib/compliance/grants";
import { getUnionPreset } from "@/lib/compliance/unions";
import { eq, isNull, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

const SUBTYPES = ["union", "regulator", "insurer"] as const;
const SCOPES = ["platform", "organisation", "production", "talent", "union"] as const;

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
      unionId: complianceGrants.unionId,
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

  let body: { complianceUserId?: string; subtype?: string; unionId?: string; scope?: string; scopeId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.complianceUserId) return NextResponse.json({ error: "complianceUserId is required" }, { status: 400 });
  if (!body.subtype || !(SUBTYPES as readonly string[]).includes(body.subtype)) {
    return NextResponse.json({ error: "subtype must be union | regulator | insurer" }, { status: 400 });
  }
  // Union grants must name the union they attribute to (SAG vs Equity); other
  // subtypes never carry one.
  let unionId: string | null = null;
  if (body.subtype === "union") {
    if (!body.unionId || !getUnionPreset(body.unionId)) {
      return NextResponse.json({ error: "union grants require a valid unionId" }, { status: 400 });
    }
    unionId = body.unionId;
  }
  if (!body.scope || !(SCOPES as readonly string[]).includes(body.scope)) {
    return NextResponse.json({ error: "invalid scope" }, { status: 400 });
  }
  // A union-scope grant's id is the union itself, so scopeId is derived, not
  // supplied. Every other non-platform scope needs an explicit id.
  if (body.scope !== "platform" && body.scope !== "union" && !body.scopeId) {
    return NextResponse.json({ error: "scopeId is required unless scope is platform" }, { status: 400 });
  }
  // Insurance is bound per production — refuse org-/platform-wide insurer grants
  // even for admins (data minimisation). The union scope is union-watchers only.
  if (!isAllowedScopeForSubtype(body.subtype, body.scope)) {
    return NextResponse.json(
      { error: `insurer grants are limited to scopes: ${INSURER_ALLOWED_SCOPES.join(" | ")}` },
      { status: 400 },
    );
  }

  const db = getDb();
  const target = await db.select({ id: users.id, role: users.role, trueRole: users.trueRole }).from(users).where(eq(users.id, body.complianceUserId)).get();
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Effective role = true_role ?? role. Compliance accounts persist role="licensee"
  // with true_role="compliance", so check the effective role, not the raw column.
  if (!isComplianceRole(target.trueRole ?? target.role)) {
    return NextResponse.json({ error: "Target user is not a compliance account" }, { status: 400 });
  }

  // Route through createGrant so the per-subtype scope rules, union attribution and
  // idempotency live in one place.
  try {
    const id = await createGrant(db, {
      complianceUserId: body.complianceUserId,
      subtype: body.subtype as ComplianceSubtype,
      scope: body.scope as ComplianceScope,
      scopeId: body.scope === "platform" || body.scope === "union" ? null : (body.scopeId ?? null),
      unionId,
      grantedBy: session.sub,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof GrantScopeError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

