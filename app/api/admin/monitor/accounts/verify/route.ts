import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { apifyToken } from "@/lib/monitor/ingest/apify";
import { checkApifyBudget, logApifyUsage } from "@/lib/monitor/ingest/budget";
import {
  PROFILE_ACTOR,
  enrichWatchlist,
  fetchProfiles,
  pruneMissing,
  watchlistHandles,
} from "@/lib/monitor/ingest/profiles";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * POST /api/admin/monitor/accounts/verify
 * Body: { platform?: string, prune?: boolean }
 *
 * Checks every watchlist handle against the platform in one batched run:
 * fills in follower counts and display names, and reports handles that do not
 * exist. Dead handles are swept every cycle for nothing and quietly imply
 * coverage we do not have, so finding them is worth a run.
 *
 * Pruning is opt-in and never touches an account with recorded hits.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { platform?: string; prune?: boolean };
  const platform = body.platform ?? "instagram";
  if (platform !== "instagram") {
    return NextResponse.json({ error: "Verification is Instagram-only for now" }, { status: 400 });
  }

  let env: { APIFY_TOKEN?: string } = {};
  try {
    env = getCloudflareContext().env as unknown as { APIFY_TOKEN?: string };
  } catch {
    env = { APIFY_TOKEN: process.env.APIFY_TOKEN };
  }
  const token = apifyToken(env);
  if (!token) return NextResponse.json({ error: "No APIFY_TOKEN configured" }, { status: 400 });

  const db = getDb();
  const budget = await checkApifyBudget(db);
  if (!budget.ok) return NextResponse.json({ error: budget.reason }, { status: 402 });

  const handles = await watchlistHandles(db, platform);
  if (!handles.length) {
    return NextResponse.json({ checked: 0, enriched: 0, missing: [], pruned: 0 });
  }

  const lookup = await fetchProfiles({ token, handles });

  await logApifyUsage(db, {
    runId: lookup.runId,
    actorId: PROFILE_ACTOR,
    mode: "profile_verify",
    query: `${handles.length} handles`,
    itemCount: lookup.profiles.length,
    costUsd: lookup.costUsd,
    status: lookup.error ? "failed" : "succeeded",
    error: lookup.error,
  });

  if (lookup.error) return NextResponse.json({ error: lookup.error }, { status: 502 });

  const summary = await enrichWatchlist(db, platform, lookup.profiles);
  const pruned = body.prune ? await pruneMissing(db, platform, summary.missing) : 0;

  return NextResponse.json({ ...summary, pruned });
}
