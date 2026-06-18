// UK Equity — digital-likeness / AI obligations (first-pass draft).
//
// Grounded in the frameworks a UK production must satisfy to use a performer's
// digital likeness, pending formal Equity provisions review:
//   • UK GDPR / Data Protection Act 2018 — a biometric likeness is special-category
//     data (Art 9), so processing needs EXPLICIT consent, a specified lawful purpose
//     (Art 5(1)(b)), data minimisation (Art 5(1)(c)), and security (Art 5(1)(f)/32).
//   • Copyright, Designs and Patents Act 1988, Part II — the performer's consent to
//     record and exploit the performance.
//   • Equity "Stop AI Stealing the Show" / AI Toolkit — informed, specific, revocable
//     consent and fair remuneration for each use.
//
// Every obligation maps onto an EXISTING ledger event (the same ones SAG-AFTRA uses),
// so the dashboards, certificates, coverage-gap and consent-before-use detectors all
// work for Equity with no new event-emitting code. The platform scrub attestation
// (GDPR storage-limitation / erasure, Art 5(1)(e)) is injected for every regime by
// the dashboard builder, so it is not re-declared here.

import { registerRegime, isAiBearing } from "../registry";
import type { ComplianceObligation } from "../types";

const obligations: ComplianceObligation[] = [
  {
    id: "equity-explicit-consent",
    regime: "equity",
    clauseRef: "UK GDPR Art 9",
    title: "Explicit consent to biometric processing",
    description:
      "A digital likeness is special-category (biometric) personal data, so its processing requires the performer's " +
      "explicit, informed consent. Talent approving the licence constitutes that base consent for the stated use and " +
      "territory; further consents (additional territories, alterations) are tracked as supplementary ledger entries. " +
      "Consent is revocable at any time (UK GDPR Art 7(3)) — a withdrawal is recorded as a revoke event.",
    satisfiedBy: ["consent.granted"],
    severity: "required",
  },
  {
    id: "equity-performers-consent",
    regime: "equity",
    clauseRef: "CDPA 1988 Pt II",
    title: "Performer's consent to record & exploit",
    description:
      "Under the Copyright, Designs and Patents Act 1988 the performer must consent to the recording and exploitation " +
      "of their performance. The same licence approval that captures GDPR consent records this performers'-rights consent.",
    satisfiedBy: ["consent.granted"],
    severity: "required",
  },
  {
    id: "equity-specified-use",
    regime: "equity",
    clauseRef: "UK GDPR Art 5(1)(b)",
    title: "Specified, lawful purpose recorded",
    description:
      "Purpose limitation: the likeness may only be used for the specified, explicit purpose the performer consented to. " +
      "The licence itself (project, production company, licence type) records that purpose and is auto-logged at approval.",
    satisfiedBy: ["business_reason.recorded"],
    severity: "required",
  },
  {
    id: "equity-data-security",
    regime: "equity",
    clauseRef: "UK GDPR Art 32",
    title: "Security of the biometric data",
    description:
      "The producer attests to appropriate technical and organisational measures protecting the replica (integrity and " +
      "confidentiality, Art 5(1)(f)).",
    satisfiedBy: ["security.custody_attested"],
    severity: "required",
  },
  {
    id: "equity-data-minimisation",
    regime: "equity",
    clauseRef: "UK GDPR Art 5(1)(c)",
    title: "Data minimisation & isolation",
    description:
      "The producer attests the biometric data is isolated to this purpose and not replicated into their own custody for " +
      "unrelated uses (data minimisation / special-category safeguards).",
    satisfiedBy: ["biometric.isolation_attested"],
    severity: "required",
  },
  {
    id: "equity-fair-remuneration",
    regime: "equity",
    clauseRef: "Equity AI Toolkit",
    title: "Fair remuneration for each use metered",
    description:
      "Only applies to AI-bearing licences (ai_avatar / training_data, or the permit-AI-training flag). For those, each " +
      "replica use must be metered so the performer is fairly remunerated via the Live Royalty Meter (§15). Shown as n/a " +
      "for all other licence types.",
    satisfiedBy: ["use.metered"],
    appliesWhen: isAiBearing,
    severity: "required",
  },
  {
    id: "equity-dub-consent",
    regime: "equity",
    clauseRef: "Equity AI Toolkit",
    title: "Cross-language dubbing consent",
    description: "Separate, specific consent recorded for each language the replica is dubbed into.",
    satisfiedBy: ["consent.dub_language_granted"],
    appliesWhen: isAiBearing,
    severity: "recommended",
  },
  {
    id: "equity-ai-training-notice",
    regime: "equity",
    clauseRef: "Equity AI Toolkit",
    title: "AI-training use notice & consent",
    description:
      "Where the performance is licensed to train an AI model, a separate written notice and consent is filed. Only " +
      "assessed once a notice exists.",
    satisfiedBy: ["training.notice_filed"],
    triggeredBy: ["training.notice_filed"],
    appliesWhen: isAiBearing,
    severity: "recommended",
  },
  {
    id: "equity-onward-transfer",
    regime: "equity",
    clauseRef: "UK GDPR Art 28",
    title: "Approved onward transfer",
    description:
      "Any transfer of the replica to a third party must be approved before it commences (processor / onward-transfer " +
      "controls). Only assessed once a transfer is requested.",
    satisfiedBy: ["transfer.approved"],
    triggeredBy: ["transfer.requested"],
    severity: "required",
  },
];

registerRegime({
  id: "equity",
  name: "UK Equity — Digital Likeness",
  description: "UK digital-likeness obligations: UK GDPR special-category data, CDPA 1988 performers' rights, and Equity AI Toolkit principles.",
  obligations,
});
