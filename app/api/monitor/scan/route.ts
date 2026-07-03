import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { monitorScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { runLikenessScan } from "@/lib/monitor/scan";
import { and, eq, gt } from "drizzle-orm";

// POST /api/monitor/scan — run a likeness sweep for the session talent.
// Awaited server-side (one cost-tracked AI adjudication call); the client
// plays its per-platform progress animation while this request is in flight.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can run likeness scans" }, { status: 403 });
  }

  const db = getDb();

  // One scan at a time per talent; a "running" row younger than 2 minutes
  // means another request is mid-flight (older ones are treated as stale).
  const inFlight = await db
    .select({ id: monitorScans.id })
    .from(monitorScans)
    .where(
      and(
        eq(monitorScans.talentId, session.sub),
        eq(monitorScans.status, "running"),
        gt(monitorScans.startedAt, Math.floor(Date.now() / 1000) - 120)
      )
    )
    .get();
  if (inFlight) {
    return NextResponse.json({ error: "A scan is already in progress" }, { status: 409 });
  }

  let env: { AI?: Ai; ANTHROPIC_API_KEY?: string } = {};
  try {
    env = getCloudflareContext().env as unknown as { AI?: Ai; ANTHROPIC_API_KEY?: string };
  } catch {
    env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  const result = await runLikenessScan(env, db, {
    talentId: session.sub,
    trigger: "manual",
    baseUrl,
  });

  return NextResponse.json(result);
}
