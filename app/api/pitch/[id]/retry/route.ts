import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { pitchVignettes, talentReps, talentProfiles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// POST /api/pitch/:id/retry — re-queue a failed pitch vignette.
// Only reps managing the talent (or admins) can retry, mirroring generation.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  if (session.role !== "rep" && !admin) {
    return NextResponse.json({ error: "Only reps can retry pitch vignettes" }, { status: 403 });
  }

  const vignette = await db.select({
    id: pitchVignettes.id,
    talentId: pitchVignettes.talentId,
    status: pitchVignettes.status,
    deletedAt: pitchVignettes.deletedAt,
  })
    .from(pitchVignettes)
    .where(eq(pitchVignettes.id, id))
    .get();

  if (!vignette || vignette.deletedAt !== null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Rep must manage this talent
  if (!admin) {
    const link = await db.select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, vignette.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only retry terminal failures — don't disturb an in-flight job.
  if (vignette.status !== "failed") {
    return NextResponse.json({ error: "Only failed vignettes can be retried" }, { status: 409 });
  }

  // Respect a talent opting out between generation and retry.
  const profile = await db.select({ pitchVignettesEnabled: talentProfiles.pitchVignettesEnabled })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, vignette.talentId))
    .get();

  if (profile && profile.pitchVignettesEnabled === false) {
    return NextResponse.json({ error: "Talent has disabled pitch vignette generation" }, { status: 403 });
  }

  // Reset to a clean pending state, clearing the prior attempt's artefacts.
  await db.update(pitchVignettes)
    .set({
      status: "pending",
      error_text: null,
      higgsfield_job_id: null,
      output_r2_key: null,
      completedAt: null,
    })
    .where(eq(pitchVignettes.id, id));

  const { env } = getCloudflareContext();
  const queue = (env as unknown as { PITCH_QUEUE?: Queue }).PITCH_QUEUE;
  if (queue) {
    await queue.send({ pitchId: id });
  }

  return NextResponse.json({ id, status: "pending" });
}
