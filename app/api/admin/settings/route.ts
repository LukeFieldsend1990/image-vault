import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { siteSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

const VALID_KEYS = [
  "demo_enabled",
  "royalty_meter_enabled",
];

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "admin" && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const rows = await db.select().from(siteSettings).all();
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;

  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "admin" && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const existing = await db.select({ key: siteSettings.key }).from(siteSettings).where(eq(siteSettings.key, key)).get();

  if (existing) {
    await db.update(siteSettings).set({ value, updatedBy: session.sub, updatedAt: now }).where(eq(siteSettings.key, key));
  } else {
    await db.insert(siteSettings).values({ key, value, updatedBy: session.sub, updatedAt: now });
  }

  return NextResponse.json({ ok: true });
}
