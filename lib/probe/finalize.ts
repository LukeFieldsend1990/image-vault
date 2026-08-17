/**
 * Finalise a probe run.
 *
 * The pipeline-worker does the expensive, resumable half (generate + score +
 * checkpoint) and, when the last sample is scored, sets the run to
 * `summarising`. Finalisation — the part that must be a single, tested source
 * of truth — happens here in the app: compute the verdict, assemble a canonical
 * manifest of exactly what was run and found, write it to R2, seal it to the
 * compliance ledger, and flip the run to `complete`.
 *
 * Splitting it this way keeps the ledger/seal/stats/report logic in one place
 * (the worker can't import app lib), and makes finalisation idempotent and
 * lazily triggerable: the status route calls it when it sees `summarising`, so
 * no extra cron is needed.
 */

import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { getDb } from "@/lib/db";
import { probeRuns, probeSamples } from "@/lib/db/schema";
import { canonicalJson, sha256Hex, talentChain } from "@/lib/compliance/ledger";
import { getOrMintSeal } from "@/lib/compliance/seal";
import { buildVerdict } from "./stats";
import { appendProbeEvent } from "./ledger";
import { getRunSpendUsd } from "./budget";
import type { ProbeProtocol, ProbeVerdict, ScoredSample } from "./types";

type Db = ReturnType<typeof getDb>;

const MANIFEST_SCHEMA = "image-vault.probe-run-manifest/1";

export interface FinalizeResult {
  status: "complete" | "skipped";
  verdict?: ProbeVerdict;
  sealRef?: string | null;
  reason?: string;
}

/**
 * Finalise a run in `summarising` state. Idempotent: a run already `complete`
 * (or not yet ready) is left alone. `now` is injected for testability.
 */
export async function finalizeProbeRun(db: Db, runId: string, now: number): Promise<FinalizeResult> {
  const run = await db.select().from(probeRuns).where(eq(probeRuns.id, runId)).get();
  if (!run) return { status: "skipped", reason: "run not found" };
  if (run.status !== "summarising") {
    return { status: "skipped", reason: `run is ${run.status}, not summarising` };
  }

  const protocol = JSON.parse(run.protocolJson) as ProbeProtocol;
  const samples = await db.select().from(probeSamples).where(eq(probeSamples.runId, runId)).all();

  const scored: ScoredSample[] = samples.map((s) => ({
    condition: s.condition,
    rekognitionSimilarity: s.rekognitionSimilarity,
    phashMinDistance: s.phashMinDistance,
  }));

  const verdict = buildVerdict({
    samples: scored,
    matchThreshold: protocol.matchThreshold,
    phashDerivationThreshold: protocol.phashDerivationThreshold,
  });

  // Canonical manifest: everything a third party needs to replay + audit.
  const manifest = {
    schema: MANIFEST_SCHEMA,
    runId,
    talentId: run.talentId,
    target: {
      kind: run.targetKind,
      ref: run.targetRef,
      fileSha256: run.targetFileSha256,
      meta: safeParse(run.targetMetaJson),
    },
    protocol,
    verdict,
    samples: samples.map((s) => ({
      id: s.id,
      condition: s.condition,
      conditionLabel: s.conditionLabel,
      prompt: s.prompt,
      seed: s.seed,
      r2Key: s.r2Key,
      imageSha256: s.imageSha256,
      rekognitionSimilarity: s.rekognitionSimilarity,
      phashHex: s.phashHex,
      phashMinDistance: s.phashMinDistance,
      status: s.status,
    })),
    generatedAt: now,
  };

  const manifestJson = canonicalJson(manifest);
  const manifestSha256 = await sha256Hex(manifestJson);
  const manifestKey = `probes/${runId}/manifest.json`;

  // Write the manifest to the pipeline bucket (best-effort — the sealed hash is
  // the authoritative record even if the object write is unavailable in dev).
  try {
    const { env } = getCloudflareContext();
    const bucket = (env as unknown as Record<string, R2Bucket | undefined>)["PIPELINE_BUCKET"];
    if (bucket) {
      await bucket.put(manifestKey, manifestJson, {
        httpMetadata: { contentType: "application/json" },
      });
    }
  } catch {
    // No R2 binding locally — carry on; the hash still seals the content.
  }

  // Ledger: run completed, with the manifest hash inside the hashed payload.
  await appendProbeEvent({
    db,
    talentId: run.talentId,
    runId,
    eventType: "probe.run_completed",
    at: now,
    actorId: run.createdBy,
    targetSha256: run.targetFileSha256,
    manifestSha256,
    detail: {
      encoding: verdict.encoding,
      targetMatchRate: verdict.targetMatchRate,
      controlMatchRate: verdict.controlMatchRate,
      fisherP: verdict.fisherP,
      scanMembershipSignal: verdict.scanMembershipSignal,
    },
  });

  // Seal the report to the talent's chain and record the seal event.
  let sealRef: string | null = null;
  try {
    const seal = await getOrMintSeal(db, {
      kind: "probe_report",
      subjectType: "probe_run",
      subjectId: runId,
      subjectLabel: probeSubjectLabel(run.talentId, runId),
      chainKeys: [talentChain(run.talentId)],
      issuedBy: run.createdBy,
    });
    sealRef = seal.ref;
    await appendProbeEvent({
      db,
      talentId: run.talentId,
      runId,
      eventType: "probe.report_sealed",
      at: now,
      actorId: run.createdBy,
      manifestSha256,
      detail: { sealRef: seal.ref, sealHash: seal.sealHash },
    });
  } catch {
    // Sealing failed (e.g. ledger unavailable) — the run still completes with
    // its verdict; the report renders as an unsealed draft until re-sealed.
  }

  const costActual = await getRunSpendUsd(db, runId);

  await db
    .update(probeRuns)
    .set({
      status: "complete",
      verdictJson: JSON.stringify(verdict),
      manifestR2Key: manifestKey,
      manifestSha256,
      sealRef,
      costActualUsd: costActual,
      completedAt: now,
    })
    .where(eq(probeRuns.id, runId));

  return { status: "complete", verdict, sealRef };
}

/** Public-safe subject label for the seal page: never a name — a short code. */
function probeSubjectLabel(talentId: string, runId: string): string {
  return `PR-${talentId.slice(0, 4).toUpperCase()}-${runId.slice(0, 4).toUpperCase()}`;
}

function safeParse(json: string | null): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
