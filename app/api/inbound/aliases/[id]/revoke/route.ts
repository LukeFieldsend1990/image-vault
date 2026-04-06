export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { inboundAliases } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// POST /api/inbound/aliases/:id/revoke
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const alias = await db
    .select()
    .from(inboundAliases)
    .where(and(eq(inboundAliases.id, id), eq(inboundAliases.ownerUserId, session.sub)))
    .get();

  if (!alias) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (alias.status === "revoked") {
    return NextResponse.json({ error: "Already revoked" }, { status: 409 });
  }

  await db
    .update(inboundAliases)
    .set({ status: "revoked" })
    .where(eq(inboundAliases.id, id));

  return NextResponse.json({ success: true });
}
