import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessMonitors } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getMonitorState } from "@/lib/monitor/scan";
import { eq } from "drizzle-orm";

// GET /api/monitor — monitor config + recorded hits + scan history for the session talent
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts have a likeness monitor" }, { status: 403 });
  }

  const db = getDb();
  const state = await getMonitorState(db, session.sub);
  return NextResponse.json(state);
}

// PATCH /api/monitor — update monitor config (status active/paused, sensitivity)
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts have a likeness monitor" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { status?: string; sensitivity?: string };
  const updates: Partial<{ status: "active" | "paused"; sensitivity: "strict" | "balanced" | "relaxed" }> = {};
  if (body.status === "active" || body.status === "paused") updates.status = body.status;
  if (body.sensitivity === "strict" || body.sensitivity === "balanced" || body.sensitivity === "relaxed") {
    updates.sensitivity = body.sensitivity;
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = getDb();
  const monitor = await db
    .select({ id: likenessMonitors.id })
    .from(likenessMonitors)
    .where(eq(likenessMonitors.talentId, session.sub))
    .get();
  if (!monitor) {
    return NextResponse.json({ error: "No monitor yet — run a scan first" }, { status: 404 });
  }

  await db
    .update(likenessMonitors)
    .set({ ...updates, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(likenessMonitors.id, monitor.id));

  return NextResponse.json({ ok: true });
}
