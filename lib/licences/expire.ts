import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { licences, bridgeGrants, renderBridgeAgents, organisationMembers, scanPackages, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { licenceEndedAttestationEmail } from "@/lib/email/templates";

const SCRUB_WINDOW_DAYS = 14;

/**
 * Transitions a single APPROVED licence to SCRUB_PERIOD.
 *
 * Safe to call concurrently — the update is guarded by status="APPROVED" so
 * only one caller will actually flip the state.
 *
 * Returns true if this call performed the transition, false if it was already
 * past APPROVED (another caller beat us, or the licence doesn't exist).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function beginScrubPeriod(db: DrizzleD1Database<any>, licenceId: string, now: number): Promise<boolean> {
  const lic = await db
    .select({
      id: licences.id,
      status: licences.status,
      licenseeId: licences.licenseeId,
      projectName: licences.projectName,
      packageId: licences.packageId,
      organisationId: licences.organisationId,
    })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  if (!lic || lic.status !== "APPROVED") return false;

  const scrubDeadline = now + SCRUB_WINDOW_DAYS * 86400;

  // Guard in the WHERE clause so concurrent callers are no-ops
  await db
    .update(licences)
    .set({ status: "SCRUB_PERIOD", revokedAt: now, scrubDeadline })
    .where(and(eq(licences.id, licenceId), eq(licences.status, "APPROVED")));

  await db
    .update(bridgeGrants)
    .set({ purgeRequestedAt: now })
    .where(
      and(
        eq(bridgeGrants.licenceId, licenceId),
        isNull(bridgeGrants.revokedAt),
        isNull(bridgeGrants.purgeRequestedAt),
      ),
    );

  if (lic.organisationId) {
    await db
      .update(renderBridgeAgents)
      .set({ pendingAction: "purge" })
      .where(
        and(
          eq(renderBridgeAgents.organisationId, lic.organisationId),
          isNull(renderBridgeAgents.revokedAt),
        ),
      );
  }

  void (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const attestUrl = `${baseUrl}/licences/${licenceId}/scrub`;

    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, lic.licenseeId)).get(),
      lic.packageId
        ? db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, lic.packageId)).get()
        : null,
    ]);

    if (!licenseeUser?.email) return;

    const packageName = pkg?.name ?? lic.packageId ?? "Unknown";
    const recipientEmails = new Set<string>([licenseeUser.email]);

    if (lic.organisationId) {
      const ownerMembers = await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, lic.organisationId),
            eq(organisationMembers.memberRole, "owner"),
          ),
        )
        .all();

      const ownerIds = ownerMembers.map((m) => m.userId).filter((uid) => uid !== lic.licenseeId);
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
        projectName: lic.projectName,
        packageName,
        endReason: "expired",
        scrubDeadline,
        attestUrl,
      });
      await sendEmail({ to, subject, html });
    }
  })();

  return true;
}
