// Org-level compliance dashboard aggregation — powers the Vanta-like control centre.
//
// Loads all licences for an org, evaluates SAG-AFTRA (or other regime) obligations
// per production group, and returns health scores, obligation summaries, and a
// prioritised action queue with deadline labels.

import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  complianceCertificates,
  complianceEvents,
  licences,
  organisations,
  productions,
  replicaTransfers,
  strikeLocks,
} from "@/lib/db/schema";
import { evaluateObligations } from "./registry";
import "./regimes";
import type { getDb } from "@/lib/db";
import type { EvaluatedEvent, LicenceLike, ObligationResult, RegimeId } from "./types";

type Db = ReturnType<typeof getDb>;

export type ComplianceStatus = "compliant" | "partial" | "gap" | "critical";

export interface ProductionCompliance {
  id: string | null;
  name: string;
  type: string | null;
  licenceCount: number;
  healthScore: number;
  complianceStatus: ComplianceStatus;
  requiredGaps: number;
  obligations: ObligationResult[];
}

export interface ObligationSummaryItem {
  id: string;
  clauseRef: string;
  title: string;
  severity: "required" | "recommended";
  metCount: number;
  gapCount: number;
  naCount: number;
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
  urgency: "critical" | "soon" | "upcoming" | "info";
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
};

// Days from licence creation (or first download) by which each obligation must be met.
// Obligations not listed here have no hard deadline (urgency derived from severity only).
const DEADLINE_DAYS: Record<string, number> = {
  "sag-39-b-consent": 0,              // must be in place before use
  "sag-39-e-biometric-isolation": 7,  // 7 days from licence grant
  "sag-39-h-security-custody": 30,    // 30 days from first download
  "sag-39-i-transfer-approval": 0,    // before transfer commences
};

function computeHealthScore(obligations: ObligationResult[]): number {
  const required = obligations.filter((o) => o.severity === "required" && o.status !== "n/a");
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
    // 39.H clock starts from first download, not licence creation
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

type LicenceEventRow = { eventType: string; scopeJson: string };

// Evaluate a set of licences as one production unit.
// Events are already loaded — this is pure in-memory computation.
function evaluateGroup(
  licenceRows: Array<{ id: string; licenceType: string | null; permitAiTraining: boolean }>,
  eventsByLicence: Map<string, LicenceEventRow[]>,
  regime: RegimeId,
): ObligationResult[] {
  const repLicence: LicenceLike = {
    licenceType:
      licenceRows.find((l) => l.licenceType === "ai_avatar" || l.licenceType === "training_data")
        ?.licenceType ?? licenceRows[0]?.licenceType ?? null,
    permitAiTraining: licenceRows.some((l) => l.permitAiTraining),
  };

  const allEvents: EvaluatedEvent[] = [];
  for (const l of licenceRows) {
    for (const e of eventsByLicence.get(l.id) ?? []) {
      let scope: EvaluatedEvent["scope"] | undefined;
      try { scope = JSON.parse(e.scopeJson) as EvaluatedEvent["scope"]; } catch { /* ignore */ }
      allEvents.push({ eventType: e.eventType as EvaluatedEvent["eventType"], scope });
    }
  }

  return evaluateObligations(regime, repLicence, allEvents);
}

export async function buildOrgDashboard(
  db: Db,
  orgId: string,
  regime: RegimeId,
): Promise<DashboardData | null> {
  // Load org name
  const org = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .get();
  if (!org) return null;

  // Load all licences for the org
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
    })
    .from(licences)
    .where(eq(licences.organisationId, orgId))
    .all();

  if (licenceRows.length === 0) {
    return {
      orgId,
      orgName: org.name,
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

  // Batch-load all compliance events — no N+1 queries
  const eventRows = await db
    .select({
      licenceId: complianceEvents.licenceId,
      eventType: complianceEvents.eventType,
      scopeJson: complianceEvents.scopeJson,
    })
    .from(complianceEvents)
    .where(inArray(complianceEvents.licenceId, licenceIds))
    .orderBy(complianceEvents.seq)
    .all();

  const eventsByLicence = new Map<string, LicenceEventRow[]>();
  for (const e of eventRows) {
    if (!e.licenceId) continue;
    const list = eventsByLicence.get(e.licenceId) ?? [];
    list.push({ eventType: e.eventType, scopeJson: e.scopeJson });
    eventsByLicence.set(e.licenceId, list);
  }

  // Load production metadata for named productions
  const productionIds = [
    ...new Set(licenceRows.map((l) => l.productionId).filter(Boolean)),
  ] as string[];
  const productionMeta =
    productionIds.length > 0
      ? await db
          .select({ id: productions.id, name: productions.name, type: productions.type })
          .from(productions)
          .where(inArray(productions.id, productionIds))
          .all()
      : [];
  const productionMap = new Map(productionMeta.map((p) => [p.id, p]));

  // Group licences by production (productionId → group; no productionId → per projectName)
  type LicenceGroup = {
    productionId: string | null;
    productionName: string;
    productionType: string | null;
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
        licences: [],
      });
    }
    groups.get(key)!.licences.push(l);
  }

  // Evaluate obligations per production group (pure in-memory)
  const productionResults: ProductionCompliance[] = [];
  for (const group of groups.values()) {
    const obligations = evaluateGroup(group.licences, eventsByLicence, regime);
    const healthScore = computeHealthScore(obligations);
    const requiredGaps = obligations.filter(
      (o) => o.severity === "required" && o.status === "gap",
    ).length;
    productionResults.push({
      id: group.productionId,
      name: group.productionName,
      type: group.productionType,
      licenceCount: group.licences.length,
      healthScore,
      complianceStatus: scoreToStatus(healthScore),
      requiredGaps,
      obligations,
    });
  }

  // Sort: worst health score first so the dashboard shows what needs attention
  productionResults.sort((a, b) => a.healthScore - b.healthScore);

  // Org-level health score: weighted average by licence count
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
          progressPct: 0,
        });
      }
      const item = obligationMap.get(o.id)!;
      if (o.status === "met") item.metCount++;
      else if (o.status === "gap") item.gapCount++;
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

  // Per-licence action items for every gap
  const actionItems: ActionItem[] = [];
  for (const group of groups.values()) {
    for (const licence of group.licences) {
      const obligations = evaluateGroup([licence], eventsByLicence, regime);
      for (const o of obligations) {
        if (o.status !== "gap") continue;
        const rem = REMEDIATION[o.id];
        if (!rem) continue;
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

  const urgencyOrder: Record<string, number> = { critical: 0, soon: 1, upcoming: 2, info: 3 };
  actionItems.sort((a, b) => {
    const u = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (u !== 0) return u;
    return a.severity === "required" && b.severity !== "required" ? -1 : 1;
  });

  // Active strikes scoped to this org (global + org-level)
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
