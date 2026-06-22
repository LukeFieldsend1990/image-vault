import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { findClaimableRoles } from "@/lib/productions/claim";

// GET /api/cast/claimable
// Reserved roles (open placeholders) that match the signed-in talent by tmdbId
// or name. Drives the dashboard "a production reserved a role for you" card and
// the inline claim prompt at the end of talent onboarding. Talent-only.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ roles: [] });
  }
  const db = getDb();
  const roles = await findClaimableRoles(db, session.sub);
  return NextResponse.json({ roles });
}
