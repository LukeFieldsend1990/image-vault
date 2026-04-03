# Image Vault — Applied AI Features Spec

> **Phase 6: Applied AI — Low-lift LLM features to surface intelligence from existing platform data.**

---

## 1. Overview

Add an AI layer that reasons over existing D1 data (licences, downloads, login activity, bridge events) to generate actionable suggestions for reps, flag security anomalies, and assist with commercial decisions. All features are gated behind an admin kill-switch and subject to a hard cost ceiling.

**Principles:**
- AI reasons and triages — it doesn't just format. Suggestions are prioritised by urgency and commercial impact.
- Tight guardrails: structured prompts, constrained output schemas, no freeform generation visible to users.
- Cost-capped: $1/2 weeks hard ceiling. All spend tracked and visible in admin.
- Graceful degradation: if AI is disabled or budget exhausted, the platform works identically — just without suggestions.

---

## 2. Features

### 2.1 Rep Suggestion Engine (Core Feature)

**What:** A twice-daily batch job that queries D1 for signals across all talent a rep manages, passes them through an LLM for reasoning/triage, and writes prioritised suggestions to a `suggestions` table. Reps see these on their roster dashboard.

**Signal Types (deterministic DB queries):**

| Signal | Query Logic | Example Output |
|---|---|---|
| Pending licence requests | `licences WHERE status='PENDING' AND talent_id IN (rep's roster)` | "Emma Watson has 4 pending licence requests — oldest is 6 days old (Netflix, film_double). Consider reviewing before it goes stale." |
| Expiring licence, no downloads | `licences WHERE validTo < now+30d AND status='APPROVED' AND downloadCount=0` | "Licence #abc for Idris Elba expires in 12 days but the licensee (Warner Bros) hasn't downloaded. Contact: +44 7700 900123. This may need a nudge." |
| High login frequency | `refreshTokens WHERE userId=X GROUP BY date, COUNT > 3 in 7 days` | "Daniel Craig has logged in 6 times this week (vs 1x/week average). He may have questions or concerns about a pending request." |
| Revenue opportunity | `licences WHERE agreedFee > 0 GROUP BY licenceType, compare to pending` | "The pending commercial licence from Unilever proposes £45k. Your last 3 commercial licences averaged £62k. This is 27% below your typical rate." |
| Stale packages | `scanPackages WHERE status='ready' AND no licence activity in 90 days` | "3 scan packages for Florence Pugh have had no licence requests in 90+ days. Consider updating the directory listing or reaching out to production contacts." |
| Approaching capacity | `scanPackages total size approaching storage tier threshold` | "Total vault storage for your roster is at 4.2 TB (84% of 5 TB tier). Consider archiving older packages." |

**LLM Role:** The LLM receives the raw signals as structured JSON and a system prompt that instructs it to:
1. Prioritise by urgency (expiring licences > pending requests > login anomalies > revenue insights)
2. Assess commercial impact (higher-fee licences get higher priority)
3. Write a 1-2 sentence natural language suggestion with a clear recommended action
4. Assign a category: `action_required` | `attention` | `insight`
5. Include a deep-link target (e.g., `/vault/requests`, `/roster/[talentId]`, `/vault/licences`)

**Guardrails:**
- System prompt is hardcoded, never user-modifiable
- LLM output must conform to a JSON schema — reject and log malformed responses
- No hallucinated data: every fact in a suggestion must trace to a signal from the DB query
- Max 10 suggestions per rep per batch run (prioritised by urgency)
- LLM never sees scan file contents, passwords, or encryption keys — only metadata

**Activation Rules:**
- Suggestions only run for users who have logged in within the last 48 hours
- Batch runs at 07:00 and 14:00 UTC (configurable in admin)
- If AI features are disabled in admin, the cron job is a no-op
- If cost ceiling is reached, skip LLM call and log a warning to admin

---

### 2.2 Smart Fee Guidance

**What:** When a talent/rep reviews an incoming licence request, show a fee benchmark based on historical data from the platform.

**How it works:**
1. On licence review page load, query D1 for completed (APPROVED) licences with matching attributes:
   - Same `licenceType`
   - Same or similar `territory`
   - Same `exclusivity` level
   - Similar talent popularity bracket (from `talentProfiles.popularity`)
