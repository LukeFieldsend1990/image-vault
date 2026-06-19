import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { declareStrike, listStrikes, type StrikeScope } from "@/lib/compliance/strike";
import { notifyInsurersOfStrike } from "@/lib/notifications/insurer";

const SCOPES: StrikeScope[] = ["global", "organisation", "production", "licence"];

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// GET /api/compliance/strikes — admin: list all strikes (active + lifted).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const strikes = await listStrikes(getDb());
  return NextResponse.json({ strikes });
}

interface DeclareBody {
  scope?: string;
  scopeId?: string;
  reason?: string;
}

// POST /api/compliance/strikes — admin: declare a strike (39.G).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: DeclareBody;
  try {
    body = (await req.json()) as DeclareBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = body.scope as StrikeScope;
  if (!SCOPES.includes(scope)) {
    return NextResponse.json({ error: `scope must be one of ${SCOPES.join(", ")}` }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const scopeId = typeof body.scopeId === "string" ? body.scopeId.trim() : "";
  if (scope !== "global" && !scopeId) {
    return NextResponse.json({ error: "scopeId is required for non-global strikes" }, { status: 400 });
  }

  const db = getDb();
  const resolvedScopeId = scope === "global" ? null : scopeId;
  const result = await declareStrike(db, {
    scope,
    scopeId: resolvedScopeId,
    reason,
    declaredBy: session.sub,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });

  // Risk monitoring (§4.5): alert any insurer covering the affected production(s).
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(notifyInsurersOfStrike(db, { scope, scopeId: resolvedScopeId, reason }));
  } catch {
    // outside the edge request context (e.g. tests) — skip the side-effect
  }

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
