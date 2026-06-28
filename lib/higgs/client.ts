// Higgsfield AI client — image-to-video pitch vignette generation.
//
// Contract confirmed against the official SDK (github.com/higgsfield-ai/higgsfield-js):
//   Base URL : https://platform.higgsfield.ai
//   Auth     : Authorization: Key <KEY_ID>:<KEY_SECRET>
//   Submit   : POST /v1/image2video/dop  body { input: { model, prompt, input_images } }
//   Poll     : GET  /v1/requests/{request_id}/status
//   Output   : response.video.url ; status ∈ queued|in_progress|completed|failed|nsfw
//
// HIGGSFIELD_API_KEY must hold the full "KEY_ID:KEY_SECRET" pair.
// Unconfirmed (docs are gated): the image-upload endpoint (we pass hosted URLs)
// and the exact webhook signature scheme — see the worker and webhook route.

const HIGGS_BASE = "https://platform.higgsfield.ai";

// dop-lite | dop-turbo | dop-preview
const DEFAULT_MODEL = "dop-turbo";

export interface HiggsJobResult {
  jobId: string;
  status: "pending" | "processing" | "complete" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface SubmitVignetteParams {
  imageUrls: string[];   // publicly fetchable image URLs (Higgsfield pulls these)
  prompt: string;
  model?: string;
  // Retained for forward-compat / caller ergonomics. The dop image2video
  // endpoint does not document duration or audio toggles, so they are NOT sent
  // in the request body (sending unknown fields risks a 400).
  durationSeconds?: number;
  includeAudio?: boolean;
}

// Distinguishes transient failures (network blips, 5xx, rate limits) worth
// retrying from terminal ones (bad key, bad request) that never will. The
// worker uses `retryable` to decide between msg.retry() and a graceful
// "failed" state.
export class HiggsfieldError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = "HiggsfieldError";
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

// 5xx and 429 are transient; everything else (esp. 401/403/400) is terminal.
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function authHeader(apiKey: string): string {
  return `Key ${apiKey}`;
}

async function higgsFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Network-level failure (DNS, TLS, timeout) — worth a retry.
    throw new HiggsfieldError(
      `Higgsfield request failed: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: true }
    );
  }
}

export async function submitVignetteJob(
  apiKey: string,
  params: SubmitVignetteParams
): Promise<{ jobId: string }> {
  const res = await higgsFetch(`${HIGGS_BASE}/v1/image2video/dop`, {
    method: "POST",
    headers: {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        model: params.model ?? DEFAULT_MODEL,
        prompt: params.prompt,
        input_images: params.imageUrls.map((url) => ({ type: "image_url", image_url: url })),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HiggsfieldError(`Higgsfield submit failed ${res.status}: ${body}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status,
    });
  }

  const data = await res.json() as { request_id?: string; requestId?: string; id?: string };
  const jobId = data.request_id ?? data.requestId ?? data.id;
  if (!jobId) throw new HiggsfieldError("Higgsfield response missing request_id", { retryable: false });
  return { jobId };
}

export async function pollVignetteJob(
  apiKey: string,
  jobId: string
): Promise<HiggsJobResult> {
  const res = await higgsFetch(`${HIGGS_BASE}/v1/requests/${jobId}/status`, {
    headers: { Authorization: authHeader(apiKey) },
  });

  if (!res.ok) {
    throw new HiggsfieldError(`Higgsfield poll failed ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status,
    });
  }

  const data = await res.json() as {
    request_id?: string;
    status?: string;
    video?: { url?: string };
    error?: string;
  };

  const status = normaliseStatus(data.status ?? "queued");
  const videoUrl = data.video?.url;
  // `nsfw` is a terminal rejection — surface a useful message.
  const error = data.error ?? ((data.status ?? "").toLowerCase() === "nsfw"
    ? "Rejected by Higgsfield content moderation."
    : undefined);

  return { jobId, status, videoUrl, error };
}

function normaliseStatus(raw: string): HiggsJobResult["status"] {
  const s = raw.toLowerCase();
  if (s === "completed" || s === "complete" || s === "succeeded" || s === "success") return "complete";
  if (s === "failed" || s === "error" || s === "nsfw") return "failed";
  if (s === "in_progress" || s === "processing" || s === "running") return "processing";
  return "pending"; // queued / unknown
}