2. Calculate: median agreed fee, 25th/75th percentile, count of comparable deals
3. Pass to LLM with a constrained prompt: "Given these comparables, write a 1-sentence fee guidance note."
4. Display on the review page: "Based on 8 similar film_double licences (UK, non-exclusive), typical agreed fees range £75k–£120k. The top 10% achieved £140k+."

**Guardrails:**
- Minimum 3 comparable licences required to show guidance — otherwise display "Insufficient data for fee guidance"
- Never show other talent's names or specific deal details — only aggregated statistics
- Fee guidance is clearly labelled as "Platform Insight" not advice
- Off by default — admin toggle to enable (for testing/validation before rollout)

**Cost:** One LLM call per licence review page load (only when toggled on). Cacheable for 24h per licence-type + territory + exclusivity combination.

---

### 2.3 Automated Package Metadata Tags

**What:** When a scan package reaches `status: ready`, suggest metadata tags based on package attributes (file names, file types, sizes, technician notes, talent profile).

**Tag Categories:**
- **Scan type:** `full-body`, `head-only`, `hands`, `face-detail`, `texture-set`
- **Quality tier:** `vfx-grade`, `realtime-grade`, `preview-only`
- **Compatibility:** `unreal-ready`, `unity-ready`, `maya-compatible`
- **Completeness:** `multi-angle`, `single-pose`, `expression-set`

**How it works:**
1. On package completion, fire a lightweight LLM call with: file manifest (names, sizes, types), technician notes, talent profile metadata
2. LLM returns an array of suggested tags from a fixed vocabulary (no freeform tags)
3. Tags are written to a `package_tags` table with `status: suggested`
4. Talent/rep sees suggested tags on the package detail page with accept/dismiss per tag
5. Accepted tags become visible in the licensee directory (searchable/filterable)

**Guardrails:**
- Tags are drawn from a controlled vocabulary defined in code — LLM cannot invent new tags
- Tags require human approval before becoming visible
- One LLM call per package (on status change to `ready`) — not on every page load

---

### 2.4 Security Anomaly Alerts

**What:** Detect unusual patterns in download events and bridge events and surface them as high-priority suggestions.

**Anomaly Patterns:**

| Pattern | Detection Logic | Severity |
|---|---|---|
| Unusual download volume | >3 downloads from same licence in 24h | `attention` |
| New IP on download | Download IP doesn't match any previous IP for that licensee | `attention` |
| Bridge tamper event | `bridgeEvents WHERE eventType IN ('tamper_detected','hash_mismatch','unexpected_copy')` | `action_required` |
| Download after hours | Download initiated outside 06:00–22:00 in licensee's timezone (if known) | `insight` |
| Expired licence download attempt | Failed download attempt on expired/revoked licence | `action_required` |

**How it works:**
- Event-driven: checked on each download event write and each bridge event write
- No LLM call for detection — these are deterministic rules
- LLM is used only to compose the alert message with context (e.g., "This is the 3rd tamper event from device X in 48 hours — escalation recommended")
- Alerts are written to the same `suggestions` table with `category: security`
- Rate-limited: max 5 security alerts per licence per day (prevent alert fatigue)

**Cost control on event-driven alerts:**
- LLM call only for `action_required` severity — `attention` and `insight` use template strings
- Max 10 LLM-generated security alerts per day globally
- If daily limit reached, fall back to template strings for remaining alerts

---

### 2.5 Licence Request Summary (Off by Default)

**What:** When a licence request arrives, auto-generate a plain-English summary for the talent/rep.

**Example output:**
> "Netflix (via their VFX department) is requesting a non-exclusive film_double licence for your full-body scan package from March 2025. Territory: worldwide. Duration: 18 months. Proposed fee: £180,000. AI training: explicitly declined. Based on the proposed fee and terms, this appears to be a standard high-budget production request."

**How it works:**
1. On licence creation (status: PENDING), pass structured licence fields to LLM
2. LLM generates a 2-3 sentence summary following a fixed template structure
3. Summary stored on the suggestion or displayed inline on the review page

