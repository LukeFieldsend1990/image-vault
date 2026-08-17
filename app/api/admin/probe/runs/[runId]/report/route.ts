/**
 * The sealed Likeness Encoding Report, rendered as standalone HTML.
 *
 * Serves the human-readable report for a completed run — the same document a
 * licensing manager or counsel would read. The tamper seal on the page links to
 * the public /verify/{ref} endpoint, so the report can be handed to a third
 * party who has no account and they can still check the ledger hash.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { probeRuns, probeSamples, documentSeals } from "@/lib/db/schema";
import { docRef } from "@/lib/documents/palette";
import { renderLikenessEncodingReport } from "@/lib/probe/report";
import { countProbeReferences } from "@/lib/probe/references";
import type { ProbeProtocol, ProbeTarget, ProbeVerdict } from "@/lib/probe/types";

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

  const run = await db.select().from(probeRuns).where(eq(probeRuns.id, runId)).get();
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (!run.verdictJson) {
    return NextResponse.json({ error: "Run has not completed; no report yet." }, { status: 409 });
  }

  const protocol = JSON.parse(run.protocolJson) as ProbeProtocol;
  const verdict = JSON.parse(run.verdictJson) as ProbeVerdict;
  const meta = safeParse(run.targetMetaJson) as ProbeTarget["meta"] & { displayName?: string };

  const samples = await db
    .select({ status: probeSamples.status })
    .from(probeSamples)
    .where(eq(probeSamples.runId, runId))
    .all();
  const scored = samples.filter((s) => s.status === "scored").length;
  const generated = samples.filter((s) => s.status === "scored" || s.status === "generated").length;

  let sealBlock: { ref: string; sealHash: string; verifyPath: string } | null = null;
  let ledgerCompletedAtIso: string | null = null;
  if (run.sealRef) {
    const seal = await db.select().from(documentSeals).where(eq(documentSeals.ref, run.sealRef)).get();
    if (seal) {
      sealBlock = { ref: seal.ref, sealHash: seal.sealHash, verifyPath: `/verify/${seal.ref}` };
      ledgerCompletedAtIso = run.completedAt ? new Date(run.completedAt * 1000).toISOString() : null;
    }
  }

  const target: ProbeTarget = {
    kind: run.targetKind as ProbeTarget["kind"],
    ref: run.targetRef,
    fileSha256: run.targetFileSha256,
    displayName: meta?.displayName ?? null,
    meta,
  };

  const html = renderLikenessEncodingReport({
    runId,
    docRef: docRef("PROBE", run.createdAt, runId),
    target,
    protocol,
    verdict,
    generatedAt: run.completedAt ?? run.createdAt,
    ledgerCompletedAtIso,
    manifestSha256: run.manifestSha256,
    sampleCounts: { generated, scored },
    referenceCount: await countProbeReferences(db, run.talentId),
    seal: sealBlock,
    subjectLabel: `PR-${run.talentId.slice(0, 4).toUpperCase()}-${runId.slice(0, 4).toUpperCase()}`,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
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
