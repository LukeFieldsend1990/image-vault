// Org-level compliance dashboard aggregation — powers the Vanta-like control centre.
//
// Loads all licences for an org, evaluates SAG-AFTRA (or other regime) obligations
// per production group, and returns health scores, obligation summaries, and a
// prioritised action queue with deadline labels.
//
// Key design decisions:
// - Each licence is evaluated INDEPENDENTLY; the production card shows the WORST
//   status per obligation across all licences (one gap on one licence = production gap).
// - A synthetic "scrub attestation" obligation is injected based on licence lifecycle:
//   pending (active), gap (scrub period/expired/closed), met (attested), n/a (denied).
// - "pending" obligations do NOT count against the health score.

import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  complianceCertificates,
  complianceEvents,
  licences,
  organisations,
  productionCast,
  productions,
  replicaTransfers,
  strikeLocks,
  users,
} from "@/lib/db/schema";
import { evaluateObligations } from "./registry";
import "./regimes";
import type { getDb } from "@/lib/db";
import type { ComplianceEventType, EvaluatedEvent, LicenceLike, ObligationResult, RegimeId } from "./types";

type Db = ReturnType<typeof getDb>;

export type ComplianceStatus = "compliant" | "partial" | "gap" | "critical";

export interface ObligationEvidence {
  eventType: string;
  seq: number;
  createdAt: number;
  hash: string;
  scope: Record<string, unknown>;
}

export interface ObligationResultWithEvidence extends ObligationResult {
  evidence: ObligationEvidence | null;  // satisfying event (met), null otherwise
}

export interface LicenceSummary {
  id: string;
  projectName: string;
  licenceType: string | null;
  status: string;
  obligations: ObligationResultWithEvidence[];
}

export interface CastOnboarding {
  total: number;       // all cast rows for this production
  consented: number;   // licence APPROVED — fully onboarded
  linked: number;      // account exists but licence pending/awaiting package
  invited: number;     // invite sent, no account yet
  pct: number;         // consented / total * 100 (0 if total=0 treated as n/a)
}

export interface ProductionCompliance {
  id: string | null;
  name: string;
  type: string | null;
  sagProjectNumber: string | null;
  licenceCount: number;
  healthScore: number;
  complianceStatus: ComplianceStatus;
  requiredGaps: number;
  obligations: ObligationResult[];
  licences: LicenceSummary[];
  castOnboarding: CastOnboarding | null;  // null if no production_cast rows
}

export interface ObligationSummaryItem {
  id: string;
  clauseRef: string;
  title: string;
  severity: "required" | "recommended";
  metCount: number;
  gapCount: number;
  naCount: number;
  pendingCount: number;
  progressPct: number;
}

export interface ActionItem {
  productionName: string;
  licenceId: string;
  licenceProjectName: string;
  obligationId: string;
  clauseRef: string;
  title: string;
  severity: "required" | "recommended";
  action: string;
  actionOwner: "producer" | "talent" | "platform";
  urgency: "critical" | "soon" | "upcoming" | "info" | "pending";
  deadlineLabel: string | null;
}

export interface DashboardData {
  orgId: string;
  orgName: string;
  regime: RegimeId;
  healthScore: number;
  complianceStatus: ComplianceStatus;
  summary: {
    totalProductions: number;
    compliantProductions: number;
    totalLicences: number;
    requiredGapsTotal: number;
    activeStrikes: number;
    pendingTransfers: number;
  };
  productions: ProductionCompliance[];
  obligationSummary: ObligationSummaryItem[];
  actionItems: ActionItem[];
  recentCertificates: Array<{
    id: string;
    scope: string;
    generatedAt: number;
  }>;
}

// Human-readable remediation steps per obligation ID
const REMEDIATION: Record<string, { action: string; owner: "producer" | "talent" | "platform" }> = {
  "sag-39-b-consent": {
    action: "Obtain performer consent to the digital replica",
    owner: "talent",
  },
  "sag-39-c-icdr-metering": {
    action: "Enable ICDR use metering for this licence",
    owner: "platform",
  },
  "sag-39-d-dub-consent": {
    action: "Record cross-language dubbing consent from performer",
    owner: "talent",
  },
  "sag-39-e-biometric-isolation": {
    action: "Submit biometric data isolation attestation",
    owner: "producer",
  },
  "sag-39-h-security-custody": {
    action: "Submit replica security & custody attestation",
    owner: "producer",
  },
  "sag-39-i-transfer-approval": {
    action: "Obtain union-approved transfer authorisation",
    owner: "producer",
  },
  "sag-39-j-business-reason": {
    action: "Record an articulable business reason for this licence",
    owner: "producer",
  },
  "sag-39-l-training-notice": {
    action: "File written AI training-data licensing notice",
    owner: "producer",
  },
  "platform-scrub-attestation": {
    action: "Attest deletion of all replica assets after licence expiry",
    owner: "producer",
  },
};

// Days from licence creation (or first download) by which each obligation must be met.
const DEADLINE_DAYS: Record<string, number> = {
  "sag-39-b-consent": 0,              // must be in place before use
  "sag-39-e-biometric-isolation": 7,  // 7 days from licence grant
  "sag-39-h-security-custody": 30,    // 30 days from first download
  "sag-39-i-transfer-approval": 0,    // before transfer commences
};

// "pending" does NOT count against health score — it's a future obligation.
function computeHealthScore(obligations: ObligationResult[]): number {
  const required = obligations.filter(
    (o) => o.severity === "required" && o.status !== "n/a" && o.status !== "pending",
  );
  if (required.length === 0) return 100;
  const met = required.filter((o) => o.status === "met").length;
  return Math.round((met / required.length) * 100);
}

function scoreToStatus(score: number): ComplianceStatus {
  if (score === 100) return "compliant";
  if (score >= 70) return "partial";
  if (score >= 40) return "gap";
  return "critical";
}

