export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { decideTransfer } from "@/lib/compliance/transfers";

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// PATCH /api/compliance/transfers/:id — admin (Union escrow) approves or denies (39.I).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  let body: { decision?: string; unionApproved?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const decision = body.decision;
  if (decision !== "approved" && decision !== "denied") {
    return NextResponse.json({ error: "decision must be 'approved' or 'denied'" }, { status: 400 });
  }

  const result = await decideTransfer(getDb(), {
    id,
    decision,
    unionApproved: body.unionApproved === true,
    decidedBy: session.sub,
    note: typeof body.note === "string" ? body.note : null,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });
  if (!result) return NextResponse.json({ error: "Transfer not found or already decided" }, { status: 409 });

  return NextResponse.json({ ok: true, ...result });
}
