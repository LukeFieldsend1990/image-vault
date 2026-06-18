export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { buildProductionsOverview } from "@/lib/compliance/productions";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/productions?regime=sag_aftra
// Read-only platform-wide productions tracker for the union/oversight view:
// every production with compliance health, cast onboarding and coverage gaps.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const productions = await buildProductionsOverview(db, regime);
  return NextResponse.json({ productions });
}
