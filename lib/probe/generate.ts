/**
 * Image generation for probe runs — provider-abstracted, Replicate first.
 *
 * A probe needs to run two shapes of target through the same interface:
 *   • civitai_lora  — an arbitrary community LoRA, run by weights URL on a
 *                     community LoRA-runner model
 *   • hosted_model  — a named foundation/hosted model (SDXL, Flux) run directly
 *
 * Both are create-prediction + poll over plain HTTP (no SDK — keeps the Workers
 * bundle small and works identically in the pipeline-worker runtime). The
 * `GenerationProvider` interface is the seam: the real Replicate client ships
 * here, and tests / dry runs inject a deterministic fake so the whole
 * orchestration can be exercised without spending a cent.
 *
 * Determinism: every request carries an explicit seed from the protocol, so a
 * replayed run reproduces the same generation conditions.
 */

export interface GenerateRequest {
  prompt: string;
  negativePrompt: string;
  seed: number;
  /** For civitai_lora: the weights URL the LoRA-runner loads. */
  loraUrl?: string | null;
}

export interface GenerateResult {
  /** PNG/JPEG bytes of the generated image. */
  bytes: Uint8Array;
  contentType: string;
  /** Provider prediction id, for the audit trail. */
  predictionId: string | null;
  /** Billed cost for this single generation, when the provider reports it. */
  costUsd: number | null;
}

export interface GenerationProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface ReplicateConfig {
  apiToken: string;
  /** The model version to run. For hosted_model this is the base model version;
   *  for civitai_lora it is a LoRA-runner version that accepts a lora url. */
  modelVersion: string;
  /** Whether the model takes the LoRA as a `lora`/`lora_url` input. */
  acceptsLora?: boolean;
  /** Nominal per-image cost, used when the API doesn't return one. */
  perImageUsd?: number;
  /** Poll ceiling in milliseconds. */
  maxPollMs?: number;
  fetchImpl?: typeof fetch;
}

const REPLICATE_BASE = "https://api.replicate.com/v1";

/** Real Replicate provider — create a prediction, poll to completion, fetch the
 *  output image bytes. Throws on a failed/timed-out prediction so the caller
 *  marks the sample failed rather than banking an empty result. */
export function replicateProvider(config: ReplicateConfig): GenerationProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const maxPollMs = config.maxPollMs ?? 120_000;

  return {
    name: "replicate",
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        negative_prompt: req.negativePrompt,
        seed: req.seed,
        num_outputs: 1,
      };
      if (config.acceptsLora && req.loraUrl) input.lora = req.loraUrl;

      const created = await doFetch(`${REPLICATE_BASE}/predictions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ version: config.modelVersion, input }),
      });
      if (!created.ok) {
        throw new Error(`replicate create failed: ${created.status}`);
      }
      let pred = (await created.json()) as {
        id?: string;
        status?: string;
        output?: unknown;
        urls?: { get?: string };
        metrics?: { predict_time?: number };
      };

      const start = Date.now();
      while (pred.status && !["succeeded", "failed", "canceled"].includes(pred.status)) {
        if (Date.now() - start > maxPollMs) throw new Error("replicate poll timed out");
        await new Promise((r) => setTimeout(r, 1500));
        const getUrl = pred.urls?.get ?? `${REPLICATE_BASE}/predictions/${pred.id}`;
        const poll = await doFetch(getUrl, {
          headers: { authorization: `Bearer ${config.apiToken}` },
        });
        if (!poll.ok) throw new Error(`replicate poll failed: ${poll.status}`);
        pred = (await poll.json()) as typeof pred;
      }
      if (pred.status !== "succeeded") throw new Error(`replicate prediction ${pred.status}`);

      const outputUrl = Array.isArray(pred.output)
        ? (pred.output[0] as string)
        : typeof pred.output === "string"
          ? pred.output
          : null;
      if (!outputUrl) throw new Error("replicate returned no output image");

      const img = await doFetch(outputUrl);
      if (!img.ok) throw new Error(`fetch generated image failed: ${img.status}`);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const contentType = img.headers.get("content-type") ?? "image/png";

      return {
        bytes,
        contentType,
        predictionId: pred.id ?? null,
        costUsd: config.perImageUsd ?? null,
      };
    },
  };
}
