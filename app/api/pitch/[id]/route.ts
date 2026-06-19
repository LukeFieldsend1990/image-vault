import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { pitchVignettes, talentReps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function authorisePitchAccess(
  session: { sub: string; role: string; email: string },
  pitchTalentId: string,
  db: ReturnType<typeof getDb>,
  admin: boolean
): Promise<boolean> {
  if (admin || session.sub === pitchTalentId) return true;
  if (session.role !== "rep") return false;
  const link = await db.select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, pitchTalentId)))
    .get();
  return !!link;
}

// GET /api/pitch/:id — fetch vignette + current status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  const vignette = await db.select().from(pitchVignettes)
    .where(eq(pitchVignettes.id, id)).get();

  if (!vignette || vignette.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = await authorisePitchAccess(session, vignette.talentId, db, admin);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ vignette });
}

// DELETE /api/pitch/:id — soft delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  const vignette = await db.select({ id: pitchVignettes.id, talentId: pitchVignettes.talentId, createdBy: pitchVignettes.createdBy, deletedAt: pitchVignettes.deletedAt })
    .from(pitchVignettes)
    .where(eq(pitchVignettes.id, id)).get();

  if (!vignette || vignette.deletedAt !== null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only the creator, the talent, or admin can delete
  if (!admin && session.sub !== vignette.createdBy && session.sub !== vignette.talentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.update(pitchVignettes)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(pitchVignettes.id, id));

  return NextResponse.json({ ok: true });
}
