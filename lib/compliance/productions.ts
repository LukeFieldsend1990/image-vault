// Platform-wide productions tracker + cast visibility for the union/oversight
// (compliance) view. Read-only aggregation over every production on the platform:
// production phase, compliance health, cast onboarding, and "coverage gaps" — cast
// whose likeness is licensed without a recorded Article 39.B consent.
//
// Evaluation is delegated to the existing dashboard builder (buildPlatformDashboard)
// and per-licence evaluator (evaluateLicence) so the union view stays consistent
// with the talent/admin compliance scoring.

import { eq, inArray } from "drizzle-orm";
import {
  complianceEvents,
  licences,
  organisations,
  productionCast,
  productions,
  talentProfiles,
  users,
} from "@/lib/db/schema";
import {
  buildPlatformDashboard,
  evaluateLicence,
  type ComplianceStatus,
  type LicenceEventRow,
  type LicenceRow,
} from "./dashboard";
import {
  detectUseViolation,
  detectUseViolationsForLicences,
  isViolation,
  type UseViolationKind,
} from "./violations";
import type { RegimeId } from "./types";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const CONSENT_OBLIGATION_ID = "sag-39-b-consent";

// Production phases that count as "active" — i.e. not wound down. Productions with
// no recorded status are treated as active so they are never silently hidden.
const ACTIVE_STATUSES = new Set(["development", "pre_production", "production", "post_production"]);

export function isActiveStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return ACTIVE_STATUSES.has(status);
}

export interface CastSummary {
  total: number;
  consented: number;
  linked: number;       // signed up, scan uploaded, awaiting consent
  invited: number;      // invite sent, no account yet
  placeholder: number;  // recorded by name only
  declined: number;
  sagMembers: number;
}

export interface ProductionOverviewRow {
  id: string;
  name: string;
  type: string | null;
  status: string | null;       // production phase
  active: boolean;
  year: number | null;
  sagProjectNumber: string | null;
  shortCode: string | null;
  orgId: string | null;
  orgName: string | null;
  licenceCount: number;
  healthScore: number;
  complianceStatus: ComplianceStatus;
  requiredGaps: number;
  coverageGaps: number;        // licences in use without recorded 39.B consent (current state)
  useViolations: number;       // licences provably used before/without consent (39.B breach)
  cast: CastSummary;
}

function countCast(rows: { status: string; sagMember: boolean }[]): CastSummary {
  const c: CastSummary = { total: 0, consented: 0, linked: 0, invited: 0, placeholder: 0, declined: 0, sagMembers: 0 };
  for (const r of rows) {
    c.total++;
    if (r.sagMember) c.sagMembers++;
    switch (r.status) {
      case "consented": c.consented++; break;
      case "linked":
      case "scan_uploaded": c.linked++; break;
      case "invited": c.invited++; break;
      case "placeholder": c.placeholder++; break;
      case "declined": c.declined++; break;
    }
  }
  return c;
}

/** Every production on the platform with compliance health, cast onboarding and coverage gaps. */
export async function buildProductionsOverview(db: Db, regime: RegimeId): Promise<ProductionOverviewRow[]> {
  // Reuse the platform dashboard for licence-level obligation evaluation so the
  // health scores and consent gaps match the rest of the compliance surface.
  const dash = await buildPlatformDashboard(db, regime);

  const prodIds = dash.productions.map((p) => p.id).filter((id): id is string => !!id);

  const metaRows = prodIds.length
    ? await db
        .select({
          id: productions.id,
          status: productions.status,
          year: productions.year,
          shortCode: productions.shortCode,
          organisationId: productions.organisationId,
          orgName: organisations.name,
        })
        .from(productions)
        .leftJoin(organisations, eq(productions.organisationId, organisations.id))
        .where(inArray(productions.id, prodIds))
        .all()
    : [];
  const metaMap = new Map(metaRows.map((m) => [m.id, m]));

  // Consent-before-use violations per production (batch, no N+1). A breach here is
  // a permanent historical fact — the likeness was downloaded/metered before any
  // 39.B consent existed — so unlike the coverage gap it is detected across every
  // licence regardless of current status.
  const violationsByProd = new Map<string, number>();
  if (prodIds.length) {
    const licRows = await db
      .select({ id: licences.id, productionId: licences.productionId, lastDownloadAt: licences.lastDownloadAt })
      .from(licences)
      .where(inArray(licences.productionId, prodIds))
      .all();
    const violations = await detectUseViolationsForLicences(db, licRows);
    for (const l of licRows) {
      if (l.productionId && isViolation(violations.get(l.id)?.kind ?? "none")) {
        violationsByProd.set(l.productionId, (violationsByProd.get(l.productionId) ?? 0) + 1);
      }
    }
  }

  // Cast onboarding counts per production (batch, no N+1).
  const castByProd = new Map<string, { status: string; sagMember: boolean }[]>();
  if (prodIds.length) {
    const castRows = await db
      .select({ productionId: productionCast.productionId, status: productionCast.status, sagMember: productionCast.sagMember })
      .from(productionCast)
      .where(inArray(productionCast.productionId, prodIds))
      .all();
    for (const r of castRows) {
      const list = castByProd.get(r.productionId) ?? [];
      list.push({ status: r.status, sagMember: !!r.sagMember });
      castByProd.set(r.productionId, list);
    }
  }

  const rows: ProductionOverviewRow[] = [];
  for (const p of dash.productions) {
    if (!p.id) continue; // skip licence-only groups with no production record
    const meta = metaMap.get(p.id);
    const coverageGaps = p.licences.filter((l) =>
      l.obligations.some((o) => o.id === CONSENT_OBLIGATION_ID && o.status === "gap"),
    ).length;
    rows.push({
      id: p.id,
      name: p.name,
      type: p.type,
      status: meta?.status ?? null,
      active: isActiveStatus(meta?.status ?? null),
      year: meta?.year ?? null,
      sagProjectNumber: p.sagProjectNumber,
      shortCode: meta?.shortCode ?? null,
      orgId: meta?.organisationId ?? null,
      orgName: meta?.orgName ?? null,
      licenceCount: p.licenceCount,
      healthScore: p.healthScore,
      complianceStatus: p.complianceStatus,
      requiredGaps: p.requiredGaps,
      coverageGaps,
      useViolations: violationsByProd.get(p.id) ?? 0,
      cast: countCast(castByProd.get(p.id) ?? []),
    });
  }

  // Sort worst first: active above wound-down, then most consent-before-use
  // violations (the union's hard cases), then lowest health.
  rows.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.useViolations !== b.useViolations) return b.useViolations - a.useViolations;
    return a.healthScore - b.healthScore;
  });

  return rows;
}

