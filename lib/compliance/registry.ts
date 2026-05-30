// Multi-regime compliance registry (SPEC §16.4).
//
// Regimes register their obligations at import time (mirroring the lib/skills
// pattern — in-memory, type-safe, zero cold-start). The certificate generator
// and the obligation-matrix dashboards walk these definitions and evaluate them
// against the ledger.

import type {
  ComplianceObligation,
  ComplianceRegime,
  EvaluatedEvent,
  LicenceLike,
  ObligationResult,
  RegimeId,
} from "./types";

const REGIMES = new Map<RegimeId, ComplianceRegime>();

export function registerRegime(regime: ComplianceRegime): void {
  REGIMES.set(regime.id, regime);
}

export function getRegime(id: RegimeId): ComplianceRegime | undefined {
  return REGIMES.get(id);
}

export function listRegimes(): ComplianceRegime[] {
  return Array.from(REGIMES.values());
}

export function listObligations(id: RegimeId): ComplianceObligation[] {
  return REGIMES.get(id)?.obligations ?? [];
}

// AI-bearing test, shared with the royalty meter's definition (ai_avatar /
// training_data licence types, or an explicit permit-AI-training flag).
const AI_LICENCE_TYPES = new Set(["ai_avatar", "training_data"]);
export function isAiBearing(licence: LicenceLike): boolean {
  return (
    (licence.licenceType != null && AI_LICENCE_TYPES.has(licence.licenceType)) ||
    licence.permitAiTraining === true
  );
}

// Canonical scope key for consent cancellation — a revoke cancels a grant with
// the same (useType, territory, language) tuple.
function scopeKey(e: EvaluatedEvent): string {
  const s = e.scope ?? {};
  return `${s.useType ?? ""}|${s.territory ?? ""}|${s.language ?? ""}`;
}

// Reduce events to the set of event types that are "active" — for consent
// grants, a matching revoke cancels the grant; everything else counts as active
// by mere presence. Revokes themselves are never satisfying events.
export function activeEventTypes(events: EvaluatedEvent[]): Set<string> {
  const active = new Set<string>();

  // Net grants per (type, scope-key): grant +1, matching revoke -1.
  const consentNet = new Map<string, number>();
  const GRANT_TYPES = new Set(["consent.granted", "consent.dub_language_granted"]);

  for (const e of events) {
    if (GRANT_TYPES.has(e.eventType)) {
      const k = `${e.eventType}#${scopeKey(e)}`;
      consentNet.set(k, (consentNet.get(k) ?? 0) + 1);
    } else if (e.eventType === "consent.revoked") {
      // A revoke cancels one grant of either grant type with the same scope key.
      for (const gt of GRANT_TYPES) {
        const k = `${gt}#${scopeKey(e)}`;
        if ((consentNet.get(k) ?? 0) > 0) {
          consentNet.set(k, (consentNet.get(k) as number) - 1);
          break;
        }
      }
    } else {
      active.add(e.eventType);
    }
  }

  for (const [k, net] of consentNet) {
    if (net > 0) active.add(k.split("#")[0]);
  }
  return active;
}

// Evaluate every applicable obligation of a regime against a licence's events.
// Obligations whose `appliesWhen` excludes the licence are omitted entirely;
// `triggeredBy` obligations with no triggering event are reported "n/a".
export function evaluateObligations(
  regimeId: RegimeId,
  licence: LicenceLike,
  events: EvaluatedEvent[],
): ObligationResult[] {
  const obligations = listObligations(regimeId);
  const active = activeEventTypes(events);
  const presentTypes = new Set(events.map((e) => e.eventType));
  const results: ObligationResult[] = [];

  for (const o of obligations) {
    if (o.appliesWhen && !o.appliesWhen(licence)) continue;

    let status: ObligationResult["status"];
    if (o.triggeredBy && !o.triggeredBy.some((t) => presentTypes.has(t))) {
      status = "n/a";
    } else {
      status = o.satisfiedBy.some((t) => active.has(t)) ? "met" : "gap";
    }

    results.push({
      id: o.id,
      clauseRef: o.clauseRef,
      title: o.title,
      severity: o.severity,
      status,
      satisfiedBy: o.satisfiedBy,
    });
  }
  return results;
}
