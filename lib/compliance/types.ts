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
  | "use.metered";

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
