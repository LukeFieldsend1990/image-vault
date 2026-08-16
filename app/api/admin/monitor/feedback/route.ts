import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessHits, talentAccountWhitelist, talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { desc, eq, ne, sql } from "drizzle-orm";

/**
 * GET /api/admin/monitor/feedback
 *
 * The adjudication ledger read back as a tuning signal. Every hit the scan
 * model surfaces eventually gets a human verdict — confirmed (or pushed on to
 * takedown/resolved), dismissed with a structured reason, or silenced at the
 * account level via the whitelist. This route aggregates those verdicts three
 * ways:
 *
 * - totals: the outcome funnel, plus reason breakdowns for dismissals and
 *   whitelist entries — "what are we getting wrong, and in which direction".
 * - calibration: mean detector scores (likeness confidence, AI likelihood)
 *   per verdict. A high average confidence on `dismissed:not_me` means the
 *   likeness matcher is over-confident; a high AI likelihood on
 *   `dismissed:not_ai` means the synthetic check is. `not_misuse` dismissals
 *   are policy calls, not detector errors, which is why the label keeps the
 *   reason attached instead of pooling all dismissals.
 * - talents: the same split per talent, because detector error is not evenly
 *   distributed — a talent with a weak reference set (or a very common face)
 *   drags precision down for reasons global numbers hide.
 *
 * The machine-readable version of the same signal is the labelled export at
 * /api/admin/monitor/feedback/export.
 */

// Statuses that count as "the human said yes, this is abuse". takedown and
// resolved imply confirmation — nobody files a takedown on a hit they think
// is a false positive.
const CONFIRMED_SQL = sql`${likenessHits.status} IN ('confirmed','takedown_requested','resolved')`;

const VERDICT_LABEL_SQL = sql<string>`CASE
  WHEN ${CONFIRMED_SQL} THEN 'confirmed'
  ELSE 'dismissed:' || COALESCE(${likenessHits.dismissalReason}, 'other')
END`;

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

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

  return NextResponse.json({
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
  });
}
