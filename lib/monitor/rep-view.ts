/**
 * Rep roster monitor view: read-only visibility across a rep's managed
 * talent (the SPEC §18.5 deferral), plus cross-client offender
 * intelligence — an account hitting four of a rep's clients is one legal
 * action, not four.
 *
 * Privacy stance, inherited from the talent-facing monitor: a rep sees
 * their OWN clients' data fully (they already receive likeness-hit
 * notifications via notifyTalentAndReps); everything about talent outside
 * their roster is a bare count. The one subtle leak point is
 * `secondaryActors` on hits — it can carry other *onboarded* talents'
 * ids/membership. `filterSecondaryActorsForRoster` sanitises it: roster
 * members pass through whole; everyone else keeps their public name/photo
 * but loses talentId and the onboarded flag.
 *
 * Read-only is structural: this module only selects, and the routes that
 * consume it define no mutating handlers.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  likenessHits,
  likenessMonitors,
  monitorAccounts,
  monitorScans,
  talentProfiles,
  talentReps,
} from "@/lib/db/schema";
import { getActiveReferences } from "./reference-set";
import { buildCoveragePayload } from "./coverage";
import { formatCompact, priorityScore, type OffenderStatus } from "./accounts";
import { getMonitorState } from "./scan";

type Db = ReturnType<typeof getDb>;

// "Open" for a rep = status in ('new','confirmed','takedown_requested'),
// inlined in the aggregate SQL below.
const CHUNK = 80; // D1 parameter-cap chunking, as elsewhere in lib/monitor

export interface RosterTalentMonitor {
  talentId: string;
  fullName: string;
  profileImageUrl: string | null;
  monitor: { status: string; cadence: string; scope: string; lastScanAt: number | null } | null;
  coverage: { tier: string; score: number };
  referenceCount: number;
  hits: { open: number; total: number; last30d: number; latestAt: number | null };
  lastScan: { status: string; startedAt: number; completedAt: number | null } | null;
}

async function rosterTalentIds(db: Db, repId: string): Promise<string[]> {
  const rows = await db
    .select({ talentId: talentReps.talentId })
    .from(talentReps)
    .where(eq(talentReps.repId, repId))
    .all();
  return rows.map((r) => r.talentId);
}

export async function getRosterMonitorOverview(
  db: Db,
  repId: string
): Promise<{ talents: RosterTalentMonitor[] }> {
  const talentIds = await rosterTalentIds(db, repId);
  if (!talentIds.length) return { talents: [] };

  const profiles: { userId: string; fullName: string; profileImageUrl: string | null }[] = [];
  const monitors: (typeof likenessMonitors.$inferSelect)[] = [];
  const hitAggregates: {
    talentId: string;
    total: number;
    open: number;
    last30d: number;
    latestAt: number | null;
  }[] = [];
  const latestScans: (typeof monitorScans.$inferSelect)[] = [];

  const since30d = Math.floor(Date.now() / 1000) - 30 * 86400;
  for (let i = 0; i < talentIds.length; i += CHUNK) {
    const chunk = talentIds.slice(i, i + CHUNK);
    const [p, m, h, s] = await Promise.all([
      db
        .select({
          userId: talentProfiles.userId,
          fullName: talentProfiles.fullName,
          profileImageUrl: talentProfiles.profileImageUrl,
        })
        .from(talentProfiles)
        .where(inArray(talentProfiles.userId, chunk))
        .all(),
      db.select().from(likenessMonitors).where(inArray(likenessMonitors.talentId, chunk)).all(),
      db
        .select({
          talentId: likenessHits.talentId,
          total: sql<number>`count(*)`,
          open: sql<number>`sum(case when ${likenessHits.status} in ('new','confirmed','takedown_requested') then 1 else 0 end)`,
          last30d: sql<number>`sum(case when ${likenessHits.detectedAt} > ${since30d} then 1 else 0 end)`,
          latestAt: sql<number | null>`max(${likenessHits.detectedAt})`,
        })
        .from(likenessHits)
        .where(inArray(likenessHits.talentId, chunk))
        .groupBy(likenessHits.talentId)
        .all(),
      // Latest scan per talent: small roster, so a per-chunk fetch of recent
      // rows and a client-side pick beats a correlated subquery on D1.
      db
        .select()
        .from(monitorScans)
        .where(inArray(monitorScans.talentId, chunk))
        .orderBy(desc(monitorScans.startedAt))
        .limit(chunk.length * 3)
        .all(),
    ]);
    profiles.push(...p);
    monitors.push(...m);
    hitAggregates.push(...h);
    latestScans.push(...s);
  }

  const profileByTalent = new Map(profiles.map((p) => [p.userId, p]));
  const monitorByTalent = new Map(monitors.map((m) => [m.talentId, m]));
  const hitsByTalent = new Map(hitAggregates.map((h) => [h.talentId, h]));
  const latestScanByTalent = new Map<string, (typeof latestScans)[number]>();
  for (const scan of latestScans) {
    if (!latestScanByTalent.has(scan.talentId)) latestScanByTalent.set(scan.talentId, scan);
  }

  const talents: RosterTalentMonitor[] = [];
  for (const talentId of talentIds) {
    const profile = profileByTalent.get(talentId);
    const monitor = monitorByTalent.get(talentId);
    const hits = hitsByTalent.get(talentId);
    const scan = latestScanByTalent.get(talentId);

    // Coverage reuses the exact payload the talent sees — one source of
    // truth for the tier maths. Roster sizes are small; N queries is fine
    // (mirrors the /api/roster enrichment style).
    const refs = await getActiveReferences(db, talentId);
    const coveragePayload = await buildCoveragePayload(db, talentId, refs);

    talents.push({
      talentId,
      fullName: profile?.fullName ?? "Unknown talent",
      profileImageUrl: profile?.profileImageUrl ?? null,
      monitor: monitor
        ? {
            status: monitor.status,
            cadence: monitor.cadence,
            scope: monitor.scope,
            lastScanAt: monitor.lastScanAt,
          }
        : null,
      coverage: { tier: coveragePayload.coverage.tier, score: coveragePayload.coverage.score },
      referenceCount: coveragePayload.referenceCount,
      hits: {
        open: hits?.open ?? 0,
        total: hits?.total ?? 0,
        last30d: hits?.last30d ?? 0,
        latestAt: hits?.latestAt ?? null,
      },
      lastScan: scan
        ? { status: scan.status, startedAt: scan.startedAt, completedAt: scan.completedAt }
        : null,
    });
  }

  // Most urgent first: open hits, then recency of last hit.
  talents.sort((a, b) => b.hits.open - a.hits.open || (b.hits.latestAt ?? 0) - (a.hits.latestAt ?? 0));
  return { talents };
}

export interface CrossClientOffender {
  accountId: string;
  platform: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  status: string;
  cumulativeViews: number;
  cumulativeViewsCompact: string;
  priority: { score: number; reason: string };
  clientsAffected: { talentId: string; name: string; hitCount: number; openHitCount: number }[];
  /** Talent outside this rep's roster also hit by the account — a bare
   *  count, deliberately nothing more. */
  otherTalentAffectedCount: number;
}

