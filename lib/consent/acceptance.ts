/**
 * Consent-document acceptance engine.
 *
 * Shared by the registered surface (POST /api/consent/[licenceId]/accept), the
 * public tokenised surface (guest accept on a cast row), and the registration
 * replay (turning a guest acceptance into ledger entries once an account exists).
 *
 * Registered acceptance writes the full consent ledger (consent_records +
 * compliance_events) via lib/compliance/consent, reconciling the granted set
 * with what the performer ticked (grants new, revokes removed). Guest acceptance
 * only records the document artifact + flips the cast row to `consented`; the
 * ledger is written later at registration replay.
 */

import { consentAcceptances, productionCast, licences } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { grantConsent, revokeConsent, listConsentRecords } from "@/lib/compliance/consent";
import { normaliseUseCategoryIds, type UseCategoryId } from "./use-categories";
import { CONSENT_DOCUMENT_VERSION } from "./document";

type Db = ReturnType<typeof getDb>;

async function sha256Hex(input: string | null | undefined): Promise<string | null> {
  if (!input) return null;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AcceptForLicenceInput {
  licenceId: string;
  talentId: string;
  /** Who clicked confirm (the talent, or a rep acting for them). */
  actorId: string;
  acceptedByEmail: string;
  acceptedByRole: "talent" | "rep";
  uses: string[];
  ip?: string | null;
  ua?: string | null;
}

export interface AcceptResult {
  acceptanceId: string;
  granted: UseCategoryId[];
  revoked: UseCategoryId[];
}

/**
 * Record a registered performer's (or agent's) consent. Reconciles the ledger
 * with the ticked set: grants newly-ticked categories, revokes un-ticked ones,
 * and flips the linked cast row to `consented`.
 */
export async function acceptConsentForLicence(db: Db, input: AcceptForLicenceInput): Promise<AcceptResult> {
  const desired = new Set<string>(normaliseUseCategoryIds(input.uses));
  const now = Math.floor(Date.now() / 1000);

  // Existing category-level granted records on this licence.
  const records = await listConsentRecords(db, input.licenceId);
  const grantedByCategory = new Map<string, string>(); // useType → recordId
  for (const r of records) {
    if (r.status === "granted" && !r.language) grantedByCategory.set(r.useType, r.id);
  }

  const granted: UseCategoryId[] = [];
  const revoked: UseCategoryId[] = [];

  // Grant newly-ticked categories.
  for (const use of desired) {
    if (grantedByCategory.has(use)) continue;
    await grantConsent({
      db,
      licenceId: input.licenceId,
      talentId: input.talentId,
      actorId: input.actorId,
      useType: use,
      ip: input.ip ?? null,
      ua: input.ua ?? null,
    });
    granted.push(use as UseCategoryId);
  }

  // Revoke categories that were granted but are no longer ticked.
  for (const [use, recordId] of grantedByCategory) {
    if (desired.has(use)) continue;
    await revokeConsent(db, { recordId, actorId: input.actorId, ip: input.ip ?? null, ua: input.ua ?? null });
    if (normaliseUseCategoryIds([use]).length) revoked.push(use as UseCategoryId);
  }

  const acceptanceId = crypto.randomUUID();
  await db.insert(consentAcceptances).values({
    id: acceptanceId,
    licenceId: input.licenceId,
    castId: null,
    talentId: input.talentId,
    acceptedByEmail: input.acceptedByEmail,
    acceptedByRole: input.acceptedByRole,
    usesConsentedJson: JSON.stringify([...desired]),
    documentVersion: CONSENT_DOCUMENT_VERSION,
    ipHash: await sha256Hex(input.ip),
    userAgentHash: await sha256Hex(input.ua),
    attestedAt: now,
    replayedAt: now,
  });

  // Flip the linked cast row to consented (if there is one).
  await db
    .update(productionCast)
    .set({ status: "consented" })
    .where(eq(productionCast.licenceId, input.licenceId));

  // Confirming consent also moves the licence forward (mirrors accept-invite):
  // a PENDING / AWAITING_PACKAGE licence becomes APPROVED, with the proposed fee
  // taken as agreed. The scan can still be attached later.
  const lic = await db
    .select({ status: licences.status, proposedFee: licences.proposedFee })
    .from(licences)
    .where(eq(licences.id, input.licenceId))
    .get();
  if (lic && (lic.status === "PENDING" || lic.status === "AWAITING_PACKAGE")) {
    const agreedFee = lic.proposedFee ?? null;
    const platformFee = agreedFee !== null ? Math.round(agreedFee * 0.15) : null;
    await db
      .update(licences)
      .set({ status: "APPROVED", approvedBy: input.actorId, approvedAt: now, agreedFee, platformFee })
      .where(eq(licences.id, input.licenceId));
  }

  return { acceptanceId, granted, revoked };
}

export interface AcceptForCastInput {
  castId: string;
  acceptedByEmail: string;
  uses: string[];
  ip?: string | null;
  ua?: string | null;
}

/**
 * Record an unregistered performer's consent via the public tokenised link. No
 * account/licence yet, so we only persist the document artifact and flip the
 * cast row to `consented`. The ledger is written at registration replay.
 */
export async function acceptConsentForCast(db: Db, input: AcceptForCastInput): Promise<{ acceptanceId: string }> {
  const desired = normaliseUseCategoryIds(input.uses);
  const now = Math.floor(Date.now() / 1000);

  const acceptanceId = crypto.randomUUID();
  await db.insert(consentAcceptances).values({
    id: acceptanceId,
    licenceId: null,
    castId: input.castId,
    talentId: null,
    acceptedByEmail: input.acceptedByEmail,
    acceptedByRole: "guest",
    usesConsentedJson: JSON.stringify(desired),
    documentVersion: CONSENT_DOCUMENT_VERSION,
    ipHash: await sha256Hex(input.ip),
    userAgentHash: await sha256Hex(input.ua),
    attestedAt: now,
    replayedAt: null,
  });

  await db.update(productionCast).set({ status: "consented" }).where(eq(productionCast.id, input.castId));

  return { acceptanceId };
}

/**
 * At registration, replay any un-replayed guest acceptance for a cast row into
 * the consent ledger now that a talent + licence exist. Best-effort.
 */
export async function replayCastAcceptance(
  db: Db,
  opts: { castId: string; licenceId: string; talentId: string; actorId: string },
): Promise<number> {
  const pending = await db
    .select({ id: consentAcceptances.id, usesConsentedJson: consentAcceptances.usesConsentedJson })
    .from(consentAcceptances)
    .where(and(eq(consentAcceptances.castId, opts.castId), isNull(consentAcceptances.replayedAt)))
    .all();
  const now = Math.floor(Date.now() / 1000);
  for (const acc of pending) {
    let uses: string[] = [];
    try { uses = normaliseUseCategoryIds(JSON.parse(acc.usesConsentedJson)); } catch { uses = []; }
    for (const use of uses) {
      await grantConsent({
        db,
        licenceId: opts.licenceId,
        talentId: opts.talentId,
        actorId: opts.actorId,
        useType: use,
      });
    }
    await db
      .update(consentAcceptances)
      .set({ licenceId: opts.licenceId, talentId: opts.talentId, replayedAt: now })
      .where(eq(consentAcceptances.id, acc.id));
  }
  return pending.length;
}
