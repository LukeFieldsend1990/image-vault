import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { aiSettings, apifyUsage } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  APIFY_CEILING_KEY,
  APIFY_ENABLED_KEY,
  APIFY_SINCE_KEY,
  getApifyAccountUsage,
  getApifyBudget,
  getApifyCreditsExhaustedAt,
} from "@/lib/monitor/ingest/budget";
import { apifyToken } from "@/lib/monitor/ingest/apify";
import {
  ACTOR_DEFAULTS,
  ACTOR_ID_PATTERN,
  HASHTAG_ACTOR_KEY,
  PROFILE_ACTOR_KEY,
  RESULTS_PER_QUERY_KEY,
  SEARCH_ACTOR_KEY,
  TIKTOK_ACTOR_KEY,
  clampResultsPerQuery,
  resolveActorConfig,
} from "@/lib/monitor/ingest/actor-settings";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { desc, eq, sql } from "drizzle-orm";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

async function upsert(db: ReturnType<typeof getDb>, key: string, value: string, userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.select({ key: aiSettings.key }).from(aiSettings).where(eq(aiSettings.key, key)).get();
  if (existing) {
    await db.update(aiSettings).set({ value, updatedBy: userId, updatedAt: now }).where(eq(aiSettings.key, key));
  } else {
    await db.insert(aiSettings).values({ key, value, updatedBy: userId, updatedAt: now });
  }
}

// GET /api/admin/monitor/apify — spend against the ceiling, plus recent runs.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const budget = await getApifyBudget(db);

  // The account's real usage, straight from Apify — the internal ledger only
  // sees runs this app booked, and 2026-08-17 proved those can diverge far
  // enough for the panel to show headroom while Apify refuses runs.
  let token: string | null = null;
  try {
    token = apifyToken(getCloudflareContext().env as { APIFY_TOKEN?: string });
  } catch {
    token = apifyToken({ APIFY_TOKEN: process.env.APIFY_TOKEN });
  }
  const [account, creditsExhaustedAt] = await Promise.all([
    token
      ? getApifyAccountUsage(token)
      : Promise.resolve({ available: false as const, reason: "APIFY_TOKEN is not configured." }),
    getApifyCreditsExhaustedAt(db),
  ]);

  const [runs, byTalent] = await Promise.all([
    db.select().from(apifyUsage).orderBy(desc(apifyUsage.createdAt)).limit(50).all(),
    db
      .select({
        talentId: apifyUsage.talentId,
        cost: sql<number>`coalesce(sum(cost_usd), 0)`,
        runs: sql<number>`count(*)`,
      })
      .from(apifyUsage)
      .where(sql`created_at >= ${budget.since}`)
      .groupBy(apifyUsage.talentId)
      .orderBy(sql`sum(cost_usd) desc`)
      .limit(10)
      .all(),
  ]);

  const actors = await resolveActorConfig(db);

  return NextResponse.json({
    budget,
    runs,
    byTalent,
    account,
    creditsExhaustedAt,
    actors,
    actorDefaults: ACTOR_DEFAULTS,
  });
}

// PATCH /api/admin/monitor/apify — { ceilingUsd?, enabled?, hashtagActor?,
// searchActor?, profileActor?, tiktokActor?, resultsPerQuery? }
// Actor fields take an actor id ("owner~name") or an empty string to clear
// the override and restore the compiled default.
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session!;

  const body = (await req.json().catch(() => ({}))) as {
    ceilingUsd?: number;
    enabled?: boolean;
    hashtagActor?: string;
    searchActor?: string;
    profileActor?: string;
    tiktokActor?: string;
    resultsPerQuery?: number | string | null;
  };
  const db = getDb();

  if (body.ceilingUsd !== undefined) {
    const n = Number(body.ceilingUsd);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return NextResponse.json({ error: "Ceiling must be between $0 and $1000" }, { status: 400 });
    }
    await upsert(db, APIFY_CEILING_KEY, n.toFixed(2), session.sub);
  }

  if (body.enabled !== undefined) {
    await upsert(db, APIFY_ENABLED_KEY, body.enabled ? "true" : "false", session.sub);
  }

  const actorFields: Array<[string, string | undefined]> = [
    [HASHTAG_ACTOR_KEY, body.hashtagActor],
    [SEARCH_ACTOR_KEY, body.searchActor],
    [PROFILE_ACTOR_KEY, body.profileActor],
    [TIKTOK_ACTOR_KEY, body.tiktokActor],
  ];
  for (const [key, raw] of actorFields) {
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === "") {
      await db.delete(aiSettings).where(eq(aiSettings.key, key));
      continue;
    }
    if (!ACTOR_ID_PATTERN.test(value)) {
      return NextResponse.json(
        { error: `Actor id must look like "owner~name" (got "${value.slice(0, 60)}")` },
        { status: 400 }
      );
    }
    await upsert(db, key, value, session.sub);
  }

  if (body.resultsPerQuery !== undefined) {
    if (body.resultsPerQuery === null || body.resultsPerQuery === "") {
      await db.delete(aiSettings).where(eq(aiSettings.key, RESULTS_PER_QUERY_KEY));
    } else {
      const n = clampResultsPerQuery(body.resultsPerQuery);
      if (n === undefined) {
        return NextResponse.json({ error: "Results per query must be a number (10–200)" }, { status: 400 });
      }
      await upsert(db, RESULTS_PER_QUERY_KEY, String(n), session.sub);
    }
  }

  return NextResponse.json({
    budget: await getApifyBudget(db),
    actors: await resolveActorConfig(db),
  });
}

// POST /api/admin/monitor/apify — reset the spend counter to now.
// The ledger is kept; only the window moves, so history stays auditable.
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session!;

  const db = getDb();
  await upsert(db, APIFY_SINCE_KEY, String(Math.floor(Date.now() / 1000)), session.sub);
  return NextResponse.json({ budget: await getApifyBudget(db) });
}
