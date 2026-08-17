/**
 * Probe batch executor (pipeline worker).
 *
 * A probe run is dozens of image generations plus a face compare per reference —
 * tens of minutes of wall clock, far too long for a request. It runs here as a
 * resumable job: each `probe_batch` message generates + scores at most
 * BATCH_SIZE pending samples, checkpoints them in the DB, and re-enqueues itself
 * if work remains. When the last sample is scored it flips the run to
 * `summarising` and stops — the app-side finalizer (lib/probe/finalize.ts) then
 * computes the verdict, writes the manifest, and seals the report. That split
 * keeps the ledger/seal/stats logic in one tested place; the worker only does
 * the expensive part.
 *
 * This module deliberately mirrors small pieces of lib/probe (generation,
 * Rekognition, dHash) the same way phash.ts mirrors lib/monitor/phash — the
 * worker can't import the app's `@/`-aliased modules.
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { AwsClient } from "aws4fetch";
import {
  monitorPhashIndex,
  monitorReferenceImages,
  probeRuns,
  probeSamples,
  probeUsage,
} from "./schema";
import { hashPng } from "./phash";

/** Samples generated + scored per queue message. Keeps each invocation well
 *  inside Workers limits and bounds the paid work lost to a mid-run failure. */
const BATCH_SIZE = 8;

interface ProbeEnv {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  PIPELINE_BUCKET: R2Bucket;
  REPLICATE_API_TOKEN?: string;
  REPLICATE_MODEL_VERSION?: string;
  REPLICATE_LORA_MODEL_VERSION?: string;
  REPLICATE_PER_IMAGE_USD?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  // Re-enqueue binding (set in wrangler.toml producers).
  PIPELINE_QUEUE?: Queue;
}

type Db = ReturnType<typeof drizzle>;

interface ProtocolShape {
  matchThreshold: number;
  phashDerivationThreshold: number;
}

// ── SHA-256 (hex) ────────────────────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Hamming distance over 16-hex (64-bit) dHashes ────────────────────────────

function hamming64(a: string, b: string): number {
  let dist = 0;
  const x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let v = x;
  while (v > 0n) {
    dist += Number(v & 1n);
    v >>= 1n;
  }
  return dist;
}

// ── Replicate generation ─────────────────────────────────────────────────────

interface GenResult {
  bytes: Uint8Array;
  contentType: string;
  predictionId: string | null;
}

async function generateImage(
  env: ProbeEnv,
  opts: { prompt: string; negativePrompt: string; seed: number; loraUrl: string | null; kind: string }
): Promise<GenResult> {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  const version =
    opts.kind === "civitai_lora"
      ? env.REPLICATE_LORA_MODEL_VERSION ?? env.REPLICATE_MODEL_VERSION
      : env.REPLICATE_MODEL_VERSION;
  if (!version) throw new Error("REPLICATE_MODEL_VERSION not set");

  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    negative_prompt: opts.negativePrompt,
    seed: opts.seed,
    num_outputs: 1,
    output_format: "png",
  };
  if (opts.kind === "civitai_lora" && opts.loraUrl) input.lora = opts.loraUrl;

  const created = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ version, input }),
  });
  if (!created.ok) throw new Error(`replicate create ${created.status}`);
  let pred = (await created.json()) as {
    id?: string;
    status?: string;
    output?: unknown;
    urls?: { get?: string };
  };

  const start = Date.now();
  while (pred.status && !["succeeded", "failed", "canceled"].includes(pred.status)) {
    if (Date.now() - start > 120_000) throw new Error("replicate timeout");
    await new Promise((r) => setTimeout(r, 1500));
    const getUrl = pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`;
    const poll = await fetch(getUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!poll.ok) throw new Error(`replicate poll ${poll.status}`);
    pred = (await poll.json()) as typeof pred;
  }
  if (pred.status !== "succeeded") throw new Error(`replicate ${pred.status}`);

  const outputUrl = Array.isArray(pred.output)
    ? (pred.output[0] as string)
    : typeof pred.output === "string"
      ? pred.output
      : null;
  if (!outputUrl) throw new Error("replicate no output");
  const img = await fetch(outputUrl);
  if (!img.ok) throw new Error(`fetch image ${img.status}`);
  return {
    bytes: new Uint8Array(await img.arrayBuffer()),
    contentType: img.headers.get("content-type") ?? "image/png",
    predictionId: pred.id ?? null,
  };
}

// ── Rekognition CompareFaces (mirror of lib/monitor/rekognition.ts) ──────────

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function compareFaces(
  env: ProbeEnv,
  sourceBytes: Uint8Array,
  targetBytes: Uint8Array
): Promise<{ similarity: number; matches: number; unmatched: number } | null> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;
  const region = env.AWS_REGION ?? "us-east-1";
  const client = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    service: "rekognition",
    region,
  });
  try {
    const res = await client.fetch(`https://rekognition.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "RekognitionService.CompareFaces",
      },
      body: JSON.stringify({
        SourceImage: { Bytes: toBase64(sourceBytes) },
        TargetImage: { Bytes: toBase64(targetBytes) },
        SimilarityThreshold: 60,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      FaceMatches?: Array<{ Similarity?: number }>;
      UnmatchedFaces?: Array<unknown>;
    };
    const matches = data.FaceMatches ?? [];
    const best = matches.reduce((m, x) => Math.max(m, x.Similarity ?? 0), 0);
    return { similarity: best / 100, matches: matches.length, unmatched: (data.UnmatchedFaces ?? []).length };
  } catch {
    return null;
  }
}