function computeUrgency(
  obligationId: string,
  severity: "required" | "recommended",
  licenceCreatedAt: number,
  lastDownloadAt: number | null,
): { urgency: "critical" | "soon" | "upcoming" | "info"; deadlineLabel: string | null } {
  const now = Math.floor(Date.now() / 1000);
  const deadlineDays = DEADLINE_DAYS[obligationId];

  if (deadlineDays !== undefined) {
    const startAt =
      obligationId === "sag-39-h-security-custody" && lastDownloadAt
        ? lastDownloadAt
        : licenceCreatedAt;
    const deadlineAt = startAt + deadlineDays * 86400;
    const daysRemaining = Math.ceil((deadlineAt - now) / 86400);

    if (daysRemaining <= 0) return { urgency: "critical", deadlineLabel: "Overdue" };
    if (daysRemaining <= 3) return { urgency: "critical", deadlineLabel: `Due in ${daysRemaining}d` };
    if (daysRemaining <= 14) return { urgency: "soon", deadlineLabel: `Due in ${daysRemaining}d` };
    return { urgency: "upcoming", deadlineLabel: `Due in ${daysRemaining}d` };
  }

  if (severity === "required") return { urgency: "soon", deadlineLabel: null };
  return { urgency: "info", deadlineLabel: null };
}

// ── Scrub obligation ──────────────────────────────────────────────────────────
//
// Platform-level obligation: after a licence expires the producer must attest
// they have deleted all replica assets (anything the render bridge didn't
// automatically clean up). Tracked via licences.scrub_attested_at.
//
// Status derivation:
//   scrubAttestedAt set  → met
//   SCRUB_PERIOD / EXPIRED / CLOSED / REVOKED without attestation → gap
//   DENIED → n/a (licence never activated, no assets in scope)
//   anything else (active licence) → pending

const SCRUB_OBLIGATION: Pick<ObligationResult, "id" | "clauseRef" | "title" | "severity" | "satisfiedBy"> = {
  id: "platform-scrub-attestation",
  clauseRef: "Scrub",
  title: "Replica deletion & scrub attestation",
  severity: "required",
  satisfiedBy: ["replica.scrub_attested" as ComplianceEventType],
};

const SCRUB_ACTIVE_STATUSES = new Set(["SCRUB_PERIOD", "EXPIRED", "CLOSED", "REVOKED"]);

function scrubObligationResult(licence: {
  status: string;
  scrubAttestedAt: number | null;
}): ObligationResult {
  if (licence.scrubAttestedAt) return { ...SCRUB_OBLIGATION, status: "met" };
  if (licence.status === "DENIED") return { ...SCRUB_OBLIGATION, status: "n/a" };
  if (SCRUB_ACTIVE_STATUSES.has(licence.status)) return { ...SCRUB_OBLIGATION, status: "gap" };
  return { ...SCRUB_OBLIGATION, status: "pending" };
}

// ── Per-licence evaluation + worst-case merge ─────────────────────────────────
//
// Each licence in a production is evaluated independently. The production card
// shows the WORST status per obligation across all licences, so one licence's
// gap is never masked by another licence's met event.

export type LicenceRow = {
  id: string;
  licenceType: string | null;
  permitAiTraining: boolean;
  status: string;
  scrubAttestedAt: number | null;
  scrubDeadline: number | null;
  createdAt: number;
  lastDownloadAt: number | null;
};

export type LicenceEventRow = {
  eventType: string;
  scopeJson: string;
  seq: number;
  createdAt: number;
  hash: string;
};

// Status rank: gap beats pending beats met beats n/a
const STATUS_RANK: Record<string, number> = { gap: 3, pending: 2, met: 1, "n/a": 0 };

// Licences in these statuses do not contribute to the production health score.
// AWAITING_PACKAGE / PENDING — talent has not yet accepted the licence; compliance
//   obligations cannot be assessed before agreement, so they must not count as gaps.
// REVOKED / DENIED — contract is void, obligations never completed.
// SCRUB_PERIOD / EXPIRED / CLOSED — contract completed normally; scrub attestation
//   is a producer obligation the talent cannot action, so it must not count against
//   their compliance record. All obligations show n/a; history remains visible in modal.
const VOID_STATUSES = new Set(["AWAITING_PACKAGE", "PENDING", "REVOKED", "DENIED", "SCRUB_PERIOD", "EXPIRED", "CLOSED"]);

export function evaluateLicence(
  licence: LicenceRow,
  events: LicenceEventRow[],
  regime: RegimeId,
): ObligationResultWithEvidence[] {
  const repLicence: LicenceLike = {
    licenceType: licence.licenceType,
    permitAiTraining: licence.permitAiTraining,
  };
  const evaluated: EvaluatedEvent[] = events.map((e) => {
    let scope: EvaluatedEvent["scope"] | undefined;
    try { scope = JSON.parse(e.scopeJson) as EvaluatedEvent["scope"]; } catch { /* */ }
    return { eventType: e.eventType as EvaluatedEvent["eventType"], scope };
  });

  const results = evaluateObligations(regime, repLicence, evaluated);
  results.push(scrubObligationResult(licence));

  // Void licences: contract is void, obligations don't apply. Mark all n/a so
  // the modal displays cleanly without any misleading gap indicators.
  if (VOID_STATUSES.has(licence.status)) {
    return results.map((o) => ({ ...o, status: "n/a" as const, evidence: null }));
  }

  // Attach the satisfying ledger event to each met obligation
  return results.map((o): ObligationResultWithEvidence => {
    if (o.status !== "met") return { ...o, evidence: null };
    const satisfyingTypes = new Set(o.satisfiedBy as string[]);
    const match = events.find((e) => satisfyingTypes.has(e.eventType));
    if (!match) return { ...o, evidence: null };
    let scope: Record<string, unknown> = {};
    try { scope = JSON.parse(match.scopeJson) as Record<string, unknown>; } catch { /* */ }
    return {
      ...o,
      evidence: {
        eventType: match.eventType,
        seq: match.seq,
        createdAt: match.createdAt,
        hash: match.hash,
        scope,
      },
    };
  });
}

