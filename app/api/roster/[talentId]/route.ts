import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentReps, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { repEndedRepresentationEmail } from "@/lib/email/templates";

/**
 * DELETE /api/roster/:talentId
 * The authed rep ends their own representation of this talent, severing the
 * talent_reps link they never explicitly agreed to. Scoped to the rep's own
 * row — a rep can only remove themselves, never another rep. The talent is
 * notified by email.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ talentId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "rep") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { talentId } = await params;
  const db = getDb();

  const row = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, talentId)))
    .get();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(talentReps)
    .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, talentId)));

  // Notify the talent that their representative has stepped down.
  const [talent, profile] = await Promise.all([
    db.select({ email: users.email }).from(users).where(eq(users.id, talentId)).get(),
    db
      .select({ fullName: talentProfiles.fullName })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, talentId))
      .get(),
  ]);

  if (talent?.email) {
    const { subject, html } = repEndedRepresentationEmail({
      talentName: profile?.fullName ?? null,
      repEmail: session.email,
      endedAt: Math.floor(Date.now() / 1000),
    });
    await sendEmail({ to: talent.email, subject, html });
  }

  return NextResponse.json({ ok: true });
}
