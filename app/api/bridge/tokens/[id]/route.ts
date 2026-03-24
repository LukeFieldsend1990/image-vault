export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bridgeTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

// DELETE /api/bridge/tokens/[id] — revoke a bridge token
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .update(bridgeTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(bridgeTokens.id, id),
        eq(bridgeTokens.userId, session.sub)
      )
    )
    .run();

  if (!result.meta?.changes) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