export async function getCrossClientOffenders(db: Db, repId: string): Promise<CrossClientOffender[]> {
  const talentIds = await rosterTalentIds(db, repId);
  if (talentIds.length < 2) return [];

  const perAccountTalent: { accountId: string; talentId: string; hitCount: number; openHitCount: number }[] = [];
  for (let i = 0; i < talentIds.length; i += CHUNK) {
    const chunk = talentIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        accountId: sql<string>`${likenessHits.accountId}`,
        talentId: likenessHits.talentId,
        hitCount: sql<number>`count(*)`,
        openHitCount: sql<number>`sum(case when ${likenessHits.status} in ('new','confirmed','takedown_requested') then 1 else 0 end)`,
      })
      .from(likenessHits)
      .where(and(inArray(likenessHits.talentId, chunk), isNotNull(likenessHits.accountId)))
      .groupBy(likenessHits.accountId, likenessHits.talentId)
      .all();
    perAccountTalent.push(...rows);
  }

  const byAccount = new Map<string, typeof perAccountTalent>();
  for (const row of perAccountTalent) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }
  const crossClientIds = [...byAccount.entries()]
    .filter(([, rows]) => new Set(rows.map((r) => r.talentId)).size >= 2)
    .map(([accountId]) => accountId);
  if (!crossClientIds.length) return [];

  const accounts: (typeof monitorAccounts.$inferSelect)[] = [];
  for (let i = 0; i < crossClientIds.length; i += CHUNK) {
    accounts.push(
      ...(await db
        .select()
        .from(monitorAccounts)
        .where(inArray(monitorAccounts.id, crossClientIds.slice(i, i + CHUNK)))
        .all())
    );
  }

  const names = new Map<string, string>();
  for (let i = 0; i < talentIds.length; i += CHUNK) {
    const rows = await db
      .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
      .from(talentProfiles)
      .where(inArray(talentProfiles.userId, talentIds.slice(i, i + CHUNK)))
      .all();
    for (const r of rows) names.set(r.userId, r.fullName);
  }

  const offenders = accounts.map((account) => {
    const rows = byAccount.get(account.id) ?? [];
    const clientsAffected = rows
      .map((r) => ({
        talentId: r.talentId,
        name: names.get(r.talentId) ?? "Unknown talent",
        hitCount: r.hitCount,
        openHitCount: r.openHitCount,
      }))
      .sort((a, b) => b.openHitCount - a.openHitCount || b.hitCount - a.hitCount);
    const openHitsForRoster = clientsAffected.reduce((sum, c) => sum + c.openHitCount, 0);
    return {
      accountId: account.id,
      platform: account.platform,
      handle: account.handle,
      displayName: account.displayName,
      followerCount: account.followerCount,
      status: account.status,
      cumulativeViews: account.cumulativeViews,
      cumulativeViewsCompact: formatCompact(account.cumulativeViews),
      priority: priorityScore({
        cumulativeViews: account.cumulativeViews,
        lastSeenAt: account.lastSeenAt,
        openHitsForTalent: openHitsForRoster,
        talentAffectedCount: account.talentAffectedCount,
        status: account.status as OffenderStatus,
      }),
      clientsAffected,
      otherTalentAffectedCount: Math.max(
        0,
        account.talentAffectedCount - new Set(rows.map((r) => r.talentId)).size
      ),
    };
  });

  offenders.sort((a, b) => b.priority.score - a.priority.score);
  return offenders;
}

