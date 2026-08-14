import type { drizzle } from "drizzle-orm/d1";
import { logAiCost, checkBudget, isAiEnabled } from "./cost-tracker";
import { PRICING } from "./constants";

type Db = ReturnType<typeof drizzle>;

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

// ── Workers AI ───────────────────────────────────────────────────────────────

export async function callWorkersAi(
  ai: Ai,
  params: { messages: Message[]; model?: string; maxTokens?: number }
): Promise<AiResult> {
  const model = params.model ?? "@cf/meta/llama-3.1-8b-instruct";

  const response = await ai.run(model as Parameters<Ai["run"]>[0], {
    messages: params.messages,
    max_tokens: params.maxTokens ?? 1024,
  }) as { response?: string };

  const text = response?.response ?? "";
  // Workers AI doesn't return token counts reliably, estimate from text length
  const inputTokens = Math.ceil(params.messages.reduce((s, m) => s + m.content.length, 0) / 4);
  const outputTokens = Math.ceil(text.length / 4);

  return { text, inputTokens, outputTokens, provider: "workers_ai", model };
}

// ── Workers AI Vision ────────────────────────────────────────────────────────

export async function callVisionAi(
  ai: Ai,
  params: { imageBytes: Uint8Array; prompt: string; maxTokens?: number }
): Promise<AiResult> {
  const model = "@cf/llava-hf/llava-1.5-7b-hf";

  const response = await ai.run(model as Parameters<Ai["run"]>[0], {
    image: [...params.imageBytes],
    prompt: params.prompt,
    max_tokens: params.maxTokens ?? 512,
  }) as { description?: string };

  const text = response?.description ?? "";
  const inputTokens = Math.ceil(params.prompt.length / 4) + 256; // estimate image tokens
  const outputTokens = Math.ceil(text.length / 4);

  return { text, inputTokens, outputTokens, provider: "workers_ai", model };
}

/**
 * Sniff an image's media type from magic bytes. The Anthropic API requires an
 * accurate media_type on image blocks; social-media thumbnails arrive as
 * jpeg/png/webp/gif and their URLs routinely lie about the format.
 */
export function sniffImageMediaType(
  bytes: Uint8Array
): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  return null;
}

/** Chunked base64 without Buffer (Workers runtime) — same helper shape as
 *  lib/monitor/rekognition.ts. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── Anthropic (raw fetch) ────────────────────────────────────────────────────

export async function callAnthropic(
  apiKey: string,
  params: { messages: Array<{ role: "user" | "assistant"; content: string }>; system?: string; model?: string }
): Promise<AiResult> {
  const model = params.model ?? "claude-haiku-4-5-20251001";

  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages: params.messages,
  };
  if (params.system) body.system = params.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    provider: "anthropic",
    model,
  };
}

/**
 * Anthropic vision via the same raw-fetch path as callAnthropic — the image
 * rides as a base64 content block ahead of the text prompt. Claude Haiku's
 * vision is a large step up from LLaVA 1.5 7B for the subjective reads the
 * monitor needs (generator house styles, face-swap blending seams), at a cost
 * the $1/14-day budget ceiling absorbs (~1k–5k image tokens per thumbnail at
 * Haiku input rates).
 */
export async function callAnthropicVision(
  apiKey: string,
  params: {
    imageBytes: Uint8Array;
    prompt: string;
    system?: string;
    model?: string;
    maxTokens?: number;
  }
): Promise<AiResult | null> {
  const model = params.model ?? "claude-haiku-4-5-20251001";
  const mediaType = sniffImageMediaType(params.imageBytes);
  // Unknown container → refuse rather than guess: a wrong media_type is a 400.
  if (!mediaType) return null;

  const body: Record<string, unknown> = {
    model,
    max_tokens: params.maxTokens ?? 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: bytesToBase64(params.imageBytes) },
          },
          { type: "text", text: params.prompt },
        ],
      },
    ],
  };
  if (params.system) body.system = params.system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    text: data.content.filter((c) => c.type === "text").map((c) => c.text).join(""),
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    provider: "anthropic",
    model,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function callAi(
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
  db: Db,
  params: {
    feature: string;
    requiresReasoning: boolean;
    system?: string;
    userMessage: string;
  }
): Promise<{ text: string } | null> {
  const enabled = await isAiEnabled(db);
  if (!enabled) return null;

  const budget = await checkBudget(db);

  // Workers AI is free, so only check budget for Anthropic
  const useAnthropic = params.requiresReasoning && !!env.ANTHROPIC_API_KEY;

  if (useAnthropic && budget.exhausted) {
    // Try Workers AI as fallback if budget exhausted for Anthropic
    if (!env.AI) return null;
  }

  const messages: Message[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  messages.push({ role: "user", content: params.userMessage });

  let result: AiResult;

  try {
    if (useAnthropic && !budget.exhausted) {
      result = await callAnthropic(env.ANTHROPIC_API_KEY!, {
        messages: [{ role: "user", content: params.userMessage }],
        system: params.system,
      });
    } else if (env.AI) {
      result = await callWorkersAi(env.AI, {
        messages,
        maxTokens: params.feature === "suggestions" ? 1024 : 512,
      });
    } else {
      return null;
    }
  } catch (err) {
    // Log error and try fallback
    await logAiCost(db, {
      provider: useAnthropic ? "anthropic" : "workers_ai",
      model: useAnthropic ? "claude-haiku-4-5-20251001" : "@cf/meta/llama-3.1-8b-instruct",
      feature: params.feature,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      error: err instanceof Error ? err.message : String(err),
      prompt: params.userMessage.slice(0, 2000),
    });

    // Fallback: if Anthropic failed, try Workers AI
    if (useAnthropic && env.AI) {
      try {
        result = await callWorkersAi(env.AI, {
          messages,
          maxTokens: params.feature === "suggestions" ? 1024 : 512,
        });
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  // Calculate cost
  const pricing =
    result.provider === "anthropic"
      ? PRICING["claude-haiku-4-5-20251001"]
      : PRICING["workers-ai"];
  const cost =
    result.inputTokens * pricing.input + result.outputTokens * pricing.output;

  await logAiCost(db, {
    provider: result.provider,
    model: result.model,
    feature: params.feature,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostUsd: cost,
    prompt: params.userMessage.slice(0, 2000),
    response: result.text.slice(0, 4000),
  });

  return { text: result.text };
}
