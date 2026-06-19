import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { buildPlatformDashboard } from "@/lib/compliance/dashboard";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/platform-dashboard?regime=sag_aftra
// Read-only, platform-wide compliance control centre. Available to admins and to
// compliance watchers holding a platform-wide grant — they see every production,
// licence and obligation on the platform rather than a per-scope drill-down.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";

  const data = await buildPlatformDashboard(db, regime);
  return NextResponse.json(data);
}
