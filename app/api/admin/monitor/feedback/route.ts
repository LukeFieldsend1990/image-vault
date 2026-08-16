import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getDetectionFeedbackSummary } from "@/lib/monitor/feedback";

/**
 * GET /api/admin/monitor/feedback
 *
 * The adjudication ledger read back as a tuning signal — outcome funnel,
 * dismissal/whitelist reason breakdowns, detector calibration by verdict,
 * and the per-talent split. All aggregation lives in
 * lib/monitor/feedback.ts, shared with the MCP detection-feedback tools.
 * The machine-readable labelled dataset is at ./export.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(await getDetectionFeedbackSummary(getDb()));
}
