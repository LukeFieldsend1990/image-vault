export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { liftStrike } from "@/lib/compliance/strike";

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// PATCH /api/compliance/strikes/:id — admin: lift an active strike.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const lifted = await liftStrike(getDb(), {
    id,
    liftedBy: session.sub,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });
  if (!lifted) return NextResponse.json({ error: "Strike not found or already lifted" }, { status: 409 });

  return NextResponse.json({ ok: true, id, status: "lifted" });
}
