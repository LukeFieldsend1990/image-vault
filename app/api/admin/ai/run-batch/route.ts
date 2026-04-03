export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { callAiService } from "@/lib/ai/service";

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
  return callAiService(req, session, "/batch/run", { method: "POST" });
}
