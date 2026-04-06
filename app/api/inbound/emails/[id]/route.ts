export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  receivedEmails,
  receivedEmailRecipients,
  receivedEmailAttachments,
  aiTriageResults,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// GET /api/inbound/emails/:id — full email detail with AI results
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const email = await db
    .select()
    .from(receivedEmails)
    .where(and(eq(receivedEmails.id, id), eq(receivedEmails.ownerUserId, session.sub)))
    .get();

  if (!email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [recipients, attachments, triageResults] = await Promise.all([
    db
      .select()
      .from(receivedEmailRecipients)
      .where(eq(receivedEmailRecipients.emailId, id))
      .all(),
    db
      .select()
      .from(receivedEmailAttachments)
      .where(eq(receivedEmailAttachments.emailId, id))
      .all(),
    db
      .select()
      .from(aiTriageResults)
      .where(eq(aiTriageResults.emailId, id))
      .all(),
  ]);

  // Parse structured data JSON
  const triage = triageResults.map((tr) => ({
    ...tr,
    structuredData: tr.structuredDataJson ? JSON.parse(tr.structuredDataJson) : null,
    riskFlags: tr.riskFlagsJson ? JSON.parse(tr.riskFlagsJson) : [],
  }));

  return NextResponse.json({
    email: {
      ...email,
      rawHeadersJson: undefined, // Don't send raw headers by default
    },
    recipients,
    attachments,
    triageResults: triage,
  });
}
