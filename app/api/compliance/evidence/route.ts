import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceCertificates, organisations, productions, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getActiveGrants, hasGrantForScope } from "@/lib/compliance/grants";
import { evaluateScope, type CertScope } from "@/lib/compliance/certificate";
import type { RegimeId } from "@/lib/compliance/types";
import { and, eq, desc } from "drizzle-orm";

const SCOPES: CertScope[] = ["licence", "talent", "production", "organisation"];

// GET /api/compliance/evidence            → the caller's granted scopes (+ labels)
// GET /api/compliance/evidence?scope=&id= → read-only evidence for one granted scope
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isComplianceRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") as CertScope | null;
  const scopeId = sp.get("id");

  // No scope → list the caller's grants, resolving a human label per scope.
  if (!scope) {
    const grants = await getActiveGrants(db, session.sub);
    const withLabels = await Promise.all(
      grants.map(async (g) => ({ ...g, label: await scopeLabel(db, g.scope, g.scopeId) })),
    );
    return NextResponse.json({ grants: withLabels });
  }

  if (!SCOPES.includes(scope) || !scopeId) {
    return NextResponse.json({ error: "scope (licence|talent|production|organisation) and id are required" }, { status: 400 });
  }

  // Admins can view any scope; compliance users only their granted scopes.
  if (!isAdmin(session.email)) {
    const ok = await hasGrantForScope(db, session.sub, scope, scopeId);
    if (!ok) return NextResponse.json({ error: "No grant for this scope" }, { status: 403 });
  }

  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";
  const { obligations, events, licenceIds } = await evaluateScope(db, scope, scopeId, regime);

  const certs = await db
    .select({
      id: complianceCertificates.id,
      regime: complianceCertificates.regime,
      ledgerTipHash: complianceCertificates.ledgerTipHash,
      eventCount: complianceCertificates.eventCount,
      generatedAt: complianceCertificates.generatedAt,
    })
    .from(complianceCertificates)
    .where(and(eq(complianceCertificates.scope, scope), eq(complianceCertificates.scopeId, scopeId)))
    .orderBy(desc(complianceCertificates.generatedAt))
    .all();

  const requiredGaps = obligations.filter((o) => o.status === "gap" && o.severity === "required").length;

  return NextResponse.json({
    scope, scopeId, regime,
    label: await scopeLabel(db, scope, scopeId),
    licenceCount: licenceIds.length,
    eventCount: events.length,
    requiredGaps,
    obligations,
    // Evidence is read-only: surface event types + timestamps, not raw payloads.
    events: events.map((e) => ({ eventType: e.eventType, seq: e.seq, scope: e.scope })),
    certificates: certs,
  });
}

async function scopeLabel(db: ReturnType<typeof getDb>, scope: string, scopeId: string | null): Promise<string> {
  if (scope === "platform" || !scopeId) return "Platform-wide";
  try {
    if (scope === "organisation") {
      const o = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, scopeId)).get();
      return o?.name ?? scopeId;
    }
    if (scope === "production") {
      const p = await db.select({ name: productions.name }).from(productions).where(eq(productions.id, scopeId)).get();
      return p?.name ?? scopeId;
    }
    if (scope === "talent") {
      const u = await db.select({ email: users.email }).from(users).where(eq(users.id, scopeId)).get();
      return u?.email ?? scopeId;
    }
  } catch {
    // fall through
  }
  return scopeId;
}
