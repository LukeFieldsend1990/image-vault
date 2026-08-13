/**
 * Offender account case files.
 *
 * The hit feed answers "what did they post"; this answers "who is doing this to
 * me, and how big are they getting". That second question is the one that
 * matters, because takedowns are whack-a-mole while the account is the thing
 * that has to accumulate reach in order to monetise. Kill the reach and the
 * incentive goes with it.
 *
 * Scoping rule: a talent only ever sees accounts that have hit *them*. The
 * cross-talent figure is exposed as a bare count — "also targeting 4 other
 * protected talent" — because that count is the escalation signal, while the
 * identities behind it are somebody else's business.
 */

import { getDb } from "@/lib/db";
import { likenessHits, monitorAccounts, hitSecondaryActors, talentProfiles } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export type OffenderStatus = "watchlist" | "reported" | "suspended" | "cleared";

export interface SecondaryActorSummary {
  talentId: string | null;
  name: string;
  profileImageUrl: string | null;
  confidence: number;
  source: string;
  onboarded: boolean;
}

export interface OffenderHit {
  id: string;
  contentUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  discoverySource: string | null;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: string;
  status: string;
  detectedAt: number;
  secondaryActors: SecondaryActorSummary[];
}

export interface OffenderAccount {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  hitCount: number;
  cumulativeViews: number;
  /** Number of protected talent this account has hit, this one included. */
  talentAffectedCount: number;
  status: OffenderStatus;
  notes: string | null;
  /** Scoped to the requesting talent. */
  hitsForTalent: number;
  openHitsForTalent: number;
  priority: number;
  priorityReason: string;
  hits: OffenderHit[];
}

const DAY = 86_400;
const OPEN_STATUSES = new Set(["new", "confirmed", "takedown_requested"]);

/**
 * Rank the queue by what actually breaks the business model.
 *
 * Reach dominates — a 200-view reel from a 40-follower account is noise next to
 * the same reel on a 400k account. Recency matters second, because platform
 * payouts accrue while content is live, so the first 48 hours are where a
 * takedown recovers the most value. Cross-talent breadth is the escalation
 * multiplier: an account farming several protected talent is a business, and
 * that is the case that moves trust-and-safety off per-post forms.
 */
