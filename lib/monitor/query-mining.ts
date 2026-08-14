/**
 * Query-mining pass. Runs after a sweep persists new hits: extract the
 * hashtags actually present on confirmed hits and remember the ones we
 * didn't ask for. Next sweep, the query builder pulls the top mined
 * hashtags per talent and adds them to the base vocabulary.
 *
 * Deliberately per-talent — a hashtag that yields Tom Hardy content
 * (e.g. the fake role name #tomhardyrayleigh) isn't necessarily useful
 * for Scarjo. Global vocabulary lives in queries.ts (ROSTER_AI_HASHTAGS).
 */

import { getDb } from "@/lib/db";
import { monitorLearnedQueries } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AI_INTENT_MARKERS, ROSTER_AI_HASHTAGS } from "./ingest/queries";

type Db = ReturnType<typeof getDb>;

/**
 * Hashtags we already sweep as part of the base vocabulary. Learned
 * queries that overlap with these are pointless — we already query them.
 * Lowercased for direct comparison.
 */
const GLOBAL_KNOWN = new Set<string>([
  ...ROSTER_AI_HASHTAGS,
  ...AI_INTENT_MARKERS.filter((s) => /^[a-z]+$/i.test(s)).map((s) => s.toLowerCase()),
]);

/** Extract #hashtags from a caption string. Lowercased, no leading '#'. */
export function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const out = new Set<string>();
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]{2,50})/gu)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/**
 * Filter a hashtag list down to the ones worth remembering. Kills:
 *   - too-short (<4 chars) — too generic to be a useful discovery lever
 *   - already in the base vocabulary — already querying it
 *   - purely numeric — spam / not descriptive
 */
export function candidateHashtags(hashtags: string[]): string[] {
  return hashtags.filter((h) => {
    if (h.length < 4 || h.length > 40) return false;
    if (/^\d+$/.test(h)) return false;
    if (GLOBAL_KNOWN.has(h)) return false;
    return true;
  });
}

/**
 * Upsert every candidate hashtag from the new hits into
 * monitor_learned_queries. Increments hit_count when a hashtag reappears,
 * so the query builder can rank by yield.
 *
 * Called with the platform of the hits (tiktok / instagram / youtube) —
 * a hashtag learned on TikTok gets added to the TikTok query set, not
 * cross-platform, because a TikTok phrase might not exist on Instagram.
 */
export async function recordLearnedHashtags(
  db: Db,
  talentId: string,
  hits: Array<{ platform: string; caption: string | null }>
): Promise<{ recorded: number; skipped: number }> {
  const now = Math.floor(Date.now() / 1000);

  // Group hits by platform so we upsert per (talentId, platform, query).
  const byPlatform = new Map<string, string[]>();
  for (const hit of hits) {
    const tags = candidateHashtags(extractHashtags(hit.caption));
    if (!tags.length) continue;
    const existing = byPlatform.get(hit.platform) ?? [];
    existing.push(...tags);
    byPlatform.set(hit.platform, existing);
  }

  let recorded = 0;
  let skipped = 0;
  for (const [platform, tags] of byPlatform) {
    // Dedupe and count within this batch so we upsert each hashtag once
    // per sweep, with the correct increment. Two hits sharing a hashtag
    // in one sweep count as +2 hit_count, not +1.
    const counts = new Map<string, number>();
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);

    for (const [query, delta] of counts) {
      try {
        await db
          .insert(monitorLearnedQueries)
          .values({
            id: crypto.randomUUID(),
            talentId,
            platform,
            query,
            hitCount: delta,
            firstSeenAt: now,
            lastSeenAt: now,
            active: true,
          })
          .onConflictDoUpdate({
            target: [monitorLearnedQueries.talentId, monitorLearnedQueries.platform, monitorLearnedQueries.query],
            set: {
              hitCount: sql`${monitorLearnedQueries.hitCount} + ${delta}`,
              lastSeenAt: now,
              // Re-activate if a previously-inactive query starts producing again.
              active: true,
            },
          });
        recorded++;
      } catch {
        skipped++;
      }
    }
  }
  return { recorded, skipped };
}

/**
 * Read the top-N learned queries for a talent + platform, ordered by
 * hit_count desc. Called by the ingest query builders to expand their
 * hardcoded vocabulary with what the data has taught us. Returns just
 * the strings, in yield order.
 */
export async function topLearnedQueries(
  db: Db,
  talentId: string,
  platform: string,
  limit = 5
): Promise<string[]> {
  const rows = await db
    .select({ query: monitorLearnedQueries.query })
    .from(monitorLearnedQueries)
    .where(
      and(
        eq(monitorLearnedQueries.talentId, talentId),
        eq(monitorLearnedQueries.platform, platform),
        eq(monitorLearnedQueries.active, true)
      )
    )
    .orderBy(desc(monitorLearnedQueries.hitCount))
    .limit(limit)
    .all();
  return rows.map((r) => r.query);
}
