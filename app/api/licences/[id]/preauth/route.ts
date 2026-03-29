export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// DELETE /api/licences/[id]/preauth — cancel pre-authorisation (talent or their rep)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const row = await db
    .select({ talentId: licences.talentId, preauthUntil: licences.preauthUntil })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Allow talent directly, or a rep representing this talent
  let allowed = row.talentId === session.sub;
  if (!allowed && session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(eq(talentReps.talentId, row.talentId))
      .get();
    allowed = !!link;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db
    .update(licences)
    .set({ preauthUntil: null, preauthSetBy: null })
    .where(eq(licences.id, id));

  // Also clear any pending preauth request in KV
  const kv = getKv();
  await kv.delete(`preauth_req:${id}`);

  return NextResponse.json({ ok: true });
}
