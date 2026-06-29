// Compliance Layer types (SPEC §16).

export type RegimeId = "sag_aftra" | "equity" | "gdpr" | "bipa" | "platform";

// The ledger event-type vocabulary (§16.3). Kept as a string union so the DB
// column stays flexible while callers get autocomplete + type-checking.
export type ComplianceEventType =
  | "consent.granted"
  | "consent.dub_language_granted"
  | "consent.revoked"
  | "biometric.isolation_attested"
  | "security.custody_attested"
  | "strike.declared"
  | "strike.lifted"
  | "use.blocked_by_strike"
  | "use.blocked"
  | "transfer.requested"
  | "transfer.approved"
  | "transfer.denied"
  | "business_reason.recorded"
  | "training.notice_filed"
  | "use.metered"
  // Lifecycle / audit events — recorded for the chain of custody, not tied to an
  // obligation's satisfiedBy (so they never affect the health score).
  | "licence.denied"
  | "licence.revoked"
  | "replica.scrub_attested"
  | "package.attached"
  | "consent.counter_proposed";

// Scope dimensions carried on consent + use events.
export interface ComplianceScope {
  useType?: string;        // mirrors licenceType, or 'dub_language'
  territory?: string;      // ISO region | 'worldwide'
  language?: string;       // for 39.D dub consent
  validFrom?: number;      // unix seconds
  validTo?: number;        // unix seconds
  scriptedAlterations?: boolean; // 39.B — does this consent cover script-described alterations?
}

// The hashable content of a ledger event (everything that the hash commits to).
export interface LedgerEventInput {
  chainKey: string;
  seq: number;
  eventType: ComplianceEventType | string;
  payload: unknown;
}

export interface HashedEvent extends LedgerEventInput {
  prevHash: string;
  hash: string;
}

export type ChainVerification = { ok: true } | { ok: false; brokenAtSeq: number; reason: string };

// ── Regime framework (§16.4) ────────────────────────────────────────────────

// Minimal licence shape an obligation's `appliesWhen` predicate can inspect.
export interface LicenceLike {
  licenceType?: string | null;
  permitAiTraining?: boolean | null;
}

// A single regulatory obligation, code-defined (registry pattern, like lib/skills).
export interface ComplianceObligation {
  id: string; // e.g. "sag-39-d-dub-consent"
  regime: RegimeId;
  clauseRef: string; // e.g. "39.D"
  title: string;
  description: string;
  // Event types whose active presence discharges this obligation.
  satisfiedBy: ComplianceEventType[];
  // If set, the obligation is only assessed once one of these events exists;
  // otherwise it is reported "n/a" (e.g. transfer approval only matters once a
  // transfer is requested). Omit for always-assessed obligations.
  triggeredBy?: ComplianceEventType[];
  // Restrict applicability (e.g. AI-bearing licences only). Omit = always applies.
  appliesWhen?: (licence: LicenceLike) => boolean;
  severity: "required" | "recommended";
}

export interface ComplianceRegime {
  id: RegimeId;
  name: string;
  description: string;
  obligations: ComplianceObligation[];
}

// A ledger event reduced to what obligation evaluation needs.
export interface EvaluatedEvent {
  eventType: ComplianceEventType | string;
  scope?: ComplianceScope;
}

// "pending" = obligation exists but its clock hasn't started yet
// (e.g. scrub attestation on an active licence, or transfer approval before any transfer is requested).
// Pending items appear in the action queue but do NOT count against the health score.
export type ObligationStatus = "met" | "gap" | "n/a" | "pending";

export interface ObligationResult {
  id: string;
  clauseRef: string;
  title: string;
  severity: "required" | "recommended";
  status: ObligationStatus;
  satisfiedBy: ComplianceEventType[];
}