// ── Batch driver ─────────────────────────────────────────────────────────────

async function loadReferenceBytes(env: ProbeEnv, talentId: string): Promise<Uint8Array[]> {
  const db = drizzle(env.DB);
  const refs = await db
    .select({ r2Key: monitorReferenceImages.r2Key })
    .from(monitorReferenceImages)
    .where(
      and(
        eq(monitorReferenceImages.talentId, talentId),
        eq(monitorReferenceImages.status, "active"),
        eq(monitorReferenceImages.probeGrade, true)
      )
    )
    .all();
  const out: Uint8Array[] = [];
  for (const r of refs) {
    const obj = await env.SCANS_BUCKET.get(r.r2Key);
    if (!obj) continue;
    out.push(new Uint8Array(await obj.arrayBuffer()));
  }
  return out;
}

async function loadPhashHexes(env: ProbeEnv, talentId: string): Promise<string[]> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({ hashHex: monitorPhashIndex.hashHex, status: monitorPhashIndex.status })
    .from(monitorPhashIndex)
    .where(eq(monitorPhashIndex.talentId, talentId))
    .all();
  return rows.filter((r) => r.status === "hashed" && r.hashHex).map((r) => r.hashHex as string);
}

/**
 * Process one probe_batch message. Generates + scores up to BATCH_SIZE pending
 * samples, checkpoints, and either re-enqueues (work remains) or marks the run
 * `summarising` (done). Errors on a single sample mark that sample failed and
 * do not abort the batch.
 */
