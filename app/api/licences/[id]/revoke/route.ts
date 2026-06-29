import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, users, scanPackages, bridgeGrants, renderBridgeAgents, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceEndedAttestationEmail } from "@/lib/email/templates";
import { appendEventBg, licenceChain } from "@/lib/compliance/emit-bg";

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
      organisationId: licences.organisationId,
      productionId: licences.productionId,
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

  // Record the revocation in the compliance ledger (chain of custody).
  appendEventBg(db, {
    chainKey: licenceChain(id), eventType: "licence.revoked", clauseRef: "39.B",
    licenceId: id, talentId: licence.talentId, organisationId: licence.organisationId,
    actorId: session.sub, payload: { scrubDeadline, byRole: session.role },
  });

  // Signal every live bridge grant to purge its local cache.
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

  // Signal any render-bridge agents for this org to purge their local cache.
  if (licence.organisationId) {
    await db
      .update(renderBridgeAgents)
      .set({ pendingAction: "purge" })
      .where(
        and(
          eq(renderBridgeAgents.organisationId, licence.organisationId),
          isNull(renderBridgeAgents.revokedAt),
        )
      );
  }

  // Notify licensee + org owners (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg, orgOwnerMembers] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licencePackageId)).get(),
      licence.organisationId
        ? db
            .select({ userId: organisationMembers.userId })
            .from(organisationMembers)
            .where(
              and(
                eq(organisationMembers.organisationId, licence.organisationId),
                eq(organisationMembers.memberRole, "owner"),
              ),
            )
            .all()
        : Promise.resolve([] as { userId: string }[]),
    ]);

    if (!licenseeUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const attestUrl = `${baseUrl}/licences/${id}/scrub`;
    const packageName = pkg?.name ?? licencePackageId;

    // Collect all recipient emails — licensee + org owners (deduplicated)
    const recipientEmails = new Set<string>([licenseeUser.email]);
    if (orgOwnerMembers.length > 0) {
      const ownerIds = orgOwnerMembers.map((m) => m.userId).filter((uid) => uid !== licence.licenseeId);
      if (ownerIds.length > 0) {
        const ownerUsers = await db
          .select({ email: users.email })
          .from(users)
          .where(inArray(users.id, ownerIds))
          .all();
        for (const u of ownerUsers) {
          if (u.email) recipientEmails.add(u.email);
        }
      }
    }

    for (const to of recipientEmails) {
      const { subject, html } = licenceEndedAttestationEmail({
        licenseeEmail: licenseeUser.email,
        projectName: licence.projectName,
        packageName,
        endReason: "revoked",
        scrubDeadline,
        attestUrl,
      });
      await sendEmail({ to, subject, html });
    }
  })();

  return NextResponse.json({ ok: true, scrubDeadline });
}
