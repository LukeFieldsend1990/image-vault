/**
 * Probe run status + detail.
 *
 * GET returns the run, its samples, and its verdict. It is also the lazy
 * finalisation trigger: when it observes a run the worker has left in
 * `summarising`, it runs the app-side finalizer (compute verdict, write the
 * manifest, seal the report) before responding. finalizeProbeRun is idempotent,
 * so polling this endpoint repeatedly is safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { probeRuns, probeSamples } from "@/lib/db/schema";
import { finalizeProbeRun } from "@/lib/probe/finalize";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const g = await guard(req);
  if (g.error) return g.error;
  const { runId } = await params;
  const db = getDb();

  let run = await db.select().from(probeRuns).where(eq(probeRuns.id, runId)).get();
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  // Lazy finalisation: if the worker has scored everything and handed off, close
  // the run out now so the caller sees the verdict on this same poll.
  if (run.status === "summarising") {
    try {
      await finalizeProbeRun(db, runId, Math.floor(Date.now() / 1000));
      run = (await db.select().from(probeRuns).where(eq(probeRuns.id, runId)).get()) ?? run;
    } catch {
      // Leave the run in summarising; a later poll retries finalisation.
    }
  }

  const samples = await db
    .select({
      id: probeSamples.id,
      condition: probeSamples.condition,
      conditionLabel: probeSamples.conditionLabel,
      seed: probeSamples.seed,
      status: probeSamples.status,
      rekognitionSimilarity: probeSamples.rekognitionSimilarity,
      phashMinDistance: probeSamples.phashMinDistance,
    })
    .from(probeSamples)
    .where(eq(probeSamples.runId, runId))
    .orderBy(asc(probeSamples.condition))
    .all();

  return NextResponse.json({
    run: {
      ...run,
      protocolJson: undefined, // large; the report route serves the full detail
      verdict: run.verdictJson ? JSON.parse(run.verdictJson) : null,
      targetMeta: safeParse(run.targetMetaJson),
    },
    samples,
  });
}

function safeParse(json: string | null): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
