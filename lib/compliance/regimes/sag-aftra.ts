// SAG-AFTRA 2026 TV/Theatrical — Article 39 (Artificial Intelligence) obligations.
// Source: SPEC §16.3 clause→feature map (Summary of Tentative Agreement, pp.12–14).
// 39.F (minor protections) is deliberately omitted — out of demographic (SPEC §16.19).
// 39.A / 39.K are positioning context, not pass/fail obligations.
// 39.G (strike) is enforced + surfaced as strike status in the certificate rather
// than as a positive-evidence obligation, so it is not registered here.

import { registerRegime, isAiBearing } from "../registry";
import type { ComplianceObligation } from "../types";

const obligations: ComplianceObligation[] = [
  {
    id: "sag-39-b-consent",
    regime: "sag_aftra",
    clauseRef: "39.B",
    title: "Performer consent to the digital replica",
    description:
      "Talent approving the licence constitutes the base consent to the digital replica use for that project and territory. " +
      "Additional consents (cross-language dubs, alternate territories, rescripted alterations) can be added separately " +
      "via the compliance dashboard and are tracked as supplementary ledger entries.",
    satisfiedBy: ["consent.granted"],
    severity: "required",
  },
  {
    id: "sag-39-c-icdr-metering",
    regime: "sag_aftra",
    clauseRef: "39.C",
    title: "ICDR minimum payments & residuals metered",
    description:
      "Only applies to AI-bearing licences (licence type: ai_avatar or training_data, or permit-AI-training flag set). " +
      "For those licences, Independently Created Digital Replica uses must be metered for minimums and residuals " +
      "via the Live Royalty Meter (§15). Not required — and shown as n/a — for all other licence types.",
    satisfiedBy: ["use.metered"],
    appliesWhen: isAiBearing,
    severity: "required",
  },
  {
    id: "sag-39-d-dub-consent",
    regime: "sag_aftra",
    clauseRef: "39.D",
    title: "Cross-language dubbing consent",
    description: "Separate consent recorded for each language the replica is dubbed into.",
    satisfiedBy: ["consent.dub_language_granted"],
    appliesWhen: isAiBearing,
    severity: "recommended",
  },
  {
    id: "sag-39-e-biometric-isolation",
    regime: "sag_aftra",
    clauseRef: "39.E",
    title: "Biometric data isolation",
    description:
      "Producer attests biometric data is not replicated into their own custody for purposes unrelated to the picture.",
    satisfiedBy: ["biometric.isolation_attested"],
    severity: "required",
  },
  {
    id: "sag-39-h-security-custody",
    regime: "sag_aftra",
    clauseRef: "39.H",
    title: "Replica security & custody",
    description:
      "Producer attests to commercially reasonable efforts to limit access and protect the replica.",
    satisfiedBy: ["security.custody_attested"],
    severity: "required",
  },
  {
    id: "sag-39-i-transfer-approval",
    regime: "sag_aftra",
    clauseRef: "39.I",
    title: "Union-approved transfer",
    description:
      "Any third-party transfer of the replica is approved (transferee is Union-approved). Only assessed once a transfer is requested.",
    satisfiedBy: ["transfer.approved"],
    triggeredBy: ["transfer.requested"],
    severity: "required",
  },
  {
    id: "sag-39-j-business-reason",
    regime: "sag_aftra",
    clauseRef: "39.J",
    title: "Articulable business reason recorded",
    description:
      "The licence itself (project name, production company, and licence type) constitutes the recorded business reason. " +
      "This event is auto-fired at licence approval — no separate action required.",
    satisfiedBy: ["business_reason.recorded"],
    severity: "recommended",
  },
  {
    id: "sag-39-l-training-notice",
    regime: "sag_aftra",
    clauseRef: "39.L",
    title: "AI-training-data licensing notice",
    description:
      "Where the performance is licensed for AI training, a written notice is filed. Only assessed once a notice is filed.",
    satisfiedBy: ["training.notice_filed"],
    triggeredBy: ["training.notice_filed"],
    appliesWhen: isAiBearing,
    severity: "recommended",
  },
];

registerRegime({
  id: "sag_aftra",
  name: "SAG-AFTRA 2026 — Article 39",
  description: "US TV/Theatrical AI / digital-replica obligations (term 1 Jul 2026 – 30 Jun 2030).",
  obligations,
});
