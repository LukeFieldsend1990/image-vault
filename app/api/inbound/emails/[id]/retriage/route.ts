export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  receivedEmails,
  receivedEmailRecipients,
  aiTriageResults,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { triageEmail } from "@/lib/inbound/triage";
import { getRequestContext } from "@cloudflare/next-on-pages";

// POST /api/inbound/emails/:id/retriage — re-run AI triage
export async function POST(
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

  // Get recipients for context
  const recipients = await db
    .select()
    .from(receivedEmailRecipients)
    .where(eq(receivedEmailRecipients.emailId, id))
    .all();

  let aiEnv: { AI?: Ai; ANTHROPIC_API_KEY?: string } = {};
  try {
    const { env } = getRequestContext();
    const e = env as unknown as Record<string, unknown>;
    aiEnv = { AI: e.AI as Ai | undefined, ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY as string | undefined };
  } catch {
    aiEnv = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  }

  const result = await triageEmail(
    aiEnv,
    db as Parameters<typeof triageEmail>[1],
    {
      subject: email.subject,
      textBody: email.normalizedText ?? email.textBody,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      recipients: recipients.map((r) => r.address),
    }
  );

  if (!result) {
    return NextResponse.json({ error: "AI triage failed" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const triageId = crypto.randomUUID();

  await db.insert(aiTriageResults).values({
    id: triageId,
    emailId: id,
    modelName: result.modelName,
    promptVersion: "v1",
    summary: result.summary,
    category: result.category,
    urgency: result.urgency,
    confidence: result.confidence,
    structuredDataJson: JSON.stringify(result.structuredData),
    recommendedAction: result.recommendedAction,
    riskFlagsJson: JSON.stringify(result.riskFlags),
    reviewStatus: "pending",
    createdAt: now,
  });

  return NextResponse.json({
    triageResult: {
      id: triageId,
      ...result,
    },
  });
}
