import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { apifyToken } from "@/lib/monitor/ingest/apify";
import { checkApifyBudget, logApifyUsage } from "@/lib/monitor/ingest/budget";
import {
  CURATION_HANDLE_KEY,
  DEFAULT_FOLLOWS_ACTOR,
  FOLLOWS_ACTOR_KEY,
  fetchFollowing,
  normaliseHandle,
  readSetting,
  writeSetting,
} from "@/lib/monitor/ingest/follows";
import { getCloudflareContext } from "@opennextjs/cloudflare";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

/**
 * GET /api/admin/monitor/accounts/import-follows
 *
 * The remembered curation handle — the one whose follows were last imported
 * successfully — so the admin screen can prefill it and a refresh is one click.
 */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  return NextResponse.json({ handle: await readSetting(db, CURATION_HANDLE_KEY) });
}

/**
 * POST /api/admin/monitor/accounts/import-follows
 * Body: { handle: string, limit?: number }
 *
 * Reads who a curation account follows and returns them for review. Deliberately
 * a *preview* — it writes nothing to the watchlist. The admin picks which to
 * add, because an import that silently wrote whatever a scraper returned would
 * put the watchlist one bad actor response away from junk. The handle itself
 * is remembered after a successful fetch (typos are not), so the next visit
 * starts prefilled.
 */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session;

  const body = (await req.json().catch(() => ({}))) as { handle?: string; limit?: number };
  if (!body.handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  let env: { APIFY_TOKEN?: string } = {};
  try {
    env = getCloudflareContext().env as unknown as { APIFY_TOKEN?: string };
  } catch {
    env = { APIFY_TOKEN: process.env.APIFY_TOKEN };
  }

  const token = apifyToken(env);
  if (!token) {
    return NextResponse.json(
      { error: "No APIFY_TOKEN configured — paste handles instead." },
      { status: 400 }
    );
  }

  const db = getDb();

  // Same ceiling as every other Apify call; an import is a billed run.
  const budget = await checkApifyBudget(db);
  if (!budget.ok) {
    return NextResponse.json({ error: budget.reason }, { status: 402 });
  }

  const actorId = (await readSetting(db, FOLLOWS_ACTOR_KEY)) ?? DEFAULT_FOLLOWS_ACTOR;
  const limit = Math.min(500, Math.max(1, body.limit ?? 200));

  const result = await fetchFollowing({ token, handle: body.handle, limit, actorId });

  await logApifyUsage(db, {
    runId: null,
    actorId,
    mode: "follows_import",
    query: body.handle,
    itemCount: result.accounts.length,
    costUsd: null, // estimated from item count
    status: result.error ? "failed" : "succeeded",
    error: result.error,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error, actorId }, { status: 502 });
  }

  // Remember the handle only once it has demonstrably worked.
  const saved = normaliseHandle(body.handle);
  if (saved) await writeSetting(db, CURATION_HANDLE_KEY, saved, session.sub);

  return NextResponse.json({ accounts: result.accounts, actorId, handle: saved });
}
