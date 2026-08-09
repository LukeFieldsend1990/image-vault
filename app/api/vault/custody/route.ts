import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { buildLifetimeCustody, type LifetimeCustody } from "@/lib/compliance/lifetime";

/**
 * GET /api/vault/custody?talentId=…
 *
 * A performer's whole likeness history across every production. `talentId`
 * defaults to the caller, so a performer needs no parameter to see their own.
 *
 * Authorised the same way as the per-package custody record: the performer
 * themselves, a rep who actually represents them, or an admin. Reps are
 * first-class here rather than an afterthought — an agent producing a client's
 * lifetime record is the main reason this view exists.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const requested = new URL(req.url).searchParams.get("talentId");
  const talentId = requested && requested.trim() ? requested.trim() : session.sub;

  const isOwner = talentId === session.sub;
  const admin = isAdmin(session.email);
  const isRep = !isOwner && !admin && session.role === "rep" && (await hasRepAccess(session.sub, talentId));

  if (!isOwner && !isRep && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const custody: LifetimeCustody = await buildLifetimeCustody(db, talentId);

  return NextResponse.json(custody, { headers: { "Cache-Control": "no-store" } });
}
