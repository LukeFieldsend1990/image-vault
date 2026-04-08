# Image Vault — Agent Guide

Secure biometric likeness archive for actors. Talent stores scan packages, licenses access to production companies via dual-custody 2FA download. Zero-knowledge platform (client-side encryption).

## Commands

```bash
npm run dev              # local Next.js dev server
npm run pages:build      # Cloudflare Pages build
npm run preview          # build + wrangler pages dev (local Cloudflare preview)
npm run deploy           # build + wrangler pages deploy (production)
npm test                 # vitest run
npm run test:watch       # vitest watch mode
npm run lint             # eslint
npm run cf-typegen       # regenerate CloudflareEnv types from wrangler.toml
npm run deploy:worker    # deploy pipeline-worker
npm run deploy:ai-worker # deploy ai-worker
npm run deploy:ai-cron   # deploy ai-cron-worker
```

Type-check: `npx tsc --noEmit` — ignore errors in `.next/types/` (pre-existing Next.js async params issue) and `__tests__/` (known body-type issues).

## Architecture

- **Next.js 16** (App Router, TypeScript, Tailwind v4)
- **Cloudflare Pages** deployment via `@cloudflare/next-on-pages`
- **Edge runtime everywhere** — every API route and worker runs on Cloudflare edge. No Node.js APIs.
- **Cloudflare D1** (SQLite) — relational data via Drizzle ORM
- **Cloudflare R2** — scan file storage
- **Cloudflare KV** — sessions, download tokens, upload state
- **Cloudflare Queues** — async job processing (pipeline, inbound email)
- **Workers AI + Anthropic** — AI features with cost tracking and fallback

## Project Structure

```
app/
  (auth)/          # Unauthenticated pages: login, signup, onboarding, 2FA setup, password reset
  (vault)/         # Authenticated pages: dashboard, admin, inbox, licences, vault, roster, settings
    layout.tsx     # Sidebar shell, nav, user widget
  api/             # ~97 API routes grouped by domain (auth, licences, invites, vault, inbound, bridge, ai, admin, ...)
lib/
  auth/            # JWT, sessions, requireSession, requireAdmin, adminEmails, bridgeTokens, TOTP, rate limiting
  db/              # Drizzle ORM setup (index.ts: getDb, getKv), schema.ts (40+ tables)
  email/           # send.ts (Resend wrapper), templates.ts (HTML email builders)
  ai/              # providers.ts, cost-tracker.ts, constants.ts, signals.ts, suggestion-engine.ts, security-alerts.ts
  inbound/         # triage.ts (AI email classification), alias.ts (memorable aliases)
  skills/          # MCP-pattern skill system (see "Extending Skills" below)
  crypto/          # Encryption utilities
drizzle/
  migrations/      # Sequential SQL: 0000_auth.sql through 0030_soft_delete_packages.sql
pipeline-worker/   # Cloudflare Worker for scan processing (validate, classify, assemble, bundle)
ai-worker/         # AI processing worker (Anthropic integration)
ai-cron-worker/    # Scheduled AI batch processing (suggestions)
comms-worker/      # Communication worker (email intake → triage)
themes/            # Per-agency UI themes (CSS variables per subdomain)
```

## Key Patterns

### Every API route starts like this

```typescript
export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }  // params is a Promise in Next.js 15+
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;  // must await
  const db = getDb();
  // ... role checks, then query
}
```

- `requireSession()` returns `SessionPayload | NextResponse`. Always check `isErrorResponse()` first.
- `SessionPayload` has: `sub` (userId), `email`, `role` (talent | rep | licensee | admin)
- Admin checks: `isAdmin(session.email)` — hardcoded email whitelist in `lib/auth/adminEmails.ts`
- Bridge API routes use `requireBridgeToken()` instead of sessions

### Database

- Access: `const db = getDb()` (calls `getRequestContext()` internally for D1 binding)
- ORM: Drizzle with D1 SQLite adapter
- Schema: `lib/db/schema.ts` — all tables in one file
- Timestamps: **UNIX epoch seconds** (`Math.floor(Date.now() / 1000)`), not ISO strings
- Booleans: SQLite integers (0/1), Drizzle maps to JS boolean
- IDs: `crypto.randomUUID()` (UUIDv4 strings)
- JSON fields: stored as text columns (`structuredDataJson`, `riskFlagsJson`, `knownFor`), parsed/serialized manually
- Migrations: `drizzle/migrations/NNNN_description.sql`, sequential numbering. Apply with `wrangler d1 migrations apply`

### Email

- `sendEmail({ to, subject, html })` — fire-and-forget via `ctx.waitUntil()` on edge
- Templates in `lib/email/templates.ts` — each returns `{ subject: string; html: string }`
- Always check `RESEND_API_KEY` is set; graceful fallback to console.warn
- Email muting: `sendEmail` auto-filters recipients with `emailMuted` flag

### AI Infrastructure

- `callAi(env, db, options)` — orchestrator in `lib/ai/providers.ts`
- Providers: Anthropic Haiku (primary, $0.80/$4.00 per M tokens) → Workers AI Llama (free fallback)
- Cost tracking: `logAiCost()` logs every call; `checkBudget()` enforces $1.00 rolling 14-day ceiling
- Feature flags: `isAiEnabled(db, feature)` checks `aiSettings` table
- Always pass `requiresReasoning: true` for complex tasks (routes to Anthropic)

### UI Components