**Guardrails:**
- Off by default — admin toggle to enable
- Summary is clearly labelled "AI-generated summary — verify all details"
- No recommendation to approve/deny — purely descriptive
- Fixed template structure: who + what + terms + context

---

## 3. Architecture

### 3.1 LLM Provider Strategy

**Primary: Cloudflare Workers AI (on-stack, free tier)**
- Model: `@cf/meta/llama-3.1-8b-instruct` (or latest available)
- Use for: metadata tags, suggestion message phrasing, security alert composition
- Free tier: 10,000 neurons/day — sufficient for batch + event-driven at current scale
- Binding: `AI` in wrangler.toml

**Fallback: External API (Claude via Anthropic SDK)**
- Use for: fee guidance reasoning, licence summary generation (requires stronger reasoning)
- Model: `claude-haiku-4-5-20251001` (cheapest capable model)
- Called only when Workers AI is insufficient or for features requiring stronger reasoning
- API key stored as Cloudflare secret: `ANTHROPIC_API_KEY`

**Provider selection logic:**
```
if (task.requiresReasoning) → Claude Haiku
else → Workers AI
if (Workers AI fails) → Claude Haiku fallback
if (budget exhausted) → skip, log warning
```

### 3.2 Cost Tracking & Budget

**Hard ceiling: $1.00 per 2-week period (rolling)**

| Table: `ai_cost_log` |
|---|
| `id` TEXT PK |
| `provider` TEXT — 'workers_ai' or 'anthropic' |
| `model` TEXT |
| `feature` TEXT — 'suggestions' / 'fee_guidance' / 'metadata_tags' / 'security_alerts' / 'licence_summary' |
| `input_tokens` INTEGER |
| `output_tokens` INTEGER |
| `estimated_cost_usd` REAL — calculated at write time |
| `created_at` INTEGER |

**Budget check before every external API call:**
```sql
SELECT SUM(estimated_cost_usd) FROM ai_cost_log
WHERE created_at > unixepoch() - (14 * 86400)
```
If >= $1.00, skip the call. Workers AI calls are free but still logged for observability.

**Admin dashboard shows:**
- Rolling 14-day spend (total + per feature)
- Call count by provider and feature
- Budget remaining
- Projected spend at current rate

### 3.3 Batch Job (Cron Trigger)

**Cloudflare Cron Trigger** — configured in `wrangler.toml`:
```toml
[triggers]
crons = ["0 7 * * *", "0 14 * * *"]  # 07:00 and 14:00 UTC
```

