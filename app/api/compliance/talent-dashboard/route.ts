export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { buildTalentDashboard } from "@/lib/compliance/dashboard";
import { isAdmin } from "@/lib/auth/adminEmails";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/talent-dashboard?regime=sag_aftra
// Powers the talent-side compliance dashboard. Admins can pass ?talentId= to inspect any talent.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role === "licensee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";
  const adminUser = session.role === "admin" || isAdmin(session.email);

  const talentId = adminUser && sp.get("talentId")
    ? (sp.get("talentId") as string)
    : session.sub;

  const db = getDb();
  const data = await buildTalentDashboard(db, talentId, regime);
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(data);
}