- **Server components** by default (async pages with `requireSession()` or `requireAdmin()`)
- **Client components** marked with `"use client"` for interactivity
- Pattern: `page.tsx` (server, auth check, data fetch) imports `*-client.tsx` (interactive UI)
- **Styling**: Tailwind classes for layout/spacing + inline `style` objects for dynamic/themed colors
- **CSS variables**: `--color-text`, `--color-muted`, `--color-bg`, `--color-surface`, `--color-border`, `--color-accent`
- **Design language**: United Agents aesthetic — minimal, black/white, red accent (#c0392b), typography-led, sans-serif
- **Section headers**: `text-xs font-medium tracking-widest uppercase` with `color: var(--color-muted)`
- **Cards**: `rounded p-4` with `border: 1px solid var(--color-border)` and `background: var(--color-surface)`

### Fire-and-Forget Async Work

```typescript
// Pattern for non-blocking async work in API routes on Cloudflare edge
void (async () => {
  // ... email sends, logging, etc.
})();
```

Or use `ctx.waitUntil()` from `getRequestContext()` to keep the worker alive.

## Roles & Permissions

| Role | Can do |
|------|--------|
| `talent` | Upload scans, approve/deny licences, invite reps + licensees, set vault lock |
| `rep` | View managed talent's licences, act on their behalf (delegation) |
| `licensee` | Request licences, initiate downloads |
| `admin` | Everything. Whitelist-only: `lib/auth/adminEmails.ts` (code commit to change) |

## Extending Skills

The skill system (`lib/skills/`) follows the MCP (Model Context Protocol) tool pattern. Each skill is a self-describing, typed tool that the email triage AI can suggest based on classification.

### Adding a new skill

**Step 1** — Create `lib/skills/definitions/my-skill.ts`:

```typescript
import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";

const skill: SkillDefinition = {
  id: "my-skill",
  name: "Human-Readable Name",
  description: "What this skill does",
  categories: ["licence_request", "onboarding"],  // triage categories that trigger this
  parameters: [
    { name: "param1", type: "string", description: "...", required: true },
    { name: "param2", type: "select", description: "...", required: false, options: ["a", "b"] },
  ],
  async execute(ctx, params) {
    const { session, db, env, emailId } = ctx;
    // ... do work using existing lib functions (sendEmail, db queries, etc.)
    return { success: true, message: "Done.", data: { /* optional structured result */ } };
  },
};

registerSkill(skill);
```

**Step 2** — Import it in `lib/skills/definitions/index.ts`:

```typescript
import "./my-skill";
```

**Step 3** — Add pre-fill logic in `lib/skills/resolver.ts` under the `switch (skill.id)` block:

```typescript
case "my-skill": {
  if (typeof structuredData.some_field === "string") {
    prefilled.param1 = structuredData.some_field;
  }
  break;
}
```

### Key interfaces

- `SkillDefinition` — id, name, description, categories, parameters, execute handler
- `SkillContext` — session (SessionPayload), db (Drizzle), env (Cloudflare bindings), emailId
- `SkillResult` — `{ success, message, data? }`
- `SkillParameter` — name, type (string | number | boolean | select), description, required, options?

### How it works

1. Triage classifies an email → category + structuredData
2. `GET /api/inbound/emails/:id/skills` calls `resolveSkills(category, structuredData)` to find matching skills
3. UI shows "Suggested Actions" panel with pre-filled parameter forms
4. User reviews/edits params and clicks "Run"
5. `POST /api/inbound/emails/:id/skills` calls `skill.execute(ctx, params)` and returns the result

### Triage categories that trigger skills

| Category | Suggested Skill |
|----------|----------------|
| `onboarding` | Send Signup Invite |
| `introduction` | Send Signup Invite |
| `licence_request` | Find Package & Start Licence |
| `clarification` | Find Licence Details |
| `billing` | Find Licence Details |

### Design principles

- Skills execute server-side with the user's session permissions — no privilege escalation
- Skill handlers call DB/email functions directly (not internal HTTP routes) to avoid cookie forwarding on edge
- Registry is in-memory (code-defined, not DB-backed) — type-safe, zero cold-start cost
- Skills are resolved at request time so new skills immediately work for already-triaged emails
- Parameter validation is manual (no Zod) — matches the rest of the codebase

## Environment & Secrets

- **Local dev**: `.dev.vars` file (gitignored) for secrets
- **Production**: `wrangler secret put SECRET_NAME`
- **Non-secret config**: `[vars]` section in `wrangler.toml`
- **Edge access**: `getRequestContext().env` — with fallback to `process.env` for local dev

Key secrets: `JWT_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `TMDB_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BRIDGE_SIGNING_KEY_JWK`, `ENCRYPTION_MASTER_KEY`, `RESEND_WEBHOOK_SECRET`

## Workers

| Worker | Queue | Purpose |
|--------|-------|---------|
| `pipeline-worker` | `pipeline-jobs` | Scan processing: validate → classify → assemble → bundle |
| `comms-worker` | `inbound-email` | Email intake → AI triage |
| `ai-cron-worker` | cron trigger | Batch rep suggestions |

## Inbound Email Triage

- `triageEmail(env, db, input)` in `lib/inbound/triage.ts`
- Categories: `licence_request | onboarding | document_submission | clarification | scheduling | billing | legal | complaint | introduction | spam | other`
- Extracts: `talent_name, production_name, company_name, licence_type, dates_mentioned, amounts_mentioned, action_items, people_mentioned`
- Risk flags: `prompt_injection | suspicious_sender | urgent_pressure | financial_request | legal_threat | pii_exposure`
- Email content is treated as **untrusted data** — system prompt explicitly guards against prompt injection