export interface CastMember {
  id: string;
  name: string;
  characterName: string | null;
  department: string | null;
  sagMember: boolean;
  status: string;
  talentId: string | null;
  licenceId: string | null;
  coverageGap: boolean;            // likeness licensed without a recorded 39.B consent (current state)
  useViolation: UseViolationKind;  // likeness provably used before/without consent (39.B breach)
}

export interface ProductionCastDetail {
  productionId: string;
  productionName: string;
  cast: CastMember[];
}

/** Cast roster for one production, with per-member coverage-gap flags. */
export async function getProductionCast(
  db: Db,
  productionId: string,
  regime: RegimeId,
): Promise<ProductionCastDetail | null> {
  const prod = await db
    .select({ id: productions.id, name: productions.name })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!prod) return null;

  // Evaluate this production's licences to find consent gaps (likeness in use
  // without a recorded Article 39.B consent).
  const licenceRows = await db
    .select({
      id: licences.id,
      licenceType: licences.licenceType,
      permitAiTraining: licences.permitAiTraining,
      status: licences.status,
      scrubAttestedAt: licences.scrubAttestedAt,
      scrubDeadline: licences.scrubDeadline,
      createdAt: licences.createdAt,
      lastDownloadAt: licences.lastDownloadAt,
    })
    .from(licences)
    .where(eq(licences.productionId, productionId))
    .all();

  const gapLicenceIds = new Set<string>();
  const violationByLicence = new Map<string, UseViolationKind>();
  if (licenceRows.length) {
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
      .where(inArray(complianceEvents.licenceId, licenceRows.map((l) => l.id)))
      .orderBy(complianceEvents.seq)
      .all();

    const eventsByLicence = new Map<string, LicenceEventRow[]>();
    for (const e of eventRows) {
      if (!e.licenceId) continue;
      const list = eventsByLicence.get(e.licenceId) ?? [];
      list.push({ eventType: e.eventType, scopeJson: e.scopeJson, seq: e.seq, createdAt: e.createdAt, hash: e.hash });
      eventsByLicence.set(e.licenceId, list);
    }

    for (const l of licenceRows) {
      const events = eventsByLicence.get(l.id) ?? [];
      const row: LicenceRow = { ...l };
      const obligations = evaluateLicence(row, events, regime);
      if (obligations.some((o) => o.id === CONSENT_OBLIGATION_ID && o.status === "gap")) {
        gapLicenceIds.add(l.id);
      }
      violationByLicence.set(l.id, detectUseViolation(l, events).kind);
    }
  }

  const castRows = await db
    .select({
      id: productionCast.id,
      talentId: productionCast.talentId,
      licenceId: productionCast.licenceId,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      department: productionCast.department,
      sagMember: productionCast.sagMember,
      status: productionCast.status,
      fullName: talentProfiles.fullName,
      email: users.email,
    })
    .from(productionCast)
    .leftJoin(talentProfiles, eq(productionCast.talentId, talentProfiles.userId))
    .leftJoin(users, eq(productionCast.talentId, users.id))
    .where(eq(productionCast.productionId, productionId))
    .all();

  const cast: CastMember[] = castRows.map((r) => ({
    id: r.id,
    name: r.fullName ?? r.actorName ?? r.email ?? "Unknown",
    characterName: r.characterName,
    department: r.department,
    sagMember: !!r.sagMember,
    status: r.status,
    talentId: r.talentId,
    licenceId: r.licenceId,
    coverageGap: !!r.licenceId && gapLicenceIds.has(r.licenceId),
    useViolation: (r.licenceId && violationByLicence.get(r.licenceId)) || "none",
  }));

  // Hard violations first, then coverage gaps, then SAG members — the union's
  // priority order.
  cast.sort((a, b) => {
    const av = isViolation(a.useViolation), bv = isViolation(b.useViolation);
    if (av !== bv) return av ? -1 : 1;
    if (a.coverageGap !== b.coverageGap) return a.coverageGap ? -1 : 1;
    if (a.sagMember !== b.sagMember) return a.sagMember ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { productionId: prod.id, productionName: prod.name, cast };
}
