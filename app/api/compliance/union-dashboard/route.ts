import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isComplianceRole } from "@/lib/auth/roles";
import { getUnionIdsForUser } from "@/lib/compliance/grants";
import { buildUnionDashboard } from "@/lib/compliance/dashboard";
import { getUnionPreset, UNION_PRESETS } from "@/lib/compliance/unions";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/union-dashboard?unionId=
// Across-slate compliance for one union: KPIs, obligation progress, productions
// the union's affiliated talent are involved in, and obligations against the
// union's regime. Powers the rebuilt union evidence view (ComplianceClient,
// readOnly mode). Authorised for admins + watchers holding a grant for the
// requested union (platform- or union-scoped).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = isAdmin(session.email);
  if (!admin && !isComplianceRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const sp = new URL(req.url).searchParams;
  const unionId = sp.get("unionId");

  const allowed = admin ? UNION_PRESETS.map((u) => u.id) : await getUnionIdsForUser(db, session.sub);
  if (allowed.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const target = unionId && allowed.includes(unionId) ? unionId : allowed[0];
  if (!target) return NextResponse.json({ error: "No union grant" }, { status: 403 });

  const preset = getUnionPreset(target);
  const regime: RegimeId = (preset?.regimeId as RegimeId) ?? "sag_aftra";

  const data = await buildUnionDashboard(db, regime, target);
  return NextResponse.json(data);
}
