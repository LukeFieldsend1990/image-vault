export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { buildTalentDashboard } from "@/lib/compliance/dashboard";
import { isAdmin } from "@/lib/auth/adminEmails";
import type { RegimeId } from "@/lib/compliance/types";
import { and, eq } from "drizzle-orm";

// GET /api/compliance/talent-dashboard?regime=sag_aftra
// Powers the talent-side compliance dashboard. Admins can pass ?talentId= to inspect any talent.
// Reps must pass ?talentId= scoped to a talent they manage.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role === "licensee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";
  const db = getDb();

  let talentId: string;

  if (session.role === "admin" || isAdmin(session.email)) {
    talentId = sp.get("talentId") ?? session.sub;
  } else if (session.role === "rep") {
    const requestedId = sp.get("talentId");
    if (!requestedId) {
      return NextResponse.json({ error: "talentId required" }, { status: 400 });
    }
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, requestedId)))
      .get();
    if (!link) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    talentId = requestedId;
  } else {
    talentId = session.sub;
  }

  const data = await buildTalentDashboard(db, talentId, regime);
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(data);
}
