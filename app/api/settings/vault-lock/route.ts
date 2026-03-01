export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// GET /api/settings/vault-lock — return current vault lock state
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const user = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  return NextResponse.json({ locked: user?.vaultLocked ?? false });
}

// POST /api/settings/vault-lock — toggle vault lock
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { locked?: boolean } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (typeof body.locked !== "boolean") {
    return NextResponse.json({ error: "locked (boolean) is required" }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(users)
    .set({ vaultLocked: body.locked })
    .where(eq(users.id, session.sub));

  return NextResponse.json({ locked: body.locked });
}
