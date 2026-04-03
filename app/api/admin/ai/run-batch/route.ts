export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { runSuggestionBatch } from "@/lib/ai/suggestion-engine";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

/**
 * POST /api/admin/ai/run-batch
 * Admin-only manual trigger for the AI suggestion batch.
 * Uses waitUntil() to run in background — returns immediately.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  let aiEnv: { AI?: Ai; ANTHROPIC_API_KEY?: string };
  let ctx: ExecutionContext | null = null;
  try {
    const reqCtx = getRequestContext();
    aiEnv = reqCtx.env as unknown as { AI?: Ai; ANTHROPIC_API_KEY?: string };
    ctx = reqCtx.ctx;
  } catch {
    aiEnv = {};
  }

  if (ctx) {
    // Run batch in background via waitUntil — response returns immediately
    ctx.waitUntil(runSuggestionBatch(aiEnv, db, { manual: true }));
    return NextResponse.json({ status: "started", message: "Batch running in background. Check suggestions or costs panel for results." });
  }

  // Fallback: no execution context (local dev) — run synchronously
  try {
    const result = await runSuggestionBatch(aiEnv, db, { manual: true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Batch failed", stack: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    );
  }
}
