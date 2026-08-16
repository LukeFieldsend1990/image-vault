import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getDetectionFeedbackExamples } from "@/lib/monitor/feedback";

/**
 * GET /api/admin/monitor/feedback/export?format=json|jsonl
 *
 * The labelled dataset behind the feedback panel, as a downloadable file —
 * one row per human-labelled hit pairing discovery-time detector signals
 * with the verdict. Labelling rules and PII posture are documented on
 * getDetectionFeedbackExamples (lib/monitor/feedback.ts), which is shared
 * with the MCP export_detection_feedback_labels tool.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const format = req.nextUrl.searchParams.get("format") === "jsonl" ? "jsonl" : "json";
  const examples = await getDetectionFeedbackExamples(getDb());

  const generatedAt = Math.floor(Date.now() / 1000);
  const filename = `detection-feedback-${generatedAt}.${format}`;

  if (format === "jsonl") {
    return new NextResponse(examples.map((e) => JSON.stringify(e)).join("\n") + "\n", {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(JSON.stringify({ generatedAt, count: examples.length, examples }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
