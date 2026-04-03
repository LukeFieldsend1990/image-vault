// ── AI Feature Constants ─────────────────────────────────────────────────────

export const TAG_VOCABULARY = {
  scan_type: ["full-body", "head-only", "hands", "face-detail", "texture-set", "partial-body"] as const,
  quality: ["vfx-grade", "realtime-grade", "preview-only", "raw-unprocessed"] as const,
  compatibility: ["unreal-ready", "unity-ready", "maya-compatible", "blender-compatible", "usd-format"] as const,
  completeness: ["multi-angle", "single-pose", "expression-set", "full-range-of-motion", "static-only"] as const,
} as const;

export type TagCategory = keyof typeof TAG_VOCABULARY;
export type TagValue = (typeof TAG_VOCABULARY)[TagCategory][number];

export const ALL_TAGS = new Set<string>(
  Object.values(TAG_VOCABULARY).flatMap((v) => [...v])
);

export type SuggestionCategory = "action_required" | "attention" | "insight" | "security";
export type AIFeature = "suggestions" | "fee_guidance" | "metadata_tags" | "security_alerts" | "licence_summary";

// ── Pricing (USD per token) ──────────────────────────────────────────────────

export const PRICING = {
  "claude-haiku-4-5-20251001": { input: 0.80 / 1_000_000, output: 4.00 / 1_000_000 },
  "workers-ai": { input: 0, output: 0 }, // free tier
} as const;

// ── Suggestion expiry ────────────────────────────────────────────────────────

export const SUGGESTION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const ACKNOWLEDGED_RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const MAX_SUGGESTIONS_PER_REP = 10;
export const ACTIVE_USER_WINDOW_SECONDS = 48 * 60 * 60; // 48 hours

// ── System Prompts ───────────────────────────────────────────────────────────

export const REP_SUGGESTION_PROMPT = `You are an assistant for talent representatives managing digital likeness licensing.

You will receive a JSON object containing signals about the rep's managed talent.
Each signal has a type, the relevant entity data, and computed metrics.

Your job is to:
1. Prioritise signals by urgency: expiring licences and security events first,
   then pending requests, then login anomalies, then revenue insights.
2. For each signal, write a 1-2 sentence suggestion in plain English.
3. Include specific numbers, names, and dates from the data — never invent facts.
4. Assign a category: action_required, attention, or insight.
5. Suggest a clear next action (e.g., "review the request", "contact the licensee").

Return a JSON array of suggestion objects. Maximum 10 suggestions.

Schema: [{ "title": string, "body": string, "category": "action_required"|"attention"|"insight", "deepLink": string, "entityType": "licence"|"package"|"talent"|"download", "entityId": string, "priority": number (0=highest, 100=lowest) }]

Do not include disclaimers, greetings, or commentary outside the JSON array.`;

export const FEE_GUIDANCE_PROMPT = `You are a fee benchmarking tool for digital likeness licensing.

You will receive:
- The current licence request details (type, territory, exclusivity)
- An array of comparable completed licences (anonymised — no talent names)

Write exactly one sentence summarising the typical fee range and how the
current proposal compares. Use specific numbers. Do not give financial advice
or recommend accepting/rejecting. Label outliers if present.

If fewer than 3 comparables are provided, respond with exactly:
{"guidance": null, "reason": "insufficient_data"}

Otherwise respond with: {"guidance": "<your one sentence>"}`;

export const METADATA_TAG_PROMPT = `You are a metadata tagging assistant for 3D likeness scan packages.

You will receive a scan package manifest: file names, sizes, content types, and optional technician notes.

From the following controlled vocabulary ONLY, select all tags that apply:

scan_type: full-body, head-only, hands, face-detail, texture-set, partial-body
quality: vfx-grade, realtime-grade, preview-only, raw-unprocessed
compatibility: unreal-ready, unity-ready, maya-compatible, blender-compatible, usd-format
completeness: multi-angle, single-pose, expression-set, full-range-of-motion, static-only

Return a JSON array of objects: [{"tag": string, "category": string}]

Only use tags from the vocabulary above. Do not invent new tags.`;

export const SECURITY_ALERT_PROMPT = `You are a security monitoring assistant for a digital likeness vault platform.

You will receive details about a security event (download anomaly, tamper detection, etc.)
and recent related events for context.

Write exactly one concise sentence describing the event and its significance.
Include specific facts: counts, IPs, device IDs, timeframes.
End with a recommended action.

Respond with: {"alert": "<your sentence>"}`;
