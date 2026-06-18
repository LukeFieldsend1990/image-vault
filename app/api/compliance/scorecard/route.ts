export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { buildOffenderScorecard } from "@/lib/compliance/scorecard";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/scorecard?regime=sag_aftra
// Read-only repeat-offender scorecard: production companies ranked by accumulated
// SAG-AFTRA compliance breaches (consent-before-use violations, coverage gaps, strikes).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const companies = await buildOffenderScorecard(db, regime);
  return NextResponse.json({ companies });
}
