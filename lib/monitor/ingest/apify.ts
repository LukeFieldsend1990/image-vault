/**
 * Minimal Apify REST client.
 *
 * Apify hosts maintained scrapers ("actors") behind a plain HTTP API, so this
 * needs no SDK — `fetch` only, same as the TMDB calls elsewhere in the app.
 *
 * Lifecycle: start a run, poll it, fetch its dataset. Runs take 1-3 minutes,
 * which is why the caller must be async (queue / waitUntil) rather than an
 * awaited request handler.
 *
 * Deliberately NOT using Apify's `run-sync-get-dataset-items` convenience
 * endpoint: it blocks for up to five minutes and would hold a Worker request
 * open for the entire run.
 */

const APIFY_BASE = "https://api.apify.com/v2";

/** Actor IDs use '~' rather than '/' in REST paths. */
export const ACTORS = {
  hashtag: "apify~instagram-hashtag-scraper",
  search: "apify~instagram-search-scraper",
  profile: "apify~instagram-scraper",
} as const;

export type ApifyFailureReason =
  | "auth"
  | "run_failed"
  | "timeout"
  | "network"
  | "bad_response";

export class ApifyError extends Error {
  constructor(
    readonly reason: ApifyFailureReason,
    message: string,
    /** Set once a run exists. A run that started has spent money even if it
     *  then failed, so the caller must still book it against the budget. */
    readonly runId: string | null = null,
    readonly costUsd: number | null = null
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

interface RunEnvelope {
  data?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
    statusMessage?: string;
    /** Apify's own billed total for the run — the figure the spend gate sums. */
    usageTotalUsd?: number;
  };
}

export interface ActorRunResult<T> {
  items: T[];
  runId: string;
  /** null when the run reported no usage figure; caller falls back to an estimate. */
  costUsd: number | null;
}

/**
 * Spend gate handed to every Apify-backed discovery module. Checked before
 * each run and written to after it — the shape the instagram/tiktok modules
 * declared inline, lifted here so the newer platform modules share it.
 */
export interface ActorBudget {
  check: () => Promise<{ ok: boolean; reason: string | null }>;
  record: (entry: {
    runId: string | null;
    actorId: string;
    mode: string;
    query: string;
    itemCount: number;
    costUsd: number | null;
    status: "succeeded" | "failed";
    error?: string;
  }) => Promise<void>;
}

const TERMINAL_OK = "SUCCEEDED";
const TERMINAL_BAD = new Set(["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT"]);

export interface RunActorOptions {
  token: string;
  actorId: string;
  input: unknown;
  /** Wall-clock ceiling for the whole run, ms. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Hard cap on billed results, enforced by Apify itself. */
  maxItems?: number;
  signal?: AbortSignal;
}

async function apifyFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    throw new ApifyError("network", `Apify request failed: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApifyError("auth", "Apify rejected the token (401/403)");
  }
  if (!res.ok) {
    throw new ApifyError("bad_response", `Apify returned ${res.status} for ${new URL(url).pathname}`);
  }
  return res;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ApifyError("timeout", "Aborted while waiting for Apify run"));
      },
      { once: true }
    );
  });

/** Best-effort: stop a run we have given up on so it stops billing. */
async function abortRun(token: string, runId: string): Promise<void> {
  try {
    await fetch(`${APIFY_BASE}/actor-runs/${runId}/abort?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch {
    // The run will hit its own timeout; nothing further we can do from here.
  }
}

/**
 * Start an actor, wait for it, and return its dataset items plus billed cost.
 *
 * Throws ApifyError; callers degrade rather than propagate. Note that a throw
 * after the run started still means money was spent — `err.runId` carries the
 * id so the caller can record it against the budget.
 */
export async function runActor<T = Record<string, unknown>>(
  opts: RunActorOptions
): Promise<ActorRunResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  const params = new URLSearchParams({ token: opts.token });
  if (opts.maxItems) params.set("maxItems", String(opts.maxItems));
  // Give Apify its own ceiling slightly under ours so it tidies up first.
  params.set("timeout", String(Math.ceil(timeoutMs / 1000) + 30));

  const startRes = await apifyFetch(
    `${APIFY_BASE}/acts/${opts.actorId}/runs?${params}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.input),
    },
    opts.signal
  );

  const started = (await startRes.json()) as RunEnvelope;
  const runId = started.data?.id;
  const datasetId = started.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new ApifyError("bad_response", "Apify run response carried no run id / dataset id");
  }

  let status = started.data?.status ?? "READY";
  let costUsd = started.data?.usageTotalUsd ?? null;
  while (status !== TERMINAL_OK) {
    if (TERMINAL_BAD.has(status)) {
      // A failed run still consumed compute, so the cost travels with the error.
      throw new ApifyError("run_failed", `Apify run ${runId} ended ${status}`, runId, costUsd);
    }
    if (Date.now() >= deadline) {
      await abortRun(opts.token, runId);
      throw new ApifyError(
        "timeout",
        `Apify run ${runId} exceeded ${Math.round(timeoutMs / 1000)}s`,
        runId,
        costUsd
      );
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), opts.signal);

    const pollRes = await apifyFetch(
      `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(opts.token)}`,
      { method: "GET" },
      opts.signal
    );
    const polled = (await pollRes.json()) as RunEnvelope;
    status = polled.data?.status ?? status;
    if (typeof polled.data?.usageTotalUsd === "number") costUsd = polled.data.usageTotalUsd;
  }

  const itemsRes = await apifyFetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(opts.token)}`,
    { method: "GET" },
    opts.signal
  );
  const items = (await itemsRes.json()) as unknown;
  if (!Array.isArray(items)) {
    throw new ApifyError("bad_response", "Apify dataset did not return an array", runId, costUsd);
  }
  return { items: items as T[], runId, costUsd };
}

/** Read the token from the Worker env, falling back to process.env for local dev. */
export function apifyToken(env?: { APIFY_TOKEN?: string }): string | null {
  const token = env?.APIFY_TOKEN ?? process.env.APIFY_TOKEN;
  return token && token.trim() ? token.trim() : null;
}