export function priorityScore(a: {
  cumulativeViews: number;
  lastSeenAt: number;
  openHitsForTalent: number;
  talentAffectedCount: number;
  status: OffenderStatus;
  now?: number;
}): { score: number; reason: string } {
  if (a.status === "cleared" || a.status === "suspended") {
    return { score: 0, reason: a.status === "suspended" ? "Account removed" : "Cleared — no action needed" };
  }

  const now = a.now ?? Math.floor(Date.now() / 1000);
  const daysSinceSeen = Math.max(0, (now - a.lastSeenAt) / DAY);

  // log-scaled: the gap between 1k and 10k views matters more than 900k to 1M.
  const reach = Math.min(50, Math.log10(a.cumulativeViews + 1) * 9);
  const freshness = daysSinceSeen <= 2 ? 25 : daysSinceSeen <= 7 ? 15 : daysSinceSeen <= 30 ? 6 : 0;
  const open = Math.min(15, a.openHitsForTalent * 5);
  const breadth = Math.min(10, Math.max(0, a.talentAffectedCount - 1) * 5);

  const score = Math.round(Math.min(100, reach + freshness + open + breadth));

  const reasons: string[] = [];
  if (a.cumulativeViews >= 1000) reasons.push(`${formatCompact(a.cumulativeViews)} views across flagged posts`);
  if (daysSinceSeen <= 2) reasons.push("posted in the last 48h");
  else if (daysSinceSeen <= 7) reasons.push("active this week");
  if (a.talentAffectedCount > 1) reasons.push(`targeting ${a.talentAffectedCount} protected talent`);
  if (a.openHitsForTalent > 1) reasons.push(`${a.openHitsForTalent} open hits`);

  return {
    score,
    reason: reasons.length ? reasons.join(" · ") : "Low reach, no recent activity",
  };
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Accounts that have hit this talent, reach-ranked, each with its hits. */
export async function listOffenderAccounts(db: Db, talentId: string): Promise<OffenderAccount[]> {
  const hits = await db
    .select()
    .from(likenessHits)
    .where(eq(likenessHits.talentId, talentId))
    .all();

  const accountIds = [...new Set(hits.map((h) => h.accountId).filter((id): id is string => !!id))];
  if (!accountIds.length) return [];

  const accounts = await db
    .select()
    .from(monitorAccounts)
    .where(inArray(monitorAccounts.id, accountIds))
    .all();

  // Stack secondary actors on every hit at once. D1 caps parameters per
  // statement at ~100, and Tom Hardy's monitor already sits on 100+ hits,
  // so batch the IN(...) lookup rather than relying on the driver to
  // handle it (same fix as the flagged-URL dedupe in lib/monitor/scan.ts).
  const hitIds = hits.map((h) => h.id);
  const secondaries: Awaited<ReturnType<typeof queryChunk>> = [];
  async function queryChunk(chunk: string[]) {
    return db
      .select({
        hitId: hitSecondaryActors.hitId,
        talentId: hitSecondaryActors.talentId,
        tmdbName: hitSecondaryActors.tmdbName,
        tmdbProfileUrl: hitSecondaryActors.tmdbProfileUrl,
        confidence: hitSecondaryActors.confidence,
        source: hitSecondaryActors.source,
        onboardedName: talentProfiles.fullName,
        onboardedImageUrl: talentProfiles.profileImageUrl,
      })
      .from(hitSecondaryActors)
      .leftJoin(talentProfiles, eq(talentProfiles.userId, hitSecondaryActors.talentId))
      .where(inArray(hitSecondaryActors.hitId, chunk))
      .all();
  }
  const CHUNK = 80;
  for (let i = 0; i < hitIds.length; i += CHUNK) {
    const rows = await queryChunk(hitIds.slice(i, i + CHUNK));
    secondaries.push(...rows);
  }
  const secondariesByHit = new Map<string, SecondaryActorSummary[]>();
  for (const s of secondaries) {
    const list = secondariesByHit.get(s.hitId) ?? [];
    list.push({
      talentId: s.talentId,
      name: s.onboardedName ?? s.tmdbName ?? "Unknown",
      profileImageUrl: s.onboardedImageUrl ?? s.tmdbProfileUrl ?? null,
      confidence: s.confidence,
      source: s.source,
      onboarded: s.talentId !== null,
    });
    secondariesByHit.set(s.hitId, list);
  }

  const now = Math.floor(Date.now() / 1000);

  const built = accounts.map((acc) => {
    const own = hits
      .filter((h) => h.accountId === acc.id)
      .sort((a, b) => b.detectedAt - a.detectedAt);
    const openHitsForTalent = own.filter((h) => OPEN_STATUSES.has(h.status)).length;
    const status = acc.status as OffenderStatus;
    const { score, reason } = priorityScore({
      cumulativeViews: acc.cumulativeViews,
      lastSeenAt: acc.lastSeenAt,
      openHitsForTalent,
      talentAffectedCount: acc.talentAffectedCount,
      status,
      now,
    });

    return {
      id: acc.id,
      platform: acc.platform,
      handle: acc.handle,
      displayName: acc.displayName,
      followerCount: acc.followerCount,
      firstSeenAt: acc.firstSeenAt,
      lastSeenAt: acc.lastSeenAt,
      hitCount: acc.hitCount,
      cumulativeViews: acc.cumulativeViews,
      talentAffectedCount: acc.talentAffectedCount,
      status,
      notes: acc.notes,
      hitsForTalent: own.length,
      openHitsForTalent,
      priority: score,
      priorityReason: reason,
      hits: own.map((h) => ({
        id: h.id,
        contentUrl: h.contentUrl,
        caption: h.caption,
        thumbnailUrl: h.thumbnailUrl,
        discoverySource: h.discoverySource,
        confidence: h.confidence,
        aiGeneratedLikelihood: h.aiGeneratedLikelihood,
        riskLevel: h.riskLevel,
        status: h.status,
        detectedAt: h.detectedAt,
        secondaryActors: secondariesByHit.get(h.id) ?? [],
      })),
    };
  });

  return built.sort((a, b) => b.priority - a.priority || b.cumulativeViews - a.cumulativeViews);
}

/**
 * Update an account's case status.
 *
 * Guarded on the talent having at least one hit against the account: a
 * monitor_accounts row is shared across the roster, so without this check one
 * talent could clear an account that is actively targeting somebody else.
 */
export async function updateOffenderAccount(
  db: Db,
  accountId: string,
  talentId: string,
  patch: { status?: OffenderStatus; notes?: string }
): Promise<boolean> {
  const own = await db
    .select({ id: likenessHits.id })
    .from(likenessHits)
    .where(and(eq(likenessHits.accountId, accountId), eq(likenessHits.talentId, talentId)))
    .limit(1)
    .get();
  if (!own) return false;

  const set: Record<string, unknown> = {};
  if (patch.status) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes.slice(0, 2000);
  if (!Object.keys(set).length) return false;

  await db.update(monitorAccounts).set(set).where(eq(monitorAccounts.id, accountId));
  return true;
}
