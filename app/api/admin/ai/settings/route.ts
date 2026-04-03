export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

const VALID_KEYS = [
  "enabled",
  "fee_guidance_enabled",
  "licence_summary_enabled",
  "budget_ceiling_usd",
  "max_security_alerts_per_day",
];

/**
 * GET /api/admin/ai/settings
 * Returns all AI settings as a key-value map.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
