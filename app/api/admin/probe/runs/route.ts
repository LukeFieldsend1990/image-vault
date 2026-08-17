/**
 * Admin probe runs — create and list.
 *
 * POST creates a Model Probe Protocol run against a Civitai model (from a hit
 * or an explicit id/url) or a hosted model, after an explicit spend
 * confirmation and a probe-budget check, then enqueues the first batch to the
 * pipeline worker. GET lists recent runs.
 *
 * Admin-only, and mutating in the "spends money" sense — so it requires the
 * admin whitelist AND an explicit `confirmSpend: true` in the body. A GET with
 * `?estimate=...` returns the cost + budget without creating anything, so the
 * UI can show the price before the admin confirms.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { likenessHits, probeRuns, talentProfiles, users } from "@/lib/db/schema";
import { createProbeRun } from "@/lib/probe/create-run";
import type { ProbeTarget } from "@/lib/probe/types";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

async function enqueueBatch(runId: string): Promise<void> {
  const { env } = getCloudflareContext();
  const queue = (env as unknown as Record<string, Queue | undefined>)["PIPELINE_QUEUE"];
  if (!queue) throw new Error("queue unavailable");
  await queue.send({ task: "probe_batch", runId });
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  const talentId = req.nextUrl.searchParams.get("talentId");
  const base = db
    .select({
      run: probeRuns,
      talentName: talentProfiles.fullName,
    })
    .from(probeRuns)
    .leftJoin(talentProfiles, eq(talentProfiles.userId, probeRuns.talentId))
    .orderBy(desc(probeRuns.createdAt))
    .limit(100);

  const rows = talentId ? await base.where(eq(probeRuns.talentId, talentId)) : await base;
  return NextResponse.json({ runs: rows });
}

interface CreateBody {
  talentId?: string;
  hitId?: string;
  civitaiModelIdOrUrl?: string | number;
  hostedTarget?: ProbeTarget;
  confirmSpend?: boolean;
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Resolve the talent — from the body, or inferred from the hit.
  let talentId = body.talentId ?? null;
  const hitId = body.hitId ?? null;
  let civitaiTarget = body.civitaiModelIdOrUrl;

  if (hitId && (!talentId || civitaiTarget == null)) {
    const hit = await db
      .select({ talentId: likenessHits.talentId, contentUrl: likenessHits.contentUrl, platform: likenessHits.platform })
      .from(likenessHits)
      .where(eq(likenessHits.id, hitId))
      .get();
    if (!hit) return NextResponse.json({ error: "Hit not found." }, { status: 404 });
    talentId = talentId ?? hit.talentId;
    // Civitai hits are stored as platform 'midjourney' with a models/{id} url.
    if (civitaiTarget == null && hit.contentUrl.includes("civitai.com/models/")) {
      civitaiTarget = hit.contentUrl;
    }
  }

  if (!talentId) return NextResponse.json({ error: "talentId is required." }, { status: 400 });
  if (civitaiTarget == null && !body.hostedTarget) {
    return NextResponse.json(
      { error: "Provide a Civitai model (civitaiModelIdOrUrl or a Civitai hit) or a hostedTarget." },
      { status: 400 }
    );
  }

  const profile = await db
    .select({ fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, talentId))
    .get();
  const subjectName = profile?.fullName;
  if (!subjectName) {
    return NextResponse.json({ error: "Talent has no profile name to probe against." }, { status: 400 });
  }

  const actor = await db.select({ id: users.id }).from(users).where(eq(users.email, g.session.email)).get();

  const result = await createProbeRun({
    db,
    talentId,
    subjectName,
    civitaiModelIdOrUrl: civitaiTarget,
    hostedTarget: body.hostedTarget,
    hitId,
    actorId: actor?.id ?? null,
    confirmSpend: body.confirmSpend === true,
    now: Math.floor(Date.now() / 1000),
    enqueueBatch,
  });

  if (!result.ok) {
    // A spend-not-confirmed refusal still returns the estimate + budget so the
    // UI can render the confirmation prompt with a real number.
    return NextResponse.json(result, { status: result.budget && !body.confirmSpend ? 200 : 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
