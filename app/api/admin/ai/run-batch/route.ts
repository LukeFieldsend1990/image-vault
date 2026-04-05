export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { callAiCronService } from "@/lib/ai/service";

/**
 * POST /api/admin/ai/run-batch
 * Admin-only manual trigger for the AI suggestion batch.
 * Uses waitUntil() to run in background — returns immediately.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return callAiCronService(req, session, "/batch/run", { method: "POST" });
}
