import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { TRIAL_ENABLED_KEY, TRIAL_RUN_LIMIT_KEY } from "@/lib/monitor/trial";
import { eq } from "drizzle-orm";

const VALID_KEYS = [TRIAL_ENABLED_KEY, TRIAL_RUN_LIMIT_KEY];

/**
 * PATCH /api/admin/scout/settings
 * Body: { key, value } — the Likeness Scout feature toggle and default run
 * limit, stored in ai_settings like every other monitor control.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { key?: string; value?: string };
  const { key, value } = body;
  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }
  if (!VALID_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Invalid key. Must be one of: ${VALID_KEYS.join(", ")}` },
      { status: 400 }
    );
  }
  if (key === TRIAL_RUN_LIMIT_KEY) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return NextResponse.json({ error: "Run limit must be a whole number between 0 and 100" }, { status: 400 });
    }
  }
  if (key === TRIAL_ENABLED_KEY && value !== "true" && value !== "false") {
    return NextResponse.json({ error: "Enabled must be 'true' or 'false'" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ key: aiSettings.key })
    .from(aiSettings)
    .where(eq(aiSettings.key, key))
    .get();
  if (existing) {
    await db
      .update(aiSettings)
      .set({ value, updatedBy: session.sub, updatedAt: now })
      .where(eq(aiSettings.key, key));
  } else {
    await db.insert(aiSettings).values({ key, value, updatedBy: session.sub, updatedAt: now });
  }

  return NextResponse.json({ ok: true });
}
