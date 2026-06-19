import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/settings/pitch-vignettes — return current opt-in state
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const row = await db
    .select({ pitchVignettesEnabled: talentProfiles.pitchVignettesEnabled })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.sub))
    .get();

  return NextResponse.json({ enabled: row?.pitchVignettesEnabled ?? false });
}

// POST /api/settings/pitch-vignettes — update opt-in state
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { enabled?: boolean } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(talentProfiles)
    .set({ pitchVignettesEnabled: body.enabled })
    .where(eq(talentProfiles.userId, session.sub));

  return NextResponse.json({ enabled: body.enabled });
}
