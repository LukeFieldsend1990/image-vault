/**
 * The sweep's own record of what it searched for.
 *
 * Discovery spends real money on terms chosen by a query planner that mixes a
 * standing vocabulary, mined hashtags and vigilance personas — so "which tags
 * did this run actually issue, and did any of them return anything" is the
 * first question an admin asks of a sweep. Until now it was only answerable in
 * fragments: `apify_usage` books the paid runs (to police spend, not to explain
 * coverage) and `likeness_hits.discovery_source` names the term behind a hit
 * that landed, which says nothing about the terms that came back empty.
 *
 * Every surface writes here, paid and free alike, one row per term issued.
 * Rows are collected in memory during discovery and flushed once — a sweep
 * issues a couple of dozen queries and D1 round-trips inside a queue consumer
 * are the scarce resource.
 */

import { getDb } from "@/lib/db";
import { apifyUsage, likenessHits, monitorScanQueries } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export interface ScanQueryEntry {
  platform: string;
  /** hashtag | account | user_search | <platform>_search | <platform>_serp | simulated */
  mode: string;
  /** The term itself — hashtag without '#', search string, or handle. */
  query: string;
  /** Raw items the surface returned, pre-filter. Null when not separable. */
  resultCount: number | null;
  costUsd?: number | null;
  status?: "succeeded" | "failed";
  error?: string | null;
}

/**
 * Which surface a recorded Apify run belongs to.
 *
 * Every module but Instagram already stamps a platform-specific mode on its
 * usage rows (`tiktok_search`, `getty_serp`, …); Instagram predates that and
 * still records the bare DiscoveryMode. Actor ids would work too, but the SERP
 * actor serves both Google and Getty, so mode is the more faithful key and the
 * caller passes an explicit platform where mode cannot decide.
 */
export function platformForMode(mode: string | null | undefined): string {
  const m = (mode ?? "").toLowerCase();
  // Instagram's own modes, from lib/monitor/ingest/queries.ts. Checked first:
  // 'user_search' is a DiscoveryMode, not the `<platform>_search` shape, and
  // the suffix rule below would otherwise file it under a platform called
  // "user".
  if (m === "hashtag" || m === "account" || m === "user_search") return "instagram";
  const suffixed = m.match(/^([a-z]+)_(search|serp)$/);
  if (suffixed) return suffixed[1];
  return "unknown";
}

/**
 * Rows per insert. D1 caps bound parameters per statement (the codebase's
 * standing allowance is 80, see lib/monitor/rep-view.ts) and each row here
 * binds eleven columns, so eight rows is the largest safe batch.
 */
const INSERT_CHUNK = 8;

/** Read chunk for id lists, matching the parameter allowance used elsewhere. */
const READ_CHUNK = 80;

/** Insert a sweep's query log. Never throws — a lost log must not fail a sweep. */
export async function recordScanQueries(
  db: Db,
  scanId: string,
  talentId: string,
  entries: ScanQueryEntry[]
): Promise<void> {
  if (!entries.length) return;
  const now = Math.floor(Date.now() / 1000);
  const rows = entries.map((e) => ({
    id: crypto.randomUUID(),
    scanId,
    talentId,
    platform: e.platform,
    mode: e.mode,
    query: e.query,
    resultCount: e.resultCount,
    costUsd: e.costUsd ?? 0,
    status: e.status ?? ("succeeded" as const),
    error: e.error ?? null,
    createdAt: now,
  }));
  try {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await db.insert(monitorScanQueries).values(rows.slice(i, i + INSERT_CHUNK));
    }
  } catch (err) {
    console.warn(`[monitor] scan-query log failed for ${scanId}: ${(err as Error).message}`);
  }
}

// ── Read side ────────────────────────────────────────────────────────────────

export interface ScanQueryView {
  platform: string;
  mode: string;
  query: string;
  resultCount: number | null;
  hitCount: number;
  costUsd: number;
  status: "succeeded" | "failed";
  error: string | null;
  /** True when the row was reconstructed from the Apify ledger, not logged by the sweep. */
  fromLedger: boolean;
}

/**
 * Does this hit's `discovery_source` name this query?
 *
 * Sources are written as `${mode}:${query}`, and several surfaces prefix the
 * term with their own platform (`hashtag:tiktok:tomhardyai`), so an exact
 * equality check would miss more than it caught. Matching on the trailing term
 * is tolerant of those prefixes; the hit's own platform column disambiguates
 * the rest, since the same tag is routinely swept on several surfaces in one
 * run and the term alone cannot say which of them produced the hit.
 */
