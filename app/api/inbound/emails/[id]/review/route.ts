export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { receivedEmails, aiTriageResults } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// POST /api/inbound/emails/:id/review — approve or reject AI triage result
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;

  let body: { triageId?: string; action?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.triageId || !body.action) {
    return NextResponse.json({ error: "triageId and action are required" }, { status: 400 });
  }

  if (!["approved", "rejected"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const db = getDb();

  // Verify ownership
  const email = await db
    .select({ id: receivedEmails.id })
    .from(receivedEmails)
    .where(and(eq(receivedEmails.id, id), eq(receivedEmails.ownerUserId, session.sub)))
    .get();

  if (!email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(aiTriageResults)
    .set({
      reviewStatus: body.action as "approved" | "rejected",
      reviewedBy: session.sub,
      reviewedAt: now,
    })
    .where(and(eq(aiTriageResults.id, body.triageId), eq(aiTriageResults.emailId, id)));

  return NextResponse.json({ success: true });
}
