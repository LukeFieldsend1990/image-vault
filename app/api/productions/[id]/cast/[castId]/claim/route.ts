import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { claimRole } from "@/lib/productions/claim";

// POST /api/productions/[id]/cast/[castId]/claim
// A talent claims a reserved placeholder role that matches them (Path D). The
// match is re-verified server-side; on success the cast row is linked and the
// production company is notified. Talent-only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent can claim a reserved role" }, { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const db = getDb();
  const result = await claimRole(db, { talentUserId: session.sub, productionId: id, castId, baseUrl });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true, productionId: result.productionId });
}
