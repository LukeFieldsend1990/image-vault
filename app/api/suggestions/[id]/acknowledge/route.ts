export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { suggestions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// PATCH /api/suggestions/:id/acknowledge — mark suggestion as acknowledged
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const result = await db
    .update(suggestions)
    .set({ acknowledgedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(suggestions.id, id), eq(suggestions.userId, session.sub)))
    .run();

  if (result.meta.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
