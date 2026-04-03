import { getDb } from "@/lib/db";
import { logAiCost, checkBudget, isAiEnabled } from "./cost-tracker";
import { PRICING } from "./constants";

type Db = ReturnType<typeof getDb>;

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
  params: { messages: Message[]; model?: string }
): Promise<AiResult> {
  const model = params.model ?? "@cf/meta/llama-3.1-8b-instruct";

  const response = await ai.run(model as Parameters<Ai["run"]>[0], {
    messages: params.messages,
  }) as { response?: string };

  const text = response?.response ?? "";
  // Workers AI doesn't return token counts reliably, estimate from text length
  const inputTokens = Math.ceil(params.messages.reduce((s, m) => s + m.content.length, 0) / 4);
  const outputTokens = Math.ceil(text.length / 4);

  return { text, inputTokens, outputTokens, provider: "workers_ai", model };
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
      result = await callWorkersAi(env.AI, { messages });
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
    });

    // Fallback: if Anthropic failed, try Workers AI
    if (useAnthropic && env.AI) {
      try {
        result = await callWorkersAi(env.AI, { messages });
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
  });

  return { text: result.text };
}
