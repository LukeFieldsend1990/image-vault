import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeScope } from "@/lib/compliance/access";
import { evaluateScope, type CertScope } from "@/lib/compliance/certificate";
import type { RegimeId } from "@/lib/compliance/types";

const SCOPES: CertScope[] = ["licence", "talent", "production", "organisation"];

// GET /api/compliance/status?scope=&id=&regime= — obligation matrix for a scope
// (no certificate generated). Powers the producer panel + admin overview.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") as CertScope;
  const scopeId = sp.get("id") ?? "";
  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";
  if (!SCOPES.includes(scope) || !scopeId) {
    return NextResponse.json({ error: "scope (licence|talent|production|organisation) and id are required" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authorizeScope(db, session, scope, scopeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { obligations, events, licenceIds } = await evaluateScope(db, scope, scopeId, regime);
  const gaps = obligations.filter((o) => o.status === "gap" && o.severity === "required").length;

  return NextResponse.json({
    scope,
    scopeId,
    regime,
    licenceCount: licenceIds.length,
    eventCount: events.length,
    requiredGaps: gaps,
    obligations,
  });
}