function sourceNamesQuery(source: string | null, query: string): boolean {
  if (!source || !query) return false;
  // '#' is decoration, not identity: some builders hand the actor '#tag' and
  // some hand it 'tag', and the same term must count either way.
  const norm = (v: string) => v.toLowerCase().replace(/#/g, "");
  const s = norm(source);
  const q = norm(query);
  if (!q) return false;
  return s === q || s.endsWith(`:${q}`);
}

/** Run an id-list query in parameter-safe chunks and concatenate the rows. */
async function chunked<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length <= READ_CHUNK) return run(ids);
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    out.push(...(await run(ids.slice(i, i + READ_CHUNK))));
  }
  return out;
}

/**
 * The query log for a set of sweeps, keyed by scan id.
 *
 * Sweeps that ran before this log existed still have their paid runs in the
 * Apify ledger, so those are read back as a fallback rather than showing an
 * admin an empty panel for every historic run. Ledger-derived rows are flagged:
 * they cover only the paid surfaces, and saying so is better than implying a
 * run searched nothing else.
 */
export async function loadScanQueries(
  db: Db,
  scanIds: string[]
): Promise<Map<string, ScanQueryView[]>> {
  const out = new Map<string, ScanQueryView[]>();
  if (!scanIds.length) return out;

  const [logged, hits] = await Promise.all([
    chunked(scanIds, (ids) =>
      db
        .select({
          scanId: monitorScanQueries.scanId,
          platform: monitorScanQueries.platform,
          mode: monitorScanQueries.mode,
          query: monitorScanQueries.query,
          resultCount: monitorScanQueries.resultCount,
          costUsd: monitorScanQueries.costUsd,
          status: monitorScanQueries.status,
          error: monitorScanQueries.error,
        })
        .from(monitorScanQueries)
        .where(inArray(monitorScanQueries.scanId, ids))
        .all()
    ),
    chunked(scanIds, (ids) =>
      db
        .select({
          scanId: likenessHits.scanId,
          platform: likenessHits.platform,
          discoverySource: likenessHits.discoverySource,
        })
        .from(likenessHits)
        .where(inArray(likenessHits.scanId, ids))
        .all()
    ),
  ]);

  type HitRef = { platform: string; discoverySource: string | null };
  const hitsByScan = new Map<string, HitRef[]>();
  for (const h of hits) {
    const list = hitsByScan.get(h.scanId);
    if (list) list.push(h);
    else hitsByScan.set(h.scanId, [h]);
  }
  const hitsFor = (scanId: string, platform: string, query: string) =>
    (hitsByScan.get(scanId) ?? []).filter(
      (h) => h.platform === platform && sourceNamesQuery(h.discoverySource, query)
    ).length;

  for (const row of logged) {
    const list = out.get(row.scanId) ?? [];
    list.push({
      platform: row.platform,
      mode: row.mode,
      query: row.query,
      resultCount: row.resultCount,
      hitCount: hitsFor(row.scanId, row.platform, row.query),
      costUsd: row.costUsd,
      status: row.status,
      error: row.error,
      fromLedger: false,
    });
    out.set(row.scanId, list);
  }

  const missing = scanIds.filter((id) => !out.has(id));
  if (missing.length) {
    const ledger = await chunked(missing, (ids) =>
      db
        .select({
          scanId: apifyUsage.scanId,
          mode: apifyUsage.mode,
          query: apifyUsage.query,
          itemCount: apifyUsage.itemCount,
          costUsd: apifyUsage.costUsd,
          status: apifyUsage.status,
          error: apifyUsage.error,
        })
        .from(apifyUsage)
        .where(inArray(apifyUsage.scanId, ids))
        .all()
    );

    for (const row of ledger) {
      if (!row.scanId || !row.query) continue;
      const platform = platformForMode(row.mode);
      const list = out.get(row.scanId) ?? [];
      list.push({
        platform,
        mode: row.mode ?? "unknown",
        query: row.query,
        resultCount: row.itemCount,
        hitCount: hitsFor(row.scanId, platform, row.query),
        costUsd: row.costUsd,
        status: row.status === "failed" ? "failed" : "succeeded",
        error: row.error,
        fromLedger: true,
      });
      out.set(row.scanId, list);
    }
  }

  // Platform, then most productive first — the reading order for "what worked".
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        a.platform.localeCompare(b.platform) ||
        b.hitCount - a.hitCount ||
        (b.resultCount ?? -1) - (a.resultCount ?? -1) ||
        a.query.localeCompare(b.query)
    );
  }

  return out;
}
