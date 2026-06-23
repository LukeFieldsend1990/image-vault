import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can set union affiliation" }, { status: 403 });
  }

  const body = await req.json() as { unionAffiliation?: string };
  const value = typeof body.unionAffiliation === "string" ? body.unionAffiliation.trim() || null : null;

  const db = getDb();
  await db
    .update(talentProfiles)
    .set({ unionAffiliation: value })
    .where(eq(talentProfiles.userId, session.sub));

  return NextResponse.json({ ok: true });
}
