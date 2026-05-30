export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeProducer } from "@/lib/compliance/access";
import { recordBusinessReason, fileTrainingNotice } from "@/lib/compliance/notices";

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// POST /api/compliance/business-reason — producer/admin records a 39.J reason.
// Pass { trainingNotice: true } to file a 39.L training-data notice instead.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { licenceId?: string; reason?: string; trainingNotice?: boolean; detail?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const licenceId = typeof body.licenceId === "string" ? body.licenceId : "";
  if (!licenceId) return NextResponse.json({ error: "licenceId is required" }, { status: 400 });

  const db = getDb();
  const auth = await authorizeProducer(db, session, licenceId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (body.trainingNotice === true) {
    const ev = await fileTrainingNotice(db, {
      licenceId,
      organisationId: auth.licence.organisationId,
      actorId: session.sub,
      detail: body.detail,
      ip: clientIp(req),
      ua: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, eventId: ev.id, clause: "39.L" }, { status: 201 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });

  const ev = await recordBusinessReason(db, {
    licenceId,
    organisationId: auth.licence.organisationId,
    actorId: session.sub,
    reason,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, eventId: ev.id, clause: "39.J" }, { status: 201 });
}
