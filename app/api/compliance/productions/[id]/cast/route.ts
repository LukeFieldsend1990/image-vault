import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { getProductionCast } from "@/lib/compliance/productions";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/productions/:id/cast?regime=sag_aftra
// Read-only cast roster for one production with per-member coverage-gap flags.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const detail = await getProductionCast(db, id, regime);
  if (!detail) return NextResponse.json({ error: "Production not found" }, { status: 404 });
  return NextResponse.json(detail);
}
