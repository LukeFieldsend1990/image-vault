export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { receivedEmails, aiTriageResults } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc } from "drizzle-orm";

// GET /api/inbound/emails — list received emails for current user
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const emails = await db
    .select()
    .from(receivedEmails)
    .where(eq(receivedEmails.ownerUserId, session.sub))
    .orderBy(desc(receivedEmails.receivedAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Fetch latest triage results for each email
  const emailIds = emails.map((e) => e.id);
  const triageRows = emailIds.length > 0
    ? await db.select().from(aiTriageResults).all()
    : [];

  // Group by emailId, pick latest
  const triageByEmail = new Map<string, typeof triageRows[0]>();
  for (const tr of triageRows) {
    if (emailIds.includes(tr.emailId)) {
      const existing = triageByEmail.get(tr.emailId);
      if (!existing || tr.createdAt > existing.createdAt) {
        triageByEmail.set(tr.emailId, tr);
      }
    }
  }

  const result = emails.map((e) => {
    const triage = triageByEmail.get(e.id);
    return {
      id: e.id,
      fromName: e.fromName,
      fromEmail: e.fromEmail,
      subject: e.subject,
      receivedAt: e.receivedAt,
      processingStatus: e.processingStatus,
      routingStatus: e.routingStatus,
      threadKey: e.threadKey,
      triage: triage
        ? {
            summary: triage.summary,
            category: triage.category,
            urgency: triage.urgency,
            confidence: triage.confidence,
            recommendedAction: triage.recommendedAction,
            reviewStatus: triage.reviewStatus,
          }
        : null,
    };
  });

  return NextResponse.json({ emails: result, total: result.length });
}
