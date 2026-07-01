import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { listRateCards, upsertRateCard, deleteRateCard, RATE_CARD_CATEGORIES } from "@/lib/rsl/rateCard";

/**
 * Talent AI rate card. A talent manages their own; a rep manages a managed
 * talent's (via ?talentId=); an admin manages anyone's.
 */
async function resolveTalentId(
  session: { sub: string; email: string; role: string },
  requested: string | null,
): Promise<string | null> {
  const target = requested && requested.trim() ? requested.trim() : session.sub;
  if (target === session.sub) return target;
  if (isAdmin(session.email)) return target;
  if (session.role === "rep" && (await hasRepAccess(session.sub, target))) return target;
  return null;
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const target = await resolveTalentId(session, req.nextUrl.searchParams.get("talentId"));
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = getDb();
  return NextResponse.json({ talentId: target, cards: await listRateCards(db, target) });
}

// PUT — upsert one category's rate card.
// Body: { talentId?, useCategoryId, unitType, unitRatePence, upfrontFeePence?, termDays?, autoAccept?, active? }
export async function PUT(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const target = await resolveTalentId(session, typeof body.talentId === "string" ? body.talentId : null);
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const useCategoryId = typeof body.useCategoryId === "string" ? body.useCategoryId : "";
  if (!(RATE_CARD_CATEGORIES as readonly string[]).includes(useCategoryId)) {
    return NextResponse.json({ error: "useCategoryId must be 'training' or 'replica'" }, { status: 400 });
  }
  if (typeof body.unitRatePence !== "number" || body.unitRatePence < 0) {
    return NextResponse.json({ error: "unitRatePence (cents) required" }, { status: 400 });
  }

  const db = getDb();
  const card = await upsertRateCard(db, target, useCategoryId, {
    unitType: typeof body.unitType === "string" ? body.unitType : "per_generation",
    unitRatePence: body.unitRatePence,
    upfrontFeePence: typeof body.upfrontFeePence === "number" ? body.upfrontFeePence : null,
    termDays: typeof body.termDays === "number" ? body.termDays : undefined,
    autoAccept: typeof body.autoAccept === "boolean" ? body.autoAccept : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
  });
  return NextResponse.json({ ok: true, card });
}

// DELETE ?talentId=&useCategoryId=
export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const target = await resolveTalentId(session, req.nextUrl.searchParams.get("talentId"));
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const useCategoryId = req.nextUrl.searchParams.get("useCategoryId") ?? "";
  if (!(RATE_CARD_CATEGORIES as readonly string[]).includes(useCategoryId)) {
    return NextResponse.json({ error: "invalid useCategoryId" }, { status: 400 });
  }
  const db = getDb();
  await deleteRateCard(db, target, useCategoryId);
  return NextResponse.json({ ok: true });
}
