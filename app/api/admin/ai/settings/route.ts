export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

const VALID_KEYS = [
  "enabled",
  "fee_guidance_enabled",
  "licence_summary_enabled",
  "budget_ceiling_usd",
  "max_security_alerts_per_day",
  "vision_max_images",
  "metadata_tags_enabled",
];

/**
 * GET /api/admin/ai/settings
 * Returns all AI settings as a key-value map.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const rows = await db.select().from(aiSettings).all();

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  return NextResponse.json({ settings });
}

/**
 * PATCH /api/admin/ai/settings
 * Body: { key: string, value: string }
 * Upserts a single AI setting.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { key: string; value: string };
  const { key, value } = body;

  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  if (!VALID_KEYS.includes(key)) {
    return NextResponse.json({ error: `Invalid key. Must be one of: ${VALID_KEYS.join(", ")}` }, { status: 400 });
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
    await db.insert(aiSettings).values({
      key,
      value,
      updatedBy: session.sub,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true });
}
