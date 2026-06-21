import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { archiveMember, resolveRosterUnion } from "@/lib/compliance/members";

// DELETE /api/compliance/members/:id?unionId= — remove one member from a union's
// roster. Scoped to the caller's union so a watcher can't edit another union's list.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const ctx = await resolveRosterUnion(db, session, new URL(req.url).searchParams.get("unionId"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { id } = await params;
  const ok = await archiveMember(db, id, ctx.unionId);
  if (!ok) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
