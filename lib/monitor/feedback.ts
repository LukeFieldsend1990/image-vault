/**
 * Detection-feedback aggregation: human verdicts on likeness hits read back
 * as a tuning signal for the scan model.
 *
 * Every hit eventually collects a verdict — confirmed (takedown_requested and
 * resolved imply confirmation; nobody files a takedown on a hit they think is
 * a false positive), dismissed with a structured reason, or silenced at the
 * account level via the whitelist. The dismissal reasons partition detector
 * error from policy: `not_me` indicts the likeness matcher, `not_ai` the
 * synthetic check, `not_misuse` means the detectors were right and the human
 * made a policy call.
 *
 * Consumed by the admin panel routes (/api/admin/monitor/feedback[/export])
 * and the MCP detection-feedback tools — one implementation, two transports.
 */

import type { getDb } from "@/lib/db";
import { likenessHits, talentAccountWhitelist, talentProfiles, users } from "@/lib/db/schema";
import { and, desc, eq, gte, ne, or, sql } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

const CONFIRMED_SQL = sql`${likenessHits.status} IN ('confirmed','takedown_requested','resolved')`;

const VERDICT_LABEL_SQL = sql<string>`CASE
  WHEN ${CONFIRMED_SQL} THEN 'confirmed'
  ELSE 'dismissed:' || COALESCE(${likenessHits.dismissalReason}, 'other')
END`;

export interface FeedbackTotals {
  byStatus: Record<string, number>;
  dismissalReasons: Record<string, number>;
  whitelistReasons: Record<string, number>;
  adjudicated: number;
  confirmed: number;
  dismissed: number;
  whitelistedAccounts: number;
  precision: number | null;
}

export interface FeedbackCalibrationRow {
  label: string;
  count: number;
  avgConfidence: number;
  avgAiLikelihood: number;
}

export interface FeedbackTalentRow {
  talentId: string;
  name: string;
  total: number;
  pending: number;
  confirmed: number;
  dismissed: number;
  dismissedNotMe: number;
  dismissedNotAi: number;
  dismissedNotMisuse: number;
  whitelistedAccounts: number;
  whitelistedFalsePositives: number;
  precision: number | null;
  avgConfidenceConfirmed: number | null;
  avgConfidenceDismissed: number | null;
  lastAdjudicatedAt: number | null;
}

export interface FeedbackSummary {
  totals: FeedbackTotals;
  calibration: FeedbackCalibrationRow[];
  talents: FeedbackTalentRow[];
}

