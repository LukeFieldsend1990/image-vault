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
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  let aiEnv: { AI?: Ai; ANTHROPIC_API_KEY?: string };
  try {
    const { env: cfEnv } = getRequestContext();
    aiEnv = cfEnv as unknown as { AI?: Ai; ANTHROPIC_API_KEY?: string };
  } catch {
    aiEnv = {};
  }

  try {
    const result = await runSuggestionBatch(aiEnv, db);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Batch failed", stack: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    );
  }
}