export async function processProbeBatch(env: ProbeEnv, runId: string): Promise<void> {
  const db: Db = drizzle(env.DB);
  const now = () => Math.floor(Date.now() / 1000);

  const run = await db.select().from(probeRuns).where(eq(probeRuns.id, runId)).get();
  if (!run) return;
  if (["complete", "failed", "summarising"].includes(run.status)) return;

  const protocol = JSON.parse(run.protocolJson) as ProtocolShape;
  const meta = JSON.parse(run.targetMetaJson || "{}") as { weightsUrl?: string | null };
  // The worker records raw pHash distances; the derivation threshold is applied
  // later by the app finalizer, so only the match threshold is needed here.
  const matchThreshold = protocol.matchThreshold ?? 0.85;

  await db.update(probeRuns).set({ status: "generating" }).where(eq(probeRuns.id, runId));

  const pending = await db
    .select()
    .from(probeSamples)
    .where(and(eq(probeSamples.runId, runId), eq(probeSamples.status, "pending")))
    .limit(BATCH_SIZE)
    .all();

  if (pending.length === 0) {
    await db.update(probeRuns).set({ status: "summarising" }).where(eq(probeRuns.id, runId));
    return;
  }

  const referenceBytes = await loadReferenceBytes(env, run.talentId);
  const phashHexes = await loadPhashHexes(env, run.talentId);

  let generated = 0;
  let comparisons = 0;

  for (const sample of pending) {
    try {
      const gen = await generateImage(env, {
        prompt: sample.prompt,
        negativePrompt: sample.negativePrompt ?? "",
        seed: sample.seed,
        loraUrl: meta.weightsUrl ?? null,
        kind: run.targetKind,
      });
      generated += 1;

      const r2Key = `probes/${runId}/samples/${sample.id.replace(/[^a-zA-Z0-9._:-]/g, "_")}.png`;
      await env.PIPELINE_BUCKET.put(r2Key, gen.bytes, {
        httpMetadata: { contentType: gen.contentType },
      });
      const imageSha = await sha256Hex(gen.bytes);

      // Derivation channel: dHash the generated image, min distance vs index.
      const hashed = hashPng(gen.bytes);
      let phashHex: string | null = null;
      let phashMin: number | null = null;
      if (hashed) {
        phashHex = hashed.hashHex;
        if (phashHexes.length) {
          phashMin = phashHexes.reduce((min, h) => Math.min(min, hamming64(phashHex!, h)), 64);
        }
      }

      // Identity channel: best similarity across references, early-exit on match.
      let best: number | null = null;
      let bestMatches: number | null = null;
      let bestUnmatched: number | null = null;
      for (const ref of referenceBytes) {
        const cmp = await compareFaces(env, ref, gen.bytes);
        comparisons += 1;
        if (!cmp) continue;
        if (best === null || cmp.similarity > best) {
          best = cmp.similarity;
          bestMatches = cmp.matches;
          bestUnmatched = cmp.unmatched;
        }
        if (cmp.similarity >= matchThreshold) break;
      }

      await db
        .update(probeSamples)
        .set({
          status: "scored",
          providerPredictionId: gen.predictionId,
          r2Key,
          imageSha256: imageSha,
          rekognitionSimilarity: best,
          rekognitionMatches: bestMatches,
          rekognitionUnmatched: bestUnmatched,
          phashHex,
          phashMinDistance: phashMin,
          scoredAt: now(),
        })
        .where(eq(probeSamples.id, sample.id));
    } catch (err) {
      await db
        .update(probeSamples)
        .set({ status: "failed", error: (err as Error).message.slice(0, 500) })
        .where(eq(probeSamples.id, sample.id));
    }
  }

  // Record spend for this batch (nominal per-image rate; Rekognition ~$0.001).
  const perImage = Number(env.REPLICATE_PER_IMAGE_USD ?? "0.02");
  const ts = now();
  if (generated > 0) {
    await db.insert(probeUsage).values({
      id: crypto.randomUUID(),
      runId,
      talentId: run.talentId,
      provider: "replicate",
      kind: "generation",
      units: generated,
      costUsd: Math.round(generated * perImage * 1000) / 1000,
      costEstimated: true,
      createdAt: ts,
    });
  }
  if (comparisons > 0) {
    await db.insert(probeUsage).values({
      id: crypto.randomUUID(),
      runId,
      talentId: run.talentId,
      provider: "rekognition",
      kind: "face_compare",
      units: comparisons,
      costUsd: Math.round(comparisons * 0.001 * 1000) / 1000,
      costEstimated: true,
      createdAt: ts,
    });
  }

  // Checkpoint counters.
  const scoredCount = await db
    .select({ id: probeSamples.id })
    .from(probeSamples)
    .where(and(eq(probeSamples.runId, runId), eq(probeSamples.status, "scored")))
    .all();
  const remaining = await db
    .select({ id: probeSamples.id })
    .from(probeSamples)
    .where(and(eq(probeSamples.runId, runId), eq(probeSamples.status, "pending")))
    .all();

  await db
    .update(probeRuns)
    .set({
      samplesGenerated: (run.samplesGenerated ?? 0) + generated,
      samplesScored: scoredCount.length,
      status: remaining.length > 0 ? "generating" : "summarising",
    })
    .where(eq(probeRuns.id, runId));

  // Re-enqueue the next batch, or leave the run for the app finalizer.
  if (remaining.length > 0 && env.PIPELINE_QUEUE) {
    await env.PIPELINE_QUEUE.send({ task: "probe_batch", runId });
  }
}