export async function getDetectionFeedbackSummary(db: Db): Promise<FeedbackSummary> {
  const [statusRows, dismissalRows, whitelistRows, calibrationRows, talentRows, talentWhitelistRows] =
    await Promise.all([
      db
        .select({ status: likenessHits.status, count: sql<number>`COUNT(*)`.as("count") })
        .from(likenessHits)
        .groupBy(likenessHits.status)
        .all(),

      db
        .select({
          reason: sql<string>`COALESCE(${likenessHits.dismissalReason}, 'other')`.as("reason"),
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(likenessHits)
        .where(eq(likenessHits.status, "dismissed"))
        .groupBy(sql`COALESCE(${likenessHits.dismissalReason}, 'other')`)
        .all(),

      db
        .select({ reason: talentAccountWhitelist.reason, count: sql<number>`COUNT(*)`.as("count") })
        .from(talentAccountWhitelist)
        .groupBy(talentAccountWhitelist.reason)
        .all(),

      // One row per verdict label over every adjudicated hit. The label keeps
      // the dismissal reason so detector errors (not_me, not_ai) don't get
      // averaged together with policy dismissals (not_misuse).
      db
        .select({
          label: VERDICT_LABEL_SQL.as("label"),
          count: sql<number>`COUNT(*)`.as("count"),
          avgConfidence: sql<number>`ROUND(AVG(${likenessHits.confidence}), 1)`.as("avg_confidence"),
          avgAiLikelihood: sql<number>`ROUND(AVG(${likenessHits.aiGeneratedLikelihood}), 1)`.as(
            "avg_ai_likelihood"
          ),
        })
        .from(likenessHits)
        .where(ne(likenessHits.status, "new"))
        .groupBy(VERDICT_LABEL_SQL)
        .all(),

      // Per-talent outcome split. Conditional aggregation in one pass rather
      // than a query per talent — D1 round-trips are the cost centre here.
      db
        .select({
          talentId: likenessHits.talentId,
          email: users.email,
          fullName: talentProfiles.fullName,
          total: sql<number>`COUNT(*)`.as("total"),
          pending: sql<number>`SUM(CASE WHEN ${likenessHits.status} = 'new' THEN 1 ELSE 0 END)`.as("pending"),
          confirmed: sql<number>`SUM(CASE WHEN ${CONFIRMED_SQL} THEN 1 ELSE 0 END)`.as("confirmed"),
          dismissed: sql<number>`SUM(CASE WHEN ${likenessHits.status} = 'dismissed' THEN 1 ELSE 0 END)`.as(
            "dismissed"
          ),
          dismissedNotMe: sql<number>`SUM(CASE WHEN ${likenessHits.status} = 'dismissed' AND ${likenessHits.dismissalReason} = 'not_me' THEN 1 ELSE 0 END)`.as(
            "dismissed_not_me"
          ),
          dismissedNotAi: sql<number>`SUM(CASE WHEN ${likenessHits.status} = 'dismissed' AND ${likenessHits.dismissalReason} = 'not_ai' THEN 1 ELSE 0 END)`.as(
            "dismissed_not_ai"
          ),
          dismissedNotMisuse: sql<number>`SUM(CASE WHEN ${likenessHits.status} = 'dismissed' AND ${likenessHits.dismissalReason} = 'not_misuse' THEN 1 ELSE 0 END)`.as(
            "dismissed_not_misuse"
          ),
          avgConfidenceConfirmed: sql<number | null>`ROUND(AVG(CASE WHEN ${CONFIRMED_SQL} THEN ${likenessHits.confidence} END), 1)`.as(
            "avg_confidence_confirmed"
          ),
          avgConfidenceDismissed: sql<number | null>`ROUND(AVG(CASE WHEN ${likenessHits.status} = 'dismissed' THEN ${likenessHits.confidence} END), 1)`.as(
            "avg_confidence_dismissed"
          ),
          lastAdjudicatedAt: sql<number | null>`MAX(${likenessHits.statusUpdatedAt})`.as("last_adjudicated_at"),
        })
        .from(likenessHits)
        .innerJoin(users, eq(users.id, likenessHits.talentId))
        .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
        .groupBy(likenessHits.talentId)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(100)
        .all(),

      db
        .select({
          talentId: talentAccountWhitelist.talentId,
          whitelisted: sql<number>`COUNT(*)`.as("whitelisted"),
          falsePositives: sql<number>`SUM(CASE WHEN ${talentAccountWhitelist.reason} = 'false_positive' THEN 1 ELSE 0 END)`.as(
            "false_positives"
          ),
        })
        .from(talentAccountWhitelist)
        .groupBy(talentAccountWhitelist.talentId)
        .all(),
    ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const dismissalReasons: Record<string, number> = {};
  for (const r of dismissalRows) dismissalReasons[r.reason] = r.count;

  const whitelistReasons: Record<string, number> = {};
  for (const r of whitelistRows) whitelistReasons[r.reason] = r.count;

  const whitelistByTalent = new Map(talentWhitelistRows.map((r) => [r.talentId, r]));

  const confirmedTotal =
    (byStatus.confirmed ?? 0) + (byStatus.takedown_requested ?? 0) + (byStatus.resolved ?? 0);
  const dismissedTotal = byStatus.dismissed ?? 0;
  const adjudicated = confirmedTotal + dismissedTotal;

  const talents = talentRows.map((t) => {
    const wl = whitelistByTalent.get(t.talentId);
    const talentAdjudicated = t.confirmed + t.dismissed;
    return {
      talentId: t.talentId,
      name: t.fullName ?? t.email,
      total: t.total,
      pending: t.pending,
      confirmed: t.confirmed,
      dismissed: t.dismissed,
      dismissedNotMe: t.dismissedNotMe,
      dismissedNotAi: t.dismissedNotAi,
      dismissedNotMisuse: t.dismissedNotMisuse,
      whitelistedAccounts: wl?.whitelisted ?? 0,
      whitelistedFalsePositives: wl?.falsePositives ?? 0,
      precision: talentAdjudicated > 0 ? Math.round((t.confirmed / talentAdjudicated) * 100) : null,
      avgConfidenceConfirmed: t.avgConfidenceConfirmed,
      avgConfidenceDismissed: t.avgConfidenceDismissed,
      lastAdjudicatedAt: t.lastAdjudicatedAt,
    };
  });

  return {
    totals: {
      byStatus,
      dismissalReasons,
      whitelistReasons,
      adjudicated,
      confirmed: confirmedTotal,
      dismissed: dismissedTotal,
      whitelistedAccounts: whitelistRows.reduce((sum, r) => sum + r.count, 0),
      precision: adjudicated > 0 ? Math.round((confirmedTotal / adjudicated) * 100) : null,
    },
    calibration: calibrationRows,
    talents,
  };
}

export type FeedbackLabel = "confirmed" | "dismissed" | "whitelisted_account";

export interface FeedbackExample {
  hitId: string;
  talentId: string;
  platform: string;
  contentType: string;
  discoverySource: string | null;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: string;
  matchSignals: string[];
  detectedAt: number;
  label: FeedbackLabel;
  labelDetail: string | null;
  accountWhitelisted: boolean;
  adjudicatedAt: number | null;
}

export interface FeedbackExampleOptions {
  limit?: number;
  /**
   * Only rows whose verdict landed at/after this unix timestamp
   * (COALESCE(status_updated_at, detected_at)) — the incremental-pull cursor
   * for periodic consumers.
   */
  since?: number;
  label?: FeedbackLabel;
}

/**
 * The labelled dataset: one row per human-labelled hit, pairing the
 * detector's discovery-time signals with the eventual verdict. Adjudicated
 * hits carry their own verdict; never-adjudicated hits whose account the
 * talent whitelisted are labelled by extension. Hits at status=new with no
 * whitelist entry are unlabelled and excluded.
 *
 * Talent ids are included (a likeness model is per-identity by nature) but
 * emails/names are not — the output is expected to leave the admin console.
 */
export async function getDetectionFeedbackExamples(
  db: Db,
  options: FeedbackExampleOptions = {}
): Promise<FeedbackExample[]> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 5000), 1), 5000);

  const labelledCondition =
    options.label === "confirmed"
      ? CONFIRMED_SQL
      : options.label === "dismissed"
        ? eq(likenessHits.status, "dismissed")
        : options.label === "whitelisted_account"
          ? and(eq(likenessHits.status, "new"), sql`${talentAccountWhitelist.id} IS NOT NULL`)
          : or(ne(likenessHits.status, "new"), sql`${talentAccountWhitelist.id} IS NOT NULL`);

  const conditions = [labelledCondition];
  if (options.since !== undefined) {
    conditions.push(
      gte(sql`COALESCE(${likenessHits.statusUpdatedAt}, ${likenessHits.detectedAt})`, options.since)
    );
  }

  const rows = await db
    .select({
      hit: likenessHits,
      whitelistReason: talentAccountWhitelist.reason,
    })
    .from(likenessHits)
    .leftJoin(
      talentAccountWhitelist,
      and(
        eq(talentAccountWhitelist.talentId, likenessHits.talentId),
        eq(talentAccountWhitelist.accountId, likenessHits.accountId)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(likenessHits.detectedAt))
    .limit(limit)
    .all();

  return rows.map(({ hit, whitelistReason }) => {
    let matchSignals: string[] = [];
    try {
      const parsed = JSON.parse(hit.matchSignalsJson);
      if (Array.isArray(parsed)) matchSignals = parsed;
    } catch {
      // stored value predates the JSON column contract; export it empty
    }

    const label: FeedbackLabel =
      hit.status !== "new"
        ? hit.status === "dismissed"
          ? "dismissed"
          : "confirmed"
        : "whitelisted_account";

    return {
      hitId: hit.id,
      talentId: hit.talentId,
      platform: hit.platform,
      contentType: hit.contentType,
      discoverySource: hit.discoverySource,
      confidence: hit.confidence,
      aiGeneratedLikelihood: hit.aiGeneratedLikelihood,
      riskLevel: hit.riskLevel,
      matchSignals,
      detectedAt: hit.detectedAt,
      label,
      labelDetail:
        label === "dismissed"
          ? hit.dismissalReason ?? "other"
          : label === "whitelisted_account"
            ? whitelistReason
            : hit.status,
      accountWhitelisted: whitelistReason !== null,
      adjudicatedAt: hit.statusUpdatedAt,
    };
  });
}
