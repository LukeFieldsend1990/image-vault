import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessHits, talentAccountWhitelist } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";

/**
 * GET /api/admin/monitor/feedback/export?format=json|jsonl
 *
 * The labelled dataset behind the feedback panel: one row per human-labelled
 * hit, pairing the detector's inputs at discovery time (confidence, AI
 * likelihood, match signals, discovery source) with the verdict a human
 * eventually gave. This is the file you hand to whoever is tuning thresholds
 * or evaluating a replacement classifier — download it, replay the model
 * against it, compare labels.
 *
 * Labels:
 * - `confirmed`       — talent/rep confirmed abuse (includes hits pushed on
 *                       to takedown_requested / resolved).
 * - `dismissed`       — with `labelDetail` carrying the structured reason.
 *                       not_me = likeness matcher wrong; not_ai = synthetic
 *                       check wrong; not_misuse = detectors right, policy no.
 * - `whitelisted_account` — the hit itself was never adjudicated, but the
 *                       talent whitelisted its source account. labelDetail is
 *                       the whitelist reason; false_positive is a detector
 *                       error, fan_fluff / talent_approved are policy calls.
 *
 * Hits still sitting at status=new with no whitelist entry are unlabelled and
 * excluded — this export is verdicts only.
 *
 * Talent ids are included (a likeness model is per-identity by nature) but
 * emails/names are not: the file is meant to leave the admin console, so it
 * carries opaque ids rather than PII.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const format = req.nextUrl.searchParams.get("format") === "jsonl" ? "jsonl" : "json";
  const db = getDb();

  // Adjudicated hits, plus never-adjudicated hits whose account the talent
  // whitelisted — the whitelist is a verdict on the account that labels its
  // hits by extension.
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
    .where(
      or(
        ne(likenessHits.status, "new"),
        sql`${talentAccountWhitelist.id} IS NOT NULL`
      )
    )
    .orderBy(desc(likenessHits.detectedAt))
    .limit(5000)
    .all();

  const examples = rows.map(({ hit, whitelistReason }) => {
    let matchSignals: string[] = [];
    try {
      const parsed = JSON.parse(hit.matchSignalsJson);
      if (Array.isArray(parsed)) matchSignals = parsed;
    } catch {
      // stored value predates the JSON column contract; export it empty
    }

    const label =
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

  const generatedAt = Math.floor(Date.now() / 1000);
  const filename = `detection-feedback-${generatedAt}.${format}`;

  if (format === "jsonl") {
    return new NextResponse(examples.map((e) => JSON.stringify(e)).join("\n") + "\n", {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return new NextResponse(JSON.stringify({ generatedAt, count: examples.length, examples }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