// Merge per-licence results: worst status per obligation wins.
// Void licences (REVOKED / DENIED) are excluded from the merge — they must not
// drag down the production health score since the contract is no longer active.
function evaluateGroup(
  licenceRows: LicenceRow[],
  eventsByLicence: Map<string, LicenceEventRow[]>,
  regime: RegimeId,
): ObligationResult[] {
  const activeLicences = licenceRows.filter((l) => !VOID_STATUSES.has(l.status));
  if (activeLicences.length === 0) return [];
  const merged = new Map<string, ObligationResultWithEvidence>();

  for (const licence of activeLicences) {
    const results = evaluateLicence(licence, eventsByLicence.get(licence.id) ?? [], regime);
    for (const o of results) {
      const existing = merged.get(o.id);
      if (!existing || (STATUS_RANK[o.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) {
        merged.set(o.id, { ...o });
      }
    }
  }

  return [...merged.values()];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildOrgDashboard(
  db: Db,
  orgId: string,
  regime: RegimeId,
): Promise<DashboardData | null> {
  const org = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .get();
  if (!org) return null;

  // Productions directly owned by this org — needed for both the early-return
  // path (cast-only) and the main path (all-productions coverage).
  const orgOwnedProductions = await db
    .select({ id: productions.id, name: productions.name, type: productions.type, sagProjectNumber: productions.sagProjectNumber })
    .from(productions)
    .where(eq(productions.organisationId, orgId))
    .all();

  // Include scrub fields in the query
  const licenceRows = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionId: licences.productionId,
      licenceType: licences.licenceType,
      permitAiTraining: licences.permitAiTraining,
      status: licences.status,
      createdAt: licences.createdAt,
      lastDownloadAt: licences.lastDownloadAt,
      scrubAttestedAt: licences.scrubAttestedAt,
      scrubDeadline: licences.scrubDeadline,
    })
    .from(licences)
    .where(eq(licences.organisationId, orgId))
    .all();

  if (licenceRows.length === 0) {
    // Even with no licences, show productions that have cast in onboarding
    const castOnlyProductions: ProductionCompliance[] = [];
    for (const prod of orgOwnedProductions) {
      const castRows2 = await db
        .select({ status: productionCast.status })
        .from(productionCast)
        .where(eq(productionCast.productionId, prod.id))
        .all();
      if (castRows2.length === 0) continue;
      const co: CastOnboarding = { total: castRows2.length, consented: 0, linked: 0, invited: 0, pct: 0 };
      for (const c of castRows2) {
        if (c.status === "consented") co.consented++;
        else if (c.status === "linked" || c.status === "scan_uploaded") co.linked++;
        else if (c.status === "invited") co.invited++;
      }
      co.pct = co.total > 0 ? Math.round((co.consented / co.total) * 100) : 100;
      castOnlyProductions.push({
        id: prod.id,
        name: prod.name,
        type: prod.type,
        sagProjectNumber: prod.sagProjectNumber,
        licenceCount: 0,
        healthScore: 0,
        complianceStatus: "critical",
        requiredGaps: 0,
        obligations: [],
        licences: [],
        castOnboarding: co,
      });
    }
    const castActionItems: ActionItem[] = [];
    for (const p of castOnlyProductions) {
      if (p.castOnboarding && p.castOnboarding.invited > 0) {
        castActionItems.push({
          productionName: p.name,
          licenceId: "",
          licenceProjectName: p.name,
          obligationId: "platform-cast-invite-pending",
          clauseRef: "Onboarding",
          title: "Cast members awaiting vault account",
          severity: "required",
          action: `${p.castOnboarding.invited} cast member${p.castOnboarding.invited > 1 ? "s have" : " has"} not yet created a vault account.`,
          actionOwner: "talent",
          urgency: "soon",
          deadlineLabel: null,
        });
      }
    }
    return {
      orgId,
      orgName: org.name,
      regime,
      healthScore: castOnlyProductions.length > 0 ? 0 : 100,
      complianceStatus: castOnlyProductions.length > 0 ? "critical" : "compliant",
      summary: {
        totalProductions: castOnlyProductions.length,
        compliantProductions: 0,
        totalLicences: 0,
        requiredGapsTotal: 0,
        activeStrikes: 0,
        pendingTransfers: 0,
      },
      productions: castOnlyProductions,
      obligationSummary: [],
      actionItems: castActionItems,
      recentCertificates: [],
    };
  }

  const licenceIds = licenceRows.map((l) => l.id);

  // Batch-load all compliance events — no N+1 queries
  const eventRows = await db
    .select({
      licenceId: complianceEvents.licenceId,
      eventType: complianceEvents.eventType,
      scopeJson: complianceEvents.scopeJson,
      seq: complianceEvents.seq,
      createdAt: complianceEvents.createdAt,
      hash: complianceEvents.hash,
    })
    .from(complianceEvents)
    .where(inArray(complianceEvents.licenceId, licenceIds))
    .orderBy(complianceEvents.seq)
    .all();

  const eventsByLicence = new Map<string, LicenceEventRow[]>();
  for (const e of eventRows) {
    if (!e.licenceId) continue;
    const list = eventsByLicence.get(e.licenceId) ?? [];
    list.push({
      eventType: e.eventType,
      scopeJson: e.scopeJson,
      seq: e.seq,
      createdAt: e.createdAt,
      hash: e.hash,
    });
    eventsByLicence.set(e.licenceId, list);
  }

  // Load production metadata (from licences) + all org-owned productions
  const licenceProductionIds = [
    ...new Set(licenceRows.map((l) => l.productionId).filter(Boolean)),
  ] as string[];

  const allProductionIds = [...new Set([...licenceProductionIds, ...orgOwnedProductions.map((p) => p.id)])];

  const productionMeta =
    allProductionIds.length > 0
      ? await db
          .select({ id: productions.id, name: productions.name, type: productions.type, sagProjectNumber: productions.sagProjectNumber })
          .from(productions)
          .where(inArray(productions.id, allProductionIds))
          .all()
      : [];
  const productionMap = new Map(productionMeta.map((p) => [p.id, p]));

  // Load cast onboarding stats for all relevant productions (batch, no N+1)
  const castStatsByProduction = new Map<string, CastOnboarding>();
  if (allProductionIds.length > 0) {
    const castRows = await db
      .select({ productionId: productionCast.productionId, status: productionCast.status })
      .from(productionCast)
      .where(inArray(productionCast.productionId, allProductionIds))
      .all();
    for (const c of castRows) {
      const cur = castStatsByProduction.get(c.productionId) ?? { total: 0, consented: 0, linked: 0, invited: 0, pct: 0 };
      cur.total++;
      if (c.status === "consented") cur.consented++;
      else if (c.status === "linked" || c.status === "scan_uploaded") cur.linked++;
      else if (c.status === "invited") cur.invited++;
      castStatsByProduction.set(c.productionId, cur);
    }
    // Compute pct
    for (const [pid, stats] of castStatsByProduction) {
      stats.pct = stats.total > 0 ? Math.round((stats.consented / stats.total) * 100) : 100;
      castStatsByProduction.set(pid, stats);
    }
  }

  // Group licences by production (productionId → group; no productionId → per projectName)
  type LicenceGroup = {
    productionId: string | null;
    productionName: string;
    productionType: string | null;
    productionSagNumber: string | null;
    licences: typeof licenceRows;
  };

  const groups = new Map<string, LicenceGroup>();
  for (const l of licenceRows) {
    const key = l.productionId ?? `__proj__${l.projectName}`;
    if (!groups.has(key)) {
      const prod = l.productionId ? productionMap.get(l.productionId) : null;
      groups.set(key, {
        productionId: l.productionId,
        productionName: prod?.name ?? l.projectName,
        productionType: prod?.type ?? null,
        productionSagNumber: prod?.sagProjectNumber ?? null,
        licences: [],
      });
    }
    groups.get(key)!.licences.push(l);
  }

  // Evaluate obligations per production group (per-licence + worst-case merge)
  const productionResults: ProductionCompliance[] = [];
  const seenProductionIds = new Set<string>();

  for (const group of groups.values()) {
    const obligations = evaluateGroup(group.licences, eventsByLicence, regime);
    const healthScore = computeHealthScore(obligations);
    const requiredGaps = obligations.filter(
      (o) => o.severity === "required" && o.status === "gap",
    ).length;
    const licenceSummaries: LicenceSummary[] = group.licences.map((l) => ({
      id: l.id,
      projectName: l.projectName,
      licenceType: l.licenceType,
      status: l.status,
      obligations: evaluateLicence(l, eventsByLicence.get(l.id) ?? [], regime),
    }));
    const castOnboarding = group.productionId ? (castStatsByProduction.get(group.productionId) ?? null) : null;
    productionResults.push({
      id: group.productionId,
      name: group.productionName,
      type: group.productionType,
      sagProjectNumber: group.productionSagNumber,
      licenceCount: group.licences.length,
      healthScore,
      complianceStatus: scoreToStatus(healthScore),
      requiredGaps,
      obligations,
      licences: licenceSummaries,
      castOnboarding,
    });
    if (group.productionId) seenProductionIds.add(group.productionId);
  }

  // Add org-owned productions that have cast but no licences yet — visible in dashboard
  // even before any licence is created, so coordinators can track onboarding progress.
  for (const prod of orgOwnedProductions) {
    if (seenProductionIds.has(prod.id)) continue;
    const castOnboarding = castStatsByProduction.get(prod.id) ?? null;
    if (!castOnboarding) continue; // no cast rows either — skip
    productionResults.push({
      id: prod.id,
      name: prod.name,
      type: prod.type,
      sagProjectNumber: prod.sagProjectNumber,
      licenceCount: 0,
      healthScore: 0,
      complianceStatus: castOnboarding.consented === castOnboarding.total && castOnboarding.total > 0 ? "partial" : "critical",
      requiredGaps: 0,
      obligations: [],
      licences: [],
      castOnboarding,
    });
  }

  productionResults.sort((a, b) => a.healthScore - b.healthScore);

  // Org health score: weighted average by licence count
  const totalLicences = licenceRows.length;
  const weightedScore = productionResults.reduce(
    (sum, p) => sum + p.healthScore * p.licenceCount,
    0,
  );
  const orgHealthScore = Math.round(weightedScore / totalLicences);

  // Obligation summary matrix (aggregate across all productions)
  const obligationMap = new Map<string, ObligationSummaryItem>();
  for (const prod of productionResults) {
    for (const o of prod.obligations) {
      if (!obligationMap.has(o.id)) {
        obligationMap.set(o.id, {
          id: o.id,
          clauseRef: o.clauseRef,
          title: o.title,
          severity: o.severity,
          metCount: 0,
          gapCount: 0,
          naCount: 0,
          pendingCount: 0,
          progressPct: 0,
        });
      }
      const item = obligationMap.get(o.id)!;
      if (o.status === "met") item.metCount++;
      else if (o.status === "gap") item.gapCount++;
      else if (o.status === "pending") item.pendingCount++;
      else item.naCount++;
    }
  }
  for (const item of obligationMap.values()) {
    const assessed = item.metCount + item.gapCount;
    item.progressPct = assessed > 0 ? Math.round((item.metCount / assessed) * 100) : 100;
  }
  const obligationSummary = [...obligationMap.values()].sort((a, b) =>
    a.clauseRef.localeCompare(b.clauseRef),
  );

  // Per-licence action items for every gap or pending obligation
  const actionItems: ActionItem[] = [];
  for (const group of groups.values()) {
    for (const licence of group.licences) {
      const obligations = evaluateLicence(
        licence,
        eventsByLicence.get(licence.id) ?? [],
        regime,
      );

      for (const o of obligations) {
        if (o.status !== "gap" && o.status !== "pending") continue;
        const rem = REMEDIATION[o.id];
        if (!rem) continue;

        if (o.status === "pending") {
          // Pending items: scrub attestation on active licences
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency: "pending",
            deadlineLabel: "Required on expiry",
          });
        } else {
          const { urgency, deadlineLabel } = computeUrgency(
            o.id,
            o.severity,
            licence.createdAt,
            licence.lastDownloadAt,
          );
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency,
            deadlineLabel,
          });
        }
      }
    }
  }

  // Cast onboarding action items — injected for any production with incomplete onboarding
  for (const prod of productionResults) {
    if (!prod.castOnboarding || prod.castOnboarding.total === 0) continue;
    const co = prod.castOnboarding;
    if (co.invited > 0) {
      actionItems.push({
        productionName: prod.name,
        licenceId: "",
        licenceProjectName: prod.name,
        obligationId: "platform-cast-invite-pending",
        clauseRef: "Onboarding",
        title: "Cast members awaiting vault account",
        severity: "required",
        action: `${co.invited} cast member${co.invited > 1 ? "s have" : " has"} not yet created a vault account. Resend invites.`,
        actionOwner: "talent",
        urgency: co.invited > 0 ? "soon" : "upcoming",
        deadlineLabel: null,
      });
    }
    if (co.linked > 0) {
      actionItems.push({
        productionName: prod.name,
        licenceId: "",
        licenceProjectName: prod.name,
        obligationId: "platform-cast-scan-pending",
        clauseRef: "Onboarding",
        title: "Cast members awaiting scan upload or approval",
        severity: "required",
        action: `${co.linked} cast member${co.linked > 1 ? "s have" : " has"} signed up but not yet uploaded a scan or approved their licence.`,
        actionOwner: "talent",
        urgency: "upcoming",
        deadlineLabel: null,
      });
    }
  }

  const urgencyOrder: Record<string, number> = {
    critical: 0, soon: 1, upcoming: 2, info: 3, pending: 4,
  };
  actionItems.sort((a, b) => {
    const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (u !== 0) return u;
    return a.severity === "required" && b.severity !== "required" ? -1 : 1;
  });

  // Active strikes scoped to this org
  const strikeRows = await db
    .select({ id: strikeLocks.id })
    .from(strikeLocks)
    .where(
      and(
        eq(strikeLocks.status, "active"),
        or(
          eq(strikeLocks.scope, "global"),
          and(eq(strikeLocks.scope, "organisation"), eq(strikeLocks.scopeId, orgId)),
        ),
      ),
    )
    .all();

  // Pending transfer requests for our licences
  const transferRows = await db
    .select({ id: replicaTransfers.id })
    .from(replicaTransfers)
    .where(
      and(
        inArray(replicaTransfers.licenceId, licenceIds),
        eq(replicaTransfers.status, "requested"),
      ),
    )
    .all();

  // Most recent org-scope certificates
  const certRows = await db
    .select({
      id: complianceCertificates.id,
      scope: complianceCertificates.scope,
      generatedAt: complianceCertificates.generatedAt,
    })
    .from(complianceCertificates)
    .where(
      and(
        eq(complianceCertificates.scope, "organisation"),
        eq(complianceCertificates.scopeId, orgId),
      ),
    )
    .orderBy(desc(complianceCertificates.generatedAt))
    .limit(5)
    .all();

  const requiredGapsTotal = productionResults.reduce((sum, p) => sum + p.requiredGaps, 0);
  const compliantProductions = productionResults.filter(
    (p) => p.complianceStatus === "compliant",
  ).length;

  return {
    orgId,
    orgName: org.name,
    regime,
    healthScore: orgHealthScore,
    complianceStatus: scoreToStatus(orgHealthScore),
    summary: {
      totalProductions: productionResults.length,
      compliantProductions,
      totalLicences,
      requiredGapsTotal,
      activeStrikes: strikeRows.length,
      pendingTransfers: transferRows.length,
    },
    productions: productionResults,
    obligationSummary,
    actionItems,
    recentCertificates: certRows,
  };
}