**Job flow:**
1. Check `ai_settings.enabled` — if false, exit
2. Check rolling budget — if exhausted, log warning and exit
3. Query active reps (logged in within 48h)
4. For each rep: gather signals from D1 (pending licences, expiring licences, login frequency, etc.)
5. If no signals, skip
6. Call LLM with signals + system prompt → get prioritised suggestions
7. Write suggestions to `suggestions` table (upsert — don't duplicate existing unacknowledged suggestions of same type for same entity)
8. Log cost to `ai_cost_log`

### 3.4 Database Schema Additions

```sql
-- Migration: 0019_ai_features.sql

-- AI feature settings (singleton row per setting)
CREATE TABLE ai_settings (
  key TEXT PRIMARY KEY,           -- 'enabled', 'fee_guidance_enabled', 'licence_summary_enabled',
                                  --  'budget_ceiling_usd', 'cron_schedule'
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);

-- Insert defaults
INSERT INTO ai_settings (key, value, updated_by, updated_at) VALUES
  ('enabled', 'true', NULL, unixepoch()),
  ('fee_guidance_enabled', 'false', NULL, unixepoch()),
  ('licence_summary_enabled', 'false', NULL, unixepoch()),
  ('budget_ceiling_usd', '1.00', NULL, unixepoch()),
  ('max_security_alerts_per_day', '10', NULL, unixepoch());

-- Suggestions surfaced to reps/talent
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the rep/talent who sees this
  category TEXT NOT NULL,         -- 'action_required' | 'attention' | 'insight' | 'security'
  feature TEXT NOT NULL,          -- 'rep_suggestions' | 'fee_guidance' | 'security_alert'
  title TEXT NOT NULL,            -- short headline
  body TEXT NOT NULL,             -- 1-2 sentence suggestion
  deep_link TEXT,                 -- e.g., '/vault/requests', '/roster/abc123'
  entity_type TEXT,               -- 'licence' | 'package' | 'talent' | 'download'
  entity_id TEXT,                 -- ID of the related entity
  priority INTEGER NOT NULL DEFAULT 50,  -- 0=highest, 100=lowest
  acknowledged_at INTEGER,        -- null until user dismisses; purge row 30d after this
  clicked_at INTEGER,             -- null until user clicks through
  expires_at INTEGER NOT NULL,    -- created_at + 7 days; unacknowledged suggestions hidden after this
  batch_id TEXT,                  -- links to the cron run that created it
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_suggestions_user_unack ON suggestions(user_id, acknowledged_at);
CREATE INDEX idx_suggestions_created ON suggestions(created_at);

-- Package metadata tags
CREATE TABLE package_tags (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,              -- from controlled vocabulary
  category TEXT NOT NULL,         -- 'scan_type' | 'quality' | 'compatibility' | 'completeness'
  status TEXT NOT NULL DEFAULT 'suggested',  -- 'suggested' | 'accepted' | 'dismissed'
  suggested_by TEXT NOT NULL DEFAULT 'ai',   -- 'ai' | 'user'
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_package_tags_package ON package_tags(package_id);
CREATE INDEX idx_package_tags_status ON package_tags(status);

-- AI cost tracking
CREATE TABLE ai_cost_log (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,         -- 'workers_ai' | 'anthropic'
  model TEXT NOT NULL,
  feature TEXT NOT NULL,          -- 'suggestions' | 'fee_guidance' | 'metadata_tags' | 'security_alerts' | 'licence_summary'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,                     -- null on success, error message on failure
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_cost_log_created ON ai_cost_log(created_at);
CREATE INDEX idx_ai_cost_log_feature ON ai_cost_log(feature);
```

---

## 4. API Routes

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/suggestions` | List unacknowledged suggestions for current user | rep, talent |
| `PATCH` | `/api/suggestions/[id]/acknowledge` | Mark suggestion as acknowledged | rep, talent |
| `PATCH` | `/api/suggestions/[id]/click` | Record click-through | rep, talent |
| `GET` | `/api/ai/fee-guidance?licenceType=X&territory=Y&exclusivity=Z` | Get fee benchmark for licence review | rep, talent |
| `POST` | `/api/ai/package-tags/[packageId]` | Trigger tag suggestion for a package | rep, talent |
| `PATCH` | `/api/ai/package-tags/[tagId]` | Accept or dismiss a suggested tag | rep, talent |
| `GET` | `/api/admin/ai/settings` | Get AI feature settings | admin |
| `PATCH` | `/api/admin/ai/settings` | Update AI feature settings (enable/disable, budget) | admin |
| `GET` | `/api/admin/ai/costs` | Get cost log and budget status | admin |
| `POST` | `/api/admin/ai/run-batch` | Manually trigger suggestion batch (for testing) | admin |

---

## 5. UI Components

### 5.1 Rep Dashboard — Suggestions Panel

Location: `/roster` page (existing rep dashboard)

```
┌─────────────────────────────────────────────────┐
│ 🔔 Suggestions                          3 new  │
├─────────────────────────────────────────────────┤
│ ⚠ ACTION REQUIRED                              │
│ Emma Watson has 4 pending licence requests —    │
│ oldest is 6 days old (Netflix, film_double).    │
│ [Review requests →]              [Acknowledge]  │
├─────────────────────────────────────────────────┤
│ ⚠ ATTENTION                                    │
│ Licence #abc for Idris Elba expires in 12 days  │
│ but Warner Bros hasn't downloaded.              │
│ Contact: +44 7700 900123                        │
│ [View licence →]                 [Acknowledge]  │
├─────────────────────────────────────────────────┤
│ 💡 INSIGHT                                     │
│ Daniel Craig logged in 6 times this week (vs    │
│ 1x/week avg). May need attention.               │
│ [View profile →]                 [Acknowledge]  │
└─────────────────────────────────────────────────┘
```

- Sorted by priority (action_required > attention > insight)
- "Acknowledge" animates the card out (~10s fade/slide), sets `acknowledged_at` in DB
- Deep-link click navigates to relevant page + sets `clicked_at`
- Unacknowledged suggestions auto-expire after 7 days and disappear from the UI
- If the same signal fires again in the next batch (e.g., still 4 pending requests), a fresh suggestion is created — persistent problems keep resurfacing until acted on
- Acknowledged suggestions are purged from DB after 30 days (audit-only retention)
- Empty state: "No suggestions right now. Check back later."

### 5.2 Package Detail — Suggested Tags

Location: `/vault/packages/[packageId]` page

```
┌─────────────────────────────────────────────────┐
│ Suggested Tags                    AI-generated  │
│                                                 │
│ [✓ full-body] [✓ vfx-grade] [✗ unreal-ready]  │
│ [✓ multi-angle] [✗ expression-set]             │
│                                                 │
│ ✓ = Accept   ✗ = Dismiss                       │
└─────────────────────────────────────────────────┘
```

### 5.3 Licence Review — Fee Guidance (When Enabled)

Location: `/vault/requests/[licenceId]` review page

```
┌─────────────────────────────────────────────────┐
│ 📊 Platform Insight                             │
│                                                 │
│ Based on 8 similar film_double licences         │
│ (UK, non-exclusive):                            │
│                                                 │
│ Typical range: £75,000 – £120,000               │
│ Top 10%:       £140,000+                        │
│ This proposal: £45,000 (27% below typical)      │
│                                                 │
│ ℹ For guidance only — not financial advice      │
└─────────────────────────────────────────────────┘
```

### 5.4 Admin — AI Settings & Costs

Location: `/admin/ai` (new admin page)

```
┌─────────────────────────────────────────────────┐
│ AI Features                                     │
├─────────────────────────────────────────────────┤
│ Master switch          [■ Enabled / □ Disabled] │
│ Fee guidance           [□ Enabled / ■ Disabled] │
│ Licence summaries      [□ Enabled / ■ Disabled] │
│ Budget ceiling (14d)   [$1.00         ]         │
│ Max security alerts/d  [10            ]         │
├─────────────────────────────────────────────────┤
│ Cost Summary (rolling 14 days)                  │
│                                                 │
│ Total spend:     $0.23 / $1.00                  │
│ ████████░░░░░░░░░░░░░░░░░░░░ 23%               │
│                                                 │
│ By feature:                                     │
│   Rep suggestions    $0.12  (52 calls)          │
│   Security alerts    $0.06  (18 calls)          │
│   Metadata tags      $0.03  (7 calls)           │
│   Fee guidance       $0.02  (4 calls)           │
│                                                 │
│ By provider:                                    │
│   Workers AI (free)  71 calls                   │
│   Anthropic Haiku    10 calls                   │
│                                                 │
│ Projected 14d spend: $0.41                      │
│                                                 │
│ [Run Batch Now]  (manual trigger for testing)   │
│ [View Full Cost Log →]                          │
└─────────────────────────────────────────────────┘
```

---

## 6. Controlled Vocabularies

### 6.1 Package Tags

```typescript
const TAG_VOCABULARY = {
  scan_type: ['full-body', 'head-only', 'hands', 'face-detail', 'texture-set', 'partial-body'],
  quality: ['vfx-grade', 'realtime-grade', 'preview-only', 'raw-unprocessed'],
  compatibility: ['unreal-ready', 'unity-ready', 'maya-compatible', 'blender-compatible', 'usd-format'],
  completeness: ['multi-angle', 'single-pose', 'expression-set', 'full-range-of-motion', 'static-only'],
} as const;
```

### 6.2 Suggestion Categories

```typescript
type SuggestionCategory = 'action_required' | 'attention' | 'insight' | 'security';
```

### 6.3 AI Features

```typescript
type AIFeature = 'suggestions' | 'fee_guidance' | 'metadata_tags' | 'security_alerts' | 'licence_summary';
```

---

## 7. System Prompts (Locked Down)

### 7.1 Rep Suggestion Prompt

```
You are an assistant for talent representatives managing digital likeness licensing.

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

Schema: { title: string, body: string, category: string, deepLink: string,
           entityType: string, entityId: string, priority: number }

Do not include disclaimers, greetings, or commentary outside the JSON array.
```

### 7.2 Fee Guidance Prompt

```
You are a fee benchmarking tool for digital likeness licensing.

You will receive:
- The current licence request details (type, territory, exclusivity)
- An array of comparable completed licences (anonymised — no talent names)

Write exactly one sentence summarising the typical fee range and how the
current proposal compares. Use specific numbers. Do not give financial advice
or recommend accepting/rejecting. Label outliers if present.

If fewer than 3 comparables are provided, respond with exactly:
{"guidance": null, "reason": "insufficient_data"}
```

---

## 8. Implementation Order

| # | Feature | Depends On | Est. Effort | LLM Provider |
|---|---|---|---|---|
| 1 | DB migration (0019_ai_features.sql) | — | Small | — |
| 2 | `ai_settings` admin API + UI (`/admin/ai`) | #1 | Medium | — |
| 3 | `ai_cost_log` tracking + budget check utility | #1 | Small | — |
| 4 | Workers AI binding + Anthropic client wrapper | — | Small | Both |
| 5 | Suggestion engine (batch job + cron trigger) | #1–4 | Large | Workers AI primary |
| 6 | Suggestions API + rep dashboard panel | #5 | Medium | — |
| 7 | Security anomaly detection (event-driven) | #1, #3, #4 | Medium | Template + Workers AI |
| 8 | Package metadata tags (on upload complete) | #1, #4 | Medium | Workers AI |
| 9 | Smart fee guidance (on licence review) | #1, #3, #4 | Medium | Claude Haiku |
| 10 | Licence request summary (off by default) | #1, #3, #4 | Small | Claude Haiku |

**Total new API routes:** 10
**New admin pages:** 1 (`/admin/ai`)
**New UI components:** 3 (suggestion panel, tag picker, fee guidance card)
**DB migration:** 1 (4 new tables + defaults)

---

## 9. Cost Estimates

**At bootstrap scale (1 agency, ~10 talent, ~5 reps):**

| Feature | Calls/day | Provider | Est. daily cost |
|---|---|---|---|
| Rep suggestions (2x batch) | ~10 | Workers AI (free) | $0.00 |
| Security alerts | ~2-5 | Template (free) | $0.00 |
| Metadata tags | ~1-2 | Workers AI (free) | $0.00 |
| Fee guidance | ~1-3 | Claude Haiku | ~$0.001-0.003 |
| Licence summary | ~0-1 | Claude Haiku | ~$0.001 |
| **Daily total** | | | **~$0.005** |
| **14-day total** | | | **~$0.07** |

Well within $1/2-week ceiling. Headroom for 10x growth before budget pressure.

---

## 10. Resolved Questions

1. **Licensee phone numbers** — Add an optional `phone` field to users table. Licensees can set it via `/settings`. Surfaced in suggestions when relevant (e.g., "licence expiring, no downloads — contact: +44 7700 900123").
2. **Login tracking granularity** — Refresh token creation frequency is a good enough proxy for login frequency at V1. No additional tracking needed.
3. **Timezone for download anomalies** — Skip "after hours" detection for V1. No timezone stored. Can revisit if we add timezone to user settings later.
4. **Tag visibility in directory** — Accepted tags are searchable/filterable in the licensee directory. Gives licensees a way to find packages by capability (e.g., "unreal-ready", "vfx-grade").
5. **Suggestion retention** — Acknowledged suggestions: animate out of UI in ~10s, purged from DB after 30 days. Unacknowledged suggestions: auto-expire after 7 days and removed from UI. If the underlying signal persists, the next batch run recreates the suggestion fresh.

## 11. Schema Addition: User Contact Field

Add optional phone number to users table (separate migration or bundled with 0019):

```sql
ALTER TABLE users ADD COLUMN phone TEXT;  -- optional, E.164 format
```

Accessible via `/settings` for all roles. Displayed in rep suggestions when a licensee's contact is relevant.