// ── Per-talent detail (rep-sanitised) ───────────────────────────────────────

interface SecondaryActorLike {
  talentId: string | null;
  name: string;
  profileImageUrl: string | null;
  confidence: number | null;
  source: string;
  onboarded?: boolean;
}

interface HitWithSecondaries {
  secondaryActors: SecondaryActorLike[];
}

/**
 * Sanitise secondary actors for a rep viewer: roster members pass through
 * whole; everyone else keeps public name/photo but loses their talentId and
 * the onboarded flag — platform membership of non-roster talent is not the
 * rep's to see. Pure, so the privacy boundary is testable.
 */
export function filterSecondaryActorsForRoster<T extends HitWithSecondaries>(
  hits: T[],
  rosterIds: Set<string>
): T[] {
  return hits.map((hit) => ({
    ...hit,
    secondaryActors: hit.secondaryActors.map((actor) =>
      actor.talentId !== null && !rosterIds.has(actor.talentId)
        ? {
            ...actor,
            talentId: null,
            onboarded: undefined,
          }
        : actor
    ),
  }));
}

/** The talent monitor page's state, coverage attached, rep-sanitised. */
export async function getTalentMonitorForRep(db: Db, repId: string, talentId: string) {
  const rosterIds = new Set(await rosterTalentIds(db, repId));
  const state = await getMonitorState(db, talentId);
  const refs = await getActiveReferences(db, talentId);
  const coverage = await buildCoveragePayload(db, talentId, refs);
  return {
    ...state,
    hits: filterSecondaryActorsForRoster(state.hits, rosterIds),
    coverage,
  };
}