// ── Talent-level dashboard ─────────────────────────────────────────────────────
//
// Same structure as the org dashboard but keyed on the talent's userId.
// No cast onboarding (that's producer-side); strikes are global-only.

export async function buildTalentDashboard(
  db: Db,
  talentId: string,
  regime: RegimeId,
): Promise<DashboardData | null> {
  const talentUser = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, talentId))
    .get();
  if (!talentUser) return null;

  const licenceRows = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionId: licences.productionId,
      licenceType: licences.licenceType,
      permitAiTraining: licences.permitAiTraining,
      status: licences.status,
      createdAt: licences.createdAt,
      lastDownloadAt: licences.lastDownloadAt,
      scrubAttestedAt: licences.scrubAttestedAt,
      scrubDeadline: licences.scrubDeadline,
    })
    .from(licences)
    .where(eq(licences.talentId, talentId))
    .all();

  if (licenceRows.length === 0) {
    return {
      orgId: talentId,
      orgName: talentUser.email,
      regime,
      healthScore: 100,
      complianceStatus: "compliant",
      summary: {
        totalProductions: 0,
        compliantProductions: 0,
        totalLicences: 0,
        requiredGapsTotal: 0,
        activeStrikes: 0,
        pendingTransfers: 0,
      },
      productions: [],
      obligationSummary: [],
      actionItems: [],
      recentCertificates: [],
    };
  }

  const licenceIds = licenceRows.map((l) => l.id);

  const eventRows = await db
    .select({
      licenceId: complianceEvents.licenceId,
      eventType: complianceEvents.eventType,
      scopeJson: complianceEvents.scopeJson,
      seq: complianceEvents.seq,
      createdAt: complianceEvents.createdAt,
      hash: complianceEvents.hash,
    })
    .from(complianceEvents)
    .where(inArray(complianceEvents.licenceId, licenceIds))
    .orderBy(complianceEvents.seq)
    .all();

  const eventsByLicence = new Map<string, LicenceEventRow[]>();
  for (const e of eventRows) {
    if (!e.licenceId) continue;
    const list = eventsByLicence.get(e.licenceId) ?? [];
    list.push({ eventType: e.eventType, scopeJson: e.scopeJson, seq: e.seq, createdAt: e.createdAt, hash: e.hash });
    eventsByLicence.set(e.licenceId, list);
  }

  const licenceProductionIds = [
    ...new Set(licenceRows.map((l) => l.productionId).filter(Boolean)),
  ] as string[];

  const productionMeta = licenceProductionIds.length > 0
    ? await db
        .select({ id: productions.id, name: productions.name, type: productions.type, sagProjectNumber: productions.sagProjectNumber })
        .from(productions)
        .where(inArray(productions.id, licenceProductionIds))
        .all()
    : [];
  const productionMap = new Map(productionMeta.map((p) => [p.id, p]));

  type TalentLicenceGroup = {
    productionId: string | null;
    productionName: string;
    productionType: string | null;
    productionSagNumber: string | null;
    licences: typeof licenceRows;
  };

  const groups = new Map<string, TalentLicenceGroup>();
  for (const l of licenceRows) {
    const key = l.productionId ?? `__proj__${l.projectName}`;
    if (!groups.has(key)) {
      const prod = l.productionId ? productionMap.get(l.productionId) : null;
      groups.set(key, {
        productionId: l.productionId,
        productionName: prod?.name ?? l.projectName,
        productionType: prod?.type ?? null,
        productionSagNumber: prod?.sagProjectNumber ?? null,
        licences: [],
      });
    }
    groups.get(key)!.licences.push(l);
  }

  const productionResults: ProductionCompliance[] = [];
  for (const group of groups.values()) {
    const obligations = evaluateGroup(group.licences, eventsByLicence, regime);
    const healthScore = computeHealthScore(obligations);
    const requiredGaps = obligations.filter(
      (o) => o.severity === "required" && o.status === "gap",
    ).length;
    const licenceSummaries: LicenceSummary[] = group.licences.map((l) => ({
      id: l.id,
      projectName: l.projectName,
      licenceType: l.licenceType,
      status: l.status,
      obligations: evaluateLicence(l, eventsByLicence.get(l.id) ?? [], regime),
    }));
    productionResults.push({
      id: group.productionId,
      name: group.productionName,
      type: group.productionType,
      sagProjectNumber: group.productionSagNumber,
      licenceCount: group.licences.length,
      healthScore,
      complianceStatus: scoreToStatus(healthScore),
      requiredGaps,
      obligations,
      licences: licenceSummaries,
      castOnboarding: null,
    });
  }

  productionResults.sort((a, b) => a.healthScore - b.healthScore);

  const totalLicences = licenceRows.length;
  const weightedScore = productionResults.reduce((sum, p) => sum + p.healthScore * p.licenceCount, 0);
  const orgHealthScore = totalLicences > 0 ? Math.round(weightedScore / totalLicences) : 100;

  const obligationMap = new Map<string, ObligationSummaryItem>();
  for (const prod of productionResults) {
    for (const o of prod.obligations) {
      if (!obligationMap.has(o.id)) {
        obligationMap.set(o.id, { id: o.id, clauseRef: o.clauseRef, title: o.title, severity: o.severity, metCount: 0, gapCount: 0, naCount: 0, pendingCount: 0, progressPct: 0 });
      }
      const item = obligationMap.get(o.id)!;
      if (o.status === "met") item.metCount++;
      else if (o.status === "gap") item.gapCount++;
      else if (o.status === "pending") item.pendingCount++;
      else item.naCount++;
    }
  }
  for (const item of obligationMap.values()) {
    const assessed = item.metCount + item.gapCount;
    item.progressPct = assessed > 0 ? Math.round((item.metCount / assessed) * 100) : 100;
  }
  const obligationSummary = [...obligationMap.values()].sort((a, b) => a.clauseRef.localeCompare(b.clauseRef));

  const actionItems: ActionItem[] = [];
  for (const group of groups.values()) {
    for (const licence of group.licences) {
      const obligations = evaluateLicence(licence, eventsByLicence.get(licence.id) ?? [], regime);
      for (const o of obligations) {
        if (o.status !== "gap" && o.status !== "pending") continue;
        const rem = REMEDIATION[o.id];
        if (!rem) continue;
        if (o.status === "pending") {
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency: "pending",
            deadlineLabel: "Required on expiry",
          });
        } else {
          const { urgency, deadlineLabel } = computeUrgency(o.id, o.severity, licence.createdAt, licence.lastDownloadAt);
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency,
            deadlineLabel,
          });
        }
      }
    }
  }

  const urgencyOrder: Record<string, number> = { critical: 0, soon: 1, upcoming: 2, info: 3, pending: 4 };
  actionItems.sort((a, b) => {
    const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (u !== 0) return u;
    return a.severity === "required" && b.severity !== "required" ? -1 : 1;
  });

  const strikeRows = await db
    .select({ id: strikeLocks.id })
    .from(strikeLocks)
    .where(and(eq(strikeLocks.status, "active"), eq(strikeLocks.scope, "global")))
    .all();

  const transferRows = await db
    .select({ id: replicaTransfers.id })
    .from(replicaTransfers)
    .where(and(inArray(replicaTransfers.licenceId, licenceIds), eq(replicaTransfers.status, "requested")))
    .all();

  const certRows = await db
    .select({ id: complianceCertificates.id, scope: complianceCertificates.scope, generatedAt: complianceCertificates.generatedAt })
    .from(complianceCertificates)
    .where(and(eq(complianceCertificates.scope, "talent"), eq(complianceCertificates.scopeId, talentId)))
    .orderBy(desc(complianceCertificates.generatedAt))
    .limit(5)
    .all();

  const requiredGapsTotal = productionResults.reduce((sum, p) => sum + p.requiredGaps, 0);
  const compliantProductions = productionResults.filter((p) => p.complianceStatus === "compliant").length;

  return {
    orgId: talentId,
    orgName: talentUser.email,
    regime,
    healthScore: orgHealthScore,
    complianceStatus: scoreToStatus(orgHealthScore),
    summary: {
      totalProductions: productionResults.length,
      compliantProductions,
      totalLicences,
      requiredGapsTotal,
      activeStrikes: strikeRows.length,
      pendingTransfers: transferRows.length,
    },
    productions: productionResults,
    obligationSummary,
    actionItems,
    recentCertificates: certRows,
  };
}

