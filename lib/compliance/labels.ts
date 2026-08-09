/**
 * Human labels and severity for hash-chained ledger event types.
 *
 * This map had drifted into three copies — the certificate renderer, the
 * chain-of-custody record, and (about to be) the admin audit log — each with a
 * slightly different wording for the same event. Consolidated here so a reader
 * comparing a printed certificate against the audit log sees the same words for
 * the same thing.
 *
 * Severity is derived from the semantic tone the document palette already
 * assigns per event type, rather than being a second, independently-drifting
 * judgement about which events are grave.
 */

import { eventTone } from "@/lib/documents/palette";

export const LEDGER_EVENT_LABEL: Record<string, string> = {
  "consent.granted": "Consent granted",
  "consent.dub_language_granted": "Dub-language consent granted",
  "consent.revoked": "Consent withdrawn",
  "consent.counter_proposed": "Counter-terms proposed",
  "custody.licensee_verified": "Dual custody — licensee 2FA verified",
  "custody.talent_verified": "Dual custody — performer 2FA verified",
  "download.initiated": "Download initiated",
  "biometric.isolation_attested": "Biometric-isolation attestation",
  "security.custody_attested": "Custody controls attested",
  "replica.scrub_attested": "Scrub and deletion attested",
  "business_reason.recorded": "Business reason recorded",
  "training.notice_filed": "AI-training notice filed",
  "use.metered": "Metered use recorded",
  "use.blocked": "Use blocked",
  "use.blocked_by_strike": "Use blocked by strike",
  "transfer.requested": "Third-party transfer requested",
  "transfer.approved": "Third-party transfer approved",
  "transfer.denied": "Third-party transfer denied",
  "strike.declared": "Strike declared",
  "strike.lifted": "Strike lifted",
  "licence.denied": "Licence denied",
  "licence.revoked": "Licence revoked",
  "package.attached": "Scan package attached to licence",
  "data_controller.handover": "Data controller handed over",
};

/**
 * A readable label for a ledger event type. Unknown types degrade to their
 * de-punctuated identifier rather than disappearing — a new event type should
 * still be visible in an audit log before anyone gets around to naming it.
 */
export function ledgerEventLabel(eventType: string | null | undefined): string {
  if (!eventType) return "Ledger entry";
  return LEDGER_EVENT_LABEL[eventType] ?? eventType.replace(/[._]/g, " ");
}

export type LedgerSeverity = "info" | "warn" | "critical";

/**
 * Severity for the audit log's tri-state, mapped from the document palette's
 * semantic tone so the two surfaces cannot disagree:
 *
 *   brick → critical   a right was refused, revoked, withdrawn, or use blocked
 *   ochre → warn       a right was asked for, or an elevated-risk use is in play
 *   olive/ink → info   a right was granted or verified; or neutral bookkeeping
 */
export function ledgerSeverity(eventType: string): LedgerSeverity {
  switch (eventTone("compliance_event", eventType)) {
    case "brick":
      return "critical";
    case "ochre":
      return "warn";
    default:
      return "info";
  }
}
