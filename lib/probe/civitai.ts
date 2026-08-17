/**
 * Resolve a Civitai model into a probeable target.
 *
 * The likeness monitor already discovers Civitai models by name
 * (lib/monitor/ingest/ai-platforms.ts) and stores the hit's contentUrl as
 * `https://civitai.com/models/{id}`. To *probe* one we need three more things
 * the discovery pass doesn't fetch:
 *   • the latest model version's id (what actually gets run)
 *   • the primary weights file's download URL and its published SHA-256 — the
 *     hash is what lets the report say "this exact file was tested"
 *   • the version's trigger words, so the target prompts exercise the tokens
 *     the model was published with, not just the plain name
 *
 * The API is free and unauthenticated. This module only reads; it never
 * downloads the weights itself (the generation provider does that by URL).
 */

import type { ProbeTarget } from "./types";

const CIVITAI_BASE = "https://civitai.com/api/v1";

interface CivitaiFile {
  primary?: boolean;
  downloadUrl?: string;
  hashes?: { SHA256?: string };
}

interface CivitaiVersion {
  id?: number;
  name?: string;
  baseModel?: string;
  publishedAt?: string;
  trainedWords?: string[];
  files?: CivitaiFile[];
}

interface CivitaiModelResponse {
  id?: number;
  name?: string;
  type?: string;
  stats?: { downloadCount?: number };
  modelVersions?: CivitaiVersion[];
}

/** Pull the numeric model id out of a civitai.com/models/{id} URL. */
export function parseCivitaiModelId(contentUrl: string): number | null {
  const m = contentUrl.match(/civitai\.com\/models\/(\d+)/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

/** Choose the file a probe should run: the primary if flagged, else the first. */
function pickPrimaryFile(files: CivitaiFile[] | undefined): CivitaiFile | null {
  if (!files?.length) return null;
  return files.find((f) => f.primary) ?? files[0];
}

export interface ResolveCivitaiResult {
  target: ProbeTarget;
  /** Non-fatal notes for the operator (e.g. "no SHA-256 published"). */
  warnings: string[];
}

/**
 * Resolve a Civitai model id (or a models/{id} URL) into a ProbeTarget.
 * Returns null when the model can't be fetched or has no runnable version.
 * Never throws on a bad network response — returns null and lets the caller
 * decide, matching the monitor's "supplementary surface degrades quietly"
 * contract.
 */
export async function resolveCivitaiTarget(
  modelIdOrUrl: number | string,
  opts: { signal?: AbortSignal } = {}
): Promise<ResolveCivitaiResult | null> {
  const modelId =
    typeof modelIdOrUrl === "number" ? modelIdOrUrl : parseCivitaiModelId(String(modelIdOrUrl));
  if (!modelId) return null;

  let body: CivitaiModelResponse;
  try {
    const res = await fetch(`${CIVITAI_BASE}/models/${modelId}`, { signal: opts.signal });
    if (!res.ok) return null;
    body = (await res.json()) as CivitaiModelResponse;
  } catch {
    return null;
  }

  const version = body.modelVersions?.[0];
  if (!version?.id) return null;
  const file = pickPrimaryFile(version.files);

  const warnings: string[] = [];
  if (!file?.downloadUrl) warnings.push("No downloadable weights file — cannot run this model.");
  if (!file?.hashes?.SHA256) {
    warnings.push("Civitai published no SHA-256 for this file; the report cannot pin the exact bytes tested.");
  }

  const target: ProbeTarget = {
    kind: "civitai_lora",
    ref: `${modelId}@${version.id}`,
    fileSha256: file?.hashes?.SHA256 ?? null,
    weightsUrl: file?.downloadUrl ?? null,
    displayName: body.name?.trim() || `Civitai model ${modelId}`,
    meta: {
      trainedWords: (version.trainedWords ?? []).map((w) => w.trim()).filter(Boolean),
      baseModel: version.baseModel ?? null,
      publishedAt: version.publishedAt ?? null,
      downloadCount: body.stats?.downloadCount ?? null,
    },
  };

  return { target, warnings };
}
