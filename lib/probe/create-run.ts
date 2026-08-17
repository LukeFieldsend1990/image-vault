/**
 * Create a probe run — the app-side entry point the admin route calls.
 *
 * This resolves the target, freezes the pre-registered protocol, checks the
 * spend against the probe budget, writes the run + one pending sample row per
 * planned generation, records a `probe.run_started` ledger event, and enqueues
 * the first `probe_batch` message. It does NOT generate anything itself — the
 * pipeline-worker does the expensive, resumable work; this only sets it up.
 *
 * Everything the run needs to be reproducible (prompts, seeds, controls,
 * thresholds, the target's file hash) is captured here at creation time.
 */

import type { getDb } from "@/lib/db";
import { probeRuns, probeSamples } from "@/lib/db/schema";
import { buildProtocol, estimateProbeCostUsd } from "./protocol";
import { countProbeReferences } from "./references";
import { resolveCivitaiTarget } from "./civitai";
import { checkProbeBudget, type BudgetCheck } from "./budget";
import { appendProbeEvent } from "./ledger";
import type { ProbeTarget } from "./types";

type Db = ReturnType<typeof getDb>;

export interface CreateProbeRunInput {
  db: Db;
  talentId: string;
  subjectName: string;
  /** Explicit Civitai target: a models/{id} URL or numeric id. */
  civitaiModelIdOrUrl?: number | string;
  /** Or a fully-specified hosted-model target. */
  hostedTarget?: ProbeTarget;
  /** The monitor hit this run started from, if any. */
  hitId?: string | null;
  actorId?: string | null;
  /** Admin must explicitly confirm the spend; without it the run is refused. */
  confirmSpend: boolean;
  now: number;
  /** For enqueue; injected so this stays testable. */
  enqueueBatch?: (runId: string) => Promise<void>;
}

export type CreateProbeRunResult =
  | { ok: true; runId: string; estimateUsd: number; budget: BudgetCheck; warnings: string[] }
  | { ok: false; error: string; budget?: BudgetCheck; warnings?: string[] };

export async function createProbeRun(input: CreateProbeRunInput): Promise<CreateProbeRunResult> {
  const warnings: string[] = [];

  // 1. Resolve the target.
  let target: ProbeTarget | null = null;
  if (input.hostedTarget) {
    target = input.hostedTarget;
  } else if (input.civitaiModelIdOrUrl != null) {
    const resolved = await resolveCivitaiTarget(input.civitaiModelIdOrUrl);
    if (!resolved) return { ok: false, error: "Could not resolve the Civitai model." };
    target = resolved.target;
    warnings.push(...resolved.warnings);
    if (!target.weightsUrl) {
      return { ok: false, error: "The Civitai model has no downloadable weights file to probe.", warnings };
    }
  }
  if (!target) return { ok: false, error: "No probe target specified." };

  // 2. Freeze the protocol.
  const protocol = buildProtocol({
    subjectPhrase: input.subjectName,
    trainedWords: target.meta?.trainedWords ?? [],
  });

  // 3. Count probe-grade references so the estimate is realistic.
  const refCount = await countProbeReferences(input.db, input.talentId);
  if (refCount === 0) {
    warnings.push(
      "No probe-grade references for this talent — identity scoring will be skipped until references are vetted. The run will still measure derivation (pHash)."
    );
  }
  const estimateUsd = estimateProbeCostUsd(protocol, { referenceCount: Math.max(1, refCount) });

  // 4. Budget gate.
  const budget = await checkProbeBudget(input.db, estimateUsd, input.now);
  if (!input.confirmSpend) {
    return { ok: false, error: "Spend not confirmed.", budget, warnings };
  }
  if (!budget.ok) {
    return { ok: false, error: budget.reason ?? "Over budget.", budget, warnings };
  }

  // 5. Persist the run + one pending sample per planned generation.
  const runId = crypto.randomUUID();
  await input.db.insert(probeRuns).values({
    id: runId,
    talentId: input.talentId,
    hitId: input.hitId ?? null,
    targetKind: target.kind,
    targetRef: target.ref,
    targetFileSha256: target.fileSha256 ?? null,
    targetMetaJson: JSON.stringify({ ...target.meta, displayName: target.displayName, weightsUrl: target.weightsUrl }),
    protocolJson: JSON.stringify(protocol),
    status: "queued",
    samplesTotal: protocol.counts.total,
    costEstimateUsd: estimateUsd,
    createdBy: input.actorId ?? null,
    createdAt: input.now,
  });

  const sampleRows = protocol.samples.map((s) => ({
    id: `${runId}:${s.id}`,
    runId,
    condition: s.condition,
    conditionLabel: s.conditionLabel,
    prompt: s.prompt,
    negativePrompt: s.negativePrompt,
    seed: s.seed,
    status: "pending" as const,
    createdAt: input.now,
  }));
  // D1 caps bound parameters (~100); chunk the inserts well under that.
  for (let i = 0; i < sampleRows.length; i += 20) {
    await input.db.insert(probeSamples).values(sampleRows.slice(i, i + 20));
  }

  // 6. Ledger: run started, with a hash-covered timestamp + target hash.
  try {
    await appendProbeEvent({
      db: input.db,
      talentId: input.talentId,
      runId,
      eventType: "probe.run_started",
      at: input.now,
      actorId: input.actorId ?? null,
      targetSha256: target.fileSha256 ?? null,
      detail: { targetRef: target.ref, targetKind: target.kind, sampleCount: protocol.counts.total },
    });
  } catch {
    // The ledger emitter is fire-and-forget elsewhere too; a failed append is
    // recorded by appendEvent's own failure path, not fatal to the run.
  }

  // 7. Kick off the first batch.
  if (input.enqueueBatch) {
    try {
      await input.enqueueBatch(runId);
    } catch {
      warnings.push("Queue unavailable — the run is created but will not start until a batch is enqueued.");
    }
  }

  return { ok: true, runId, estimateUsd, budget, warnings };
}