// ── Platform-wide dashboard ─────────────────────────────────────────────────────
//
// Same structure and evaluation as the org dashboard but spanning EVERY licence,
// production and organisation on the platform. Powers the read-only view that a
// platform-wide compliance watcher (Union / Regulator / Insurer with a blanket
// grant) sees in /evidence — they get the full interactive control centre rather
// than a per-scope drill-down. Includes cast onboarding, every active strike,
// every pending transfer, and the most recent certificates across all scopes.

export async function buildPlatformDashboard(
  db: Db,
  regime: RegimeId,
): Promise<DashboardData> {
  // Every production on the platform — needed for cast-onboarding coverage even
  // before any licence exists.
  const allProductions = await db
    .select({ id: productions.id, name: productions.name, type: productions.type, sagProjectNumber: productions.sagProjectNumber })
    .from(productions)
    .all();

  const licenceRows = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionId: licences.productionId,
      licenceType: licences.licenceType,
      permitAiTraining: licences.permitAiTraining,
      status: licences.status,
      createdAt: licences.createdAt,
      lastDownloadAt: licences.lastDownloadAt,
      scrubAttestedAt: licences.scrubAttestedAt,
      scrubDeadline: licences.scrubDeadline,
    })
    .from(licences)
    .all();

  // Platform-wide counts that apply regardless of the licence set.
  const activeStrikeRows = await db
    .select({ id: strikeLocks.id })
    .from(strikeLocks)
    .where(eq(strikeLocks.status, "active"))
    .all();
  const pendingTransferRows = await db
    .select({ id: replicaTransfers.id })
    .from(replicaTransfers)
    .where(eq(replicaTransfers.status, "requested"))
    .all();
  const certRows = await db
    .select({ id: complianceCertificates.id, scope: complianceCertificates.scope, generatedAt: complianceCertificates.generatedAt })
    .from(complianceCertificates)
    .orderBy(desc(complianceCertificates.generatedAt))
    .limit(8)
    .all();

  const PLATFORM_NAME = "Platform-wide";

  if (licenceRows.length === 0) {
    // No licences yet — still surface productions that have cast in onboarding.
    const castOnlyProductions: ProductionCompliance[] = [];
    const castActionItems: ActionItem[] = [];
    const allProdIds = allProductions.map((p) => p.id);
    const castByProd = new Map<string, CastOnboarding>();
    if (allProdIds.length > 0) {
      const castRows = await db
        .select({ productionId: productionCast.productionId, status: productionCast.status })
        .from(productionCast)
        .where(inArray(productionCast.productionId, allProdIds))
        .all();
      for (const c of castRows) {
        const cur = castByProd.get(c.productionId) ?? { total: 0, consented: 0, linked: 0, invited: 0, pct: 0 };
        cur.total++;
        if (c.status === "consented") cur.consented++;
        else if (c.status === "linked" || c.status === "scan_uploaded") cur.linked++;
        else if (c.status === "invited") cur.invited++;
        castByProd.set(c.productionId, cur);
      }
      for (const [pid, stats] of castByProd) {
        stats.pct = stats.total > 0 ? Math.round((stats.consented / stats.total) * 100) : 100;
        castByProd.set(pid, stats);
      }
    }
    for (const prod of allProductions) {
      const co = castByProd.get(prod.id);
      if (!co) continue;
      castOnlyProductions.push({
        id: prod.id,
        name: prod.name,
        type: prod.type,
        sagProjectNumber: prod.sagProjectNumber,
        licenceCount: 0,
        healthScore: 0,
        complianceStatus: co.consented === co.total && co.total > 0 ? "partial" : "critical",
        requiredGaps: 0,
        obligations: [],
        licences: [],
        castOnboarding: co,
      });
      if (co.invited > 0) {
        castActionItems.push({
          productionName: prod.name,
          licenceId: "",
          licenceProjectName: prod.name,
          obligationId: "platform-cast-invite-pending",
          clauseRef: "Onboarding",
          title: "Cast members awaiting vault account",
          severity: "required",
          action: `${co.invited} cast member${co.invited > 1 ? "s have" : " has"} not yet created a vault account.`,
          actionOwner: "talent",
          urgency: "soon",
          deadlineLabel: null,
        });
      }
    }
    return {
      orgId: "platform",
      orgName: PLATFORM_NAME,
      regime,
      healthScore: castOnlyProductions.length > 0 ? 0 : 100,
      complianceStatus: castOnlyProductions.length > 0 ? "critical" : "compliant",
      summary: {
        totalProductions: castOnlyProductions.length,
        compliantProductions: 0,
        totalLicences: 0,
        requiredGapsTotal: 0,
        activeStrikes: activeStrikeRows.length,
        pendingTransfers: pendingTransferRows.length,
      },
      productions: castOnlyProductions,
      obligationSummary: [],
      actionItems: castActionItems,
      recentCertificates: certRows,
    };
  }

  const licenceIds = licenceRows.map((l) => l.id);

  const eventRows = await db
    .select({
      licenceId: complianceEvents.licenceId,
      eventType: complianceEvents.eventType,
      scopeJson: complianceEvents.scopeJson,
      seq: complianceEvents.seq,
      createdAt: complianceEvents.createdAt,
      hash: complianceEvents.hash,
    })
    .from(complianceEvents)
    .where(inArray(complianceEvents.licenceId, licenceIds))
    .orderBy(complianceEvents.seq)
    .all();

  const eventsByLicence = new Map<string, LicenceEventRow[]>();
  for (const e of eventRows) {
    if (!e.licenceId) continue;
    const list = eventsByLicence.get(e.licenceId) ?? [];
    list.push({ eventType: e.eventType, scopeJson: e.scopeJson, seq: e.seq, createdAt: e.createdAt, hash: e.hash });
    eventsByLicence.set(e.licenceId, list);
  }

  const productionMap = new Map(allProductions.map((p) => [p.id, p]));
  const allProductionIds = allProductions.map((p) => p.id);

  // Cast onboarding stats for every production (batch, no N+1)
  const castStatsByProduction = new Map<string, CastOnboarding>();
  if (allProductionIds.length > 0) {
    const castRows = await db
      .select({ productionId: productionCast.productionId, status: productionCast.status })
      .from(productionCast)
      .where(inArray(productionCast.productionId, allProductionIds))
      .all();
    for (const c of castRows) {
      const cur = castStatsByProduction.get(c.productionId) ?? { total: 0, consented: 0, linked: 0, invited: 0, pct: 0 };
      cur.total++;
      if (c.status === "consented") cur.consented++;
      else if (c.status === "linked" || c.status === "scan_uploaded") cur.linked++;
      else if (c.status === "invited") cur.invited++;
      castStatsByProduction.set(c.productionId, cur);
    }
    for (const [pid, stats] of castStatsByProduction) {
      stats.pct = stats.total > 0 ? Math.round((stats.consented / stats.total) * 100) : 100;
      castStatsByProduction.set(pid, stats);
    }
  }

  type PlatformLicenceGroup = {
    productionId: string | null;
    productionName: string;
    productionType: string | null;
    productionSagNumber: string | null;
    licences: typeof licenceRows;
  };

  const groups = new Map<string, PlatformLicenceGroup>();
  for (const l of licenceRows) {
    const key = l.productionId ?? `__proj__${l.projectName}`;
    if (!groups.has(key)) {
      const prod = l.productionId ? productionMap.get(l.productionId) : null;
      groups.set(key, {
        productionId: l.productionId,
        productionName: prod?.name ?? l.projectName,
        productionType: prod?.type ?? null,
        productionSagNumber: prod?.sagProjectNumber ?? null,
        licences: [],
      });
    }
    groups.get(key)!.licences.push(l);
  }

  const productionResults: ProductionCompliance[] = [];
  const seenProductionIds = new Set<string>();
  for (const group of groups.values()) {
    const obligations = evaluateGroup(group.licences, eventsByLicence, regime);
    const healthScore = computeHealthScore(obligations);
    const requiredGaps = obligations.filter((o) => o.severity === "required" && o.status === "gap").length;
    const licenceSummaries: LicenceSummary[] = group.licences.map((l) => ({
      id: l.id,
      projectName: l.projectName,
      licenceType: l.licenceType,
      status: l.status,
      obligations: evaluateLicence(l, eventsByLicence.get(l.id) ?? [], regime),
    }));
    const castOnboarding = group.productionId ? (castStatsByProduction.get(group.productionId) ?? null) : null;
    productionResults.push({
      id: group.productionId,
      name: group.productionName,
      type: group.productionType,
      sagProjectNumber: group.productionSagNumber,
      licenceCount: group.licences.length,
      healthScore,
      complianceStatus: scoreToStatus(healthScore),
      requiredGaps,
      obligations,
      licences: licenceSummaries,
      castOnboarding,
    });
    if (group.productionId) seenProductionIds.add(group.productionId);
  }

  // Productions with cast but no licence yet — still visible for onboarding tracking.
  for (const prod of allProductions) {
    if (seenProductionIds.has(prod.id)) continue;
    const castOnboarding = castStatsByProduction.get(prod.id) ?? null;
    if (!castOnboarding) continue;
    productionResults.push({
      id: prod.id,
      name: prod.name,
      type: prod.type,
      sagProjectNumber: prod.sagProjectNumber,
      licenceCount: 0,
      healthScore: 0,
      complianceStatus: castOnboarding.consented === castOnboarding.total && castOnboarding.total > 0 ? "partial" : "critical",
      requiredGaps: 0,
      obligations: [],
      licences: [],
      castOnboarding,
    });
  }

  productionResults.sort((a, b) => a.healthScore - b.healthScore);

  const totalLicences = licenceRows.length;
  const weightedScore = productionResults.reduce((sum, p) => sum + p.healthScore * p.licenceCount, 0);
  const orgHealthScore = totalLicences > 0 ? Math.round(weightedScore / totalLicences) : 100;

  const obligationMap = new Map<string, ObligationSummaryItem>();
  for (const prod of productionResults) {
    for (const o of prod.obligations) {
      if (!obligationMap.has(o.id)) {
        obligationMap.set(o.id, { id: o.id, clauseRef: o.clauseRef, title: o.title, severity: o.severity, metCount: 0, gapCount: 0, naCount: 0, pendingCount: 0, progressPct: 0 });
      }
      const item = obligationMap.get(o.id)!;
      if (o.status === "met") item.metCount++;
      else if (o.status === "gap") item.gapCount++;
      else if (o.status === "pending") item.pendingCount++;
      else item.naCount++;
    }
  }
  for (const item of obligationMap.values()) {
    const assessed = item.metCount + item.gapCount;
    item.progressPct = assessed > 0 ? Math.round((item.metCount / assessed) * 100) : 100;
  }
  const obligationSummary = [...obligationMap.values()].sort((a, b) => a.clauseRef.localeCompare(b.clauseRef));

  const actionItems: ActionItem[] = [];
  for (const group of groups.values()) {
    for (const licence of group.licences) {
      const obligations = evaluateLicence(licence, eventsByLicence.get(licence.id) ?? [], regime);
      for (const o of obligations) {
        if (o.status !== "gap" && o.status !== "pending") continue;
        const rem = REMEDIATION[o.id];
        if (!rem) continue;
        if (o.status === "pending") {
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency: "pending",
            deadlineLabel: "Required on expiry",
          });
        } else {
          const { urgency, deadlineLabel } = computeUrgency(o.id, o.severity, licence.createdAt, licence.lastDownloadAt);
          actionItems.push({
            productionName: group.productionName,
            licenceId: licence.id,
            licenceProjectName: licence.projectName,
            obligationId: o.id,
            clauseRef: o.clauseRef,
            title: o.title,
            severity: o.severity,
            action: rem.action,
            actionOwner: rem.owner,
            urgency,
            deadlineLabel,
          });
        }
      }
    }
  }

  // Cast onboarding action items across every production
  for (const prod of productionResults) {
    if (!prod.castOnboarding || prod.castOnboarding.total === 0) continue;
    const co = prod.castOnboarding;
    if (co.invited > 0) {
      actionItems.push({
        productionName: prod.name,
        licenceId: "",
        licenceProjectName: prod.name,
        obligationId: "platform-cast-invite-pending",
        clauseRef: "Onboarding",
        title: "Cast members awaiting vault account",
        severity: "required",
        action: `${co.invited} cast member${co.invited > 1 ? "s have" : " has"} not yet created a vault account.`,
        actionOwner: "talent",
        urgency: "soon",
        deadlineLabel: null,
      });
    }
    if (co.linked > 0) {
      actionItems.push({
        productionName: prod.name,
        licenceId: "",
        licenceProjectName: prod.name,
        obligationId: "platform-cast-scan-pending",
        clauseRef: "Onboarding",
        title: "Cast members awaiting scan upload or approval",
        severity: "required",
        action: `${co.linked} cast member${co.linked > 1 ? "s have" : " has"} signed up but not yet uploaded a scan or approved their licence.`,
        actionOwner: "talent",
        urgency: "upcoming",
        deadlineLabel: null,
      });
    }
  }

  const urgencyOrder: Record<string, number> = { critical: 0, soon: 1, upcoming: 2, info: 3, pending: 4 };
  actionItems.sort((a, b) => {
    const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (u !== 0) return u;
    return a.severity === "required" && b.severity !== "required" ? -1 : 1;
  });

  const requiredGapsTotal = productionResults.reduce((sum, p) => sum + p.requiredGaps, 0);
  const compliantProductions = productionResults.filter((p) => p.complianceStatus === "compliant").length;

  return {
    orgId: "platform",
    orgName: PLATFORM_NAME,
    regime,
    healthScore: orgHealthScore,
    complianceStatus: scoreToStatus(orgHealthScore),
    summary: {
      totalProductions: productionResults.length,
      compliantProductions,
      totalLicences,
      requiredGapsTotal,
      activeStrikes: activeStrikeRows.length,
      pendingTransfers: pendingTransferRows.length,
    },
    productions: productionResults,
    obligationSummary,
    actionItems,
    recentCertificates: certRows,
  };
}
