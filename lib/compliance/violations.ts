// Consent-before-use detector (SAG-AFTRA Article 39.B — "consent must be in place
// before use"). The dashboard's `sag-39-b-consent` obligation reports the *current*
// state (is there a live consent for an active licence?). This detector adds the
// *temporal* dimension the union actually enforces on: was the performer's likeness
// downloaded / metered BEFORE any consent was recorded — a permanent historical
// violation that survives the licence later being closed or back-filled with consent.
//
// It is deliberately conservative: it only flags when the recorded evidence proves a
// use predates consent (or that a use happened with no consent on record at all), so
// it never produces a false "violation" from missing paperwork alone.

import { inArray } from "drizzle-orm";
import { complianceEvents } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { LicenceEventRow } from "./dashboard";

type Db = ReturnType<typeof getDb>;

export type UseViolationKind = "none" | "used_without_consent" | "used_before_consent";

export interface UseViolation {
  kind: UseViolationKind;
  firstUseAt: number | null;     // earliest provable use of the likeness (unix seconds)
  firstConsentAt: number | null; // earliest recorded 39.B consent (unix seconds)
  gapSeconds: number | null;     // how long the likeness was used before consent existed
}

const NO_VIOLATION: UseViolation = { kind: "none", firstUseAt: null, firstConsentAt: null, gapSeconds: null };

// Event types that prove the likeness was actually used.
const USE_EVENT_TYPES = ["use.metered"];
// Event types that record performer consent (a dub consent implies base 39.B consent).
const CONSENT_EVENT_TYPES = ["consent.granted", "consent.dub_language_granted"];

export function isViolation(kind: UseViolationKind): boolean {
  return kind === "used_without_consent" || kind === "used_before_consent";
}

/**
 * Classify one licence's consent-before-use posture from its ledger events plus the
 * `lastDownloadAt` stamp. Both a `use.metered` event and a download are genuine uses
 * of the likeness, so the true first use is no later than the earliest of the two —
 * taking the minimum keeps the detector from ever claiming a use earlier than the
 * evidence shows.
 */
export function detectUseViolation(
  licence: { lastDownloadAt: number | null },
  events: Pick<LicenceEventRow, "eventType" | "createdAt">[],
): UseViolation {
  let firstConsentAt: number | null = null;
  let firstMeteredUseAt: number | null = null;
  for (const e of events) {
    if (CONSENT_EVENT_TYPES.includes(e.eventType)) {
      if (firstConsentAt === null || e.createdAt < firstConsentAt) firstConsentAt = e.createdAt;
    } else if (USE_EVENT_TYPES.includes(e.eventType)) {
      if (firstMeteredUseAt === null || e.createdAt < firstMeteredUseAt) firstMeteredUseAt = e.createdAt;
    }
  }

  const useSignals = [firstMeteredUseAt, licence.lastDownloadAt].filter((t): t is number => t !== null);
  const firstUseAt = useSignals.length ? Math.min(...useSignals) : null;

  if (firstUseAt === null) return NO_VIOLATION; // never used → nothing to violate

  if (firstConsentAt === null) {
    return { kind: "used_without_consent", firstUseAt, firstConsentAt: null, gapSeconds: null };
  }
  if (firstUseAt < firstConsentAt) {
    return { kind: "used_before_consent", firstUseAt, firstConsentAt, gapSeconds: firstConsentAt - firstUseAt };
  }
  return { kind: "none", firstUseAt, firstConsentAt, gapSeconds: null };
}

/**
 * Batch consent-before-use detection for a set of licences. Fetches only the consent
 * and use events (one query, filtered by event type) and returns a violation per
 * licence id. Licences with no use signal are still present in the map with kind
 * "none" so callers can rely on `.get(id)`.
 */
export async function detectUseViolationsForLicences(
  db: Db,
  licences: { id: string; lastDownloadAt: number | null }[],
): Promise<Map<string, UseViolation>> {
  const result = new Map<string, UseViolation>();
  if (licences.length === 0) return result;

  const licenceIds = licences.map((l) => l.id);
  const relevantTypes = [...CONSENT_EVENT_TYPES, ...USE_EVENT_TYPES];
  const eventRows = await db
    .select({
      licenceId: complianceEvents.licenceId,
      eventType: complianceEvents.eventType,
      createdAt: complianceEvents.createdAt,
    })
    .from(complianceEvents)
    .where(inArray(complianceEvents.licenceId, licenceIds))
    .all();

  const eventsByLicence = new Map<string, { eventType: string; createdAt: number }[]>();
  for (const e of eventRows) {
    if (!e.licenceId || !relevantTypes.includes(e.eventType)) continue;
    const list = eventsByLicence.get(e.licenceId) ?? [];
    list.push({ eventType: e.eventType, createdAt: e.createdAt });
    eventsByLicence.set(e.licenceId, list);
  }

  for (const l of licences) {
    result.set(l.id, detectUseViolation(l, eventsByLicence.get(l.id) ?? []));
  }
  return result;
}
