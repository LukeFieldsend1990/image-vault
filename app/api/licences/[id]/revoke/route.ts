export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, users, scanPackages, bridgeGrants } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, isNull } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceEndedAttestationEmail } from "@/lib/email/templates";

// Licensee gets this many days to attest deletion after licence ends.
const SCRUB_WINDOW_DAYS = 14;

// POST /api/licences/[id]/revoke — talent/rep revokes an approved licence
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent" && session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  const [licence] = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      packageId: licences.packageId,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (licence.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Only APPROVED licences can be revoked" }, { status: 409 });
  }
  if (!licence.packageId) {
    return NextResponse.json({ error: "Licence has no package attached" }, { status: 409 });
  }
  const licencePackageId = licence.packageId;

  // Kill any active dual-custody session in KV
  await kv.delete(`dual_custody:${id}`);

  const scrubDeadline = now + SCRUB_WINDOW_DAYS * 86400;

  await db
    .update(licences)
    .set({ status: "SCRUB_PERIOD", revokedAt: now, scrubDeadline })
    .where(eq(licences.id, id));

  // Signal every live bridge grant to purge its local cache. The bridge
  // picks this up on its next status poll (tight-poll mode kicks in until
  // purge-complete lands).
  await db
    .update(bridgeGrants)
    .set({ purgeRequestedAt: now })
    .where(
      and(
        eq(bridgeGrants.licenceId, id),
        isNull(bridgeGrants.revokedAt),
        isNull(bridgeGrants.purgeRequestedAt),
      ),
    );

  // Notify licensee (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licencePackageId)).get(),
    ]);
    if (!licenseeUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = licenceEndedAttestationEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: pkg?.name ?? licencePackageId,
      endReason: "revoked",
      scrubDeadline,
      attestUrl: `${baseUrl}/licences/${id}/scrub`,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
  })();

  return NextResponse.json({ ok: true, scrubDeadline });
}
