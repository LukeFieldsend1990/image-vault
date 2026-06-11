# Image Vault — Security & Health Audit

**Date:** 2026-06-11
**Branch:** `claude/system-security-audit-5z6dj6`
**Scope:** Authentication & sessions, API access control / IDOR, AI pipeline, inbound
email/triage, workers, email templates, and general data-handling robustness.

## Methodology

Three parallel exploration passes swept the codebase (auth/crypto; API routes & IDOR;
AI/email/workers/skills). The highest-impact findings were then manually verified
against source. Two agent claims were over- or mis-stated and have been corrected here
(see **Corrections & caveats**).

Each finding carries a **Status**:
- **Confirmed** — read and verified directly in source for this audit.
- **Reported** — surfaced by the sweep, plausible, but not yet hand-verified. The next
  model should confirm the exploit/impact before investing in a fix.

This document is a worklist for a later model. Entries are independent; tackle them in
the **Suggested remediation order** at the bottom.

---

## Summary

| ID | Severity | Status | Location | Issue |
|----|----------|--------|----------|-------|
| AUTH-1 | High | Confirmed | server pages + `middleware.ts:137` | Server pages authorize off unverified `atob` JWT; matcher gaps |
| AUTH-2 | High | Confirmed | `lib/auth/requireAdmin.ts:10` | `requireAdmin()` never verifies JWT signature |
| API-1 | High | Confirmed | `app/api/ai/package-tags/[packageId]/route.ts` | IDOR: read/write tags on any package |
| API-2 | Medium | Confirmed | `app/api/inbound/emails/route.ts:31` | Loads entire triage table per request (perf/DoS) |
| EMAIL-1 | Critical | Reported | `lib/email/templates.ts` | Unescaped user input → HTML/XSS in emails |
| AI-1 | High | Reported | `lib/inbound/triage.ts:70` | Prompt-injection exposure in email triage |
| WEBHOOK-1 | High | Reported | `app/api/webhooks/resend/route.ts:80` | Webhook accepts unsigned requests when secret unset |
| API-3 | Medium | Reported | `app/api/pitch/webhook/route.ts:89` | Possible SSRF in video fetch |
| BRIDGE-1 | Medium | Reported | `.../project-grant/route.ts:149` | `fileScope` parse failure swallowed |
| AUTH-3 | Medium | Reported | `app/api/auth/refresh/route.ts` | No rate limit on refresh endpoint |
| AUTH-4 | Low/Med | Reported | `lib/auth/session.ts:28` | Cookie `Secure`/`SameSite` posture |
| AUTH-5 | Low | Confirmed | `lib/auth/jwt.ts:36` | JWT `algorithms` not pinned (not exploitable today) |
| AI-2 | Low/Med | Reported | `cost-tracker.ts:58`, `security-alerts.ts:212` | Budget parsing → NaN / no radix |
| AI-3 | Low | Reported | `lib/ai/suggestion-engine.ts:166` | Budget-check race across concurrent batches |
| WORKER-1 | Low | Reported | `pipeline-worker/src/index.ts:809` | AI enrichment failure not surfaced |
| DATA-1 | Low | Reported | `clone-packages/route.ts:38`, `audit/events/route.ts:55` | Unguarded `JSON.parse` on stored/KV data |
| DATA-2 | Low | Reported | `comms-worker/src/index.ts:267` | Hardcoded model pricing → unknown models cost $0 |
| DATA-3 | Low | Reported | package queries | Soft-delete (`deletedAt`) not universally filtered |

---

## Authentication & Sessions

### [AUTH-1] Server pages trust unverified JWT claims; middleware matcher has gaps
- **Severity:** High
- **Status:** Confirmed
- **Location:** `lib/auth/requireAdmin.ts:11`, `app/(vault)/royalties/page.tsx:12`,
  `app/(vault)/compliance/page.tsx:22`, `app/(vault)/layout.tsx:25`, plus ~14 more
  pages — find with `grep -rn 'atob(.*split' app lib middleware.ts` (18 files total).
- **Description:** The session JWT is decoded with
  `JSON.parse(atob(token.split(".")[1]))` — **no signature verification** — and the
  resulting `role`/`email`/`sub` drive authorization. `compliance/page.tsx:40` calls
  `isAdmin(email)` on the *unverified* email; `royalties/page.tsx` gates on the
  *unverified* role. `middleware.ts` itself is sound — it verifies signatures via
  `jwtVerify` (lines 22-31) and only reads the email for `/admin` after
  `status === "ok"`. The problem is the matcher (`middleware.ts:137-156`) does **not**
  cover `/royalties`, `/compliance`, `/vault/pipeline`, `/vault/packages`, `/bridge`.
  Those pages have no middleware signature check and authorize purely off the forgeable
  `atob` payload — a client can present an unsigned cookie with arbitrary
  `role`/`email`/`sub` and satisfy the server-side gating.
- **Impact:** Bypass of role/admin gating on the non-matched pages. Most sensitive data
  is re-fetched through `requireSession`-backed API routes (which *do* verify), so this
  is primarily a broken server-side authorization layer + any data rendered directly
  from the unverified identity. It is a fragile single-point defense (middleware) with
  holes.
- **Fix:** Replace every auth-relevant `atob` decode with `verifySessionJwt()`
  (`lib/auth/jwt.ts`). Make `requireAdmin()` verify the signature (see AUTH-2). Add the
  missing routes to the middleware matcher, and prefer verifying in the page/helper
  rather than relying on middleware as the sole verifier.
- **How to verify:** Mint a cookie with a fabricated payload and an invalid signature
  (e.g. `base64url({"role":"admin","email":"<admin>","sub":"x"})` with junk sig), then
  request `/compliance` and `/royalties`. They should redirect/deny but currently parse
  the payload. Confirm those paths are absent from the matcher list.

### [AUTH-2] `requireAdmin()` never verifies the JWT signature
- **Severity:** High
- **Status:** Confirmed
- **Location:** `lib/auth/requireAdmin.ts:10-20`.
- **Description:** Decodes the cookie with `atob` and checks
  `ADMIN_EMAILS.includes(email)` on an unverified payload. Today it's backstopped by
  middleware on `/admin`, but the helper is unsafe in isolation and would grant admin
  if ever called from a route the matcher doesn't cover.
- **Fix:** Use `jwtVerify` (or `verifySessionJwt`) with the configured
  issuer/audience before trusting `email`/`sub`.
- **How to verify:** Grep for `requireAdmin(` callers; confirm each is also matcher-
  protected. Replace with verified decode and confirm admin pages still load for a real
  admin session.

### [AUTH-3] No rate limit on `/api/auth/refresh`
- **Severity:** Medium
- **Status:** Reported
- **Location:** `app/api/auth/refresh/route.ts`.
- **Description:** The refresh endpoint has no rate limiting, unlike login. Allows rapid
  token-rotation / brute-force attempts against refresh tokens.
- **Fix:** Apply `checkRateLimit` + `getClientIp` (`lib/auth/rateLimit`) as login does
  (e.g. ~30/hour/IP), returning 429 with `Retry-After`.

### [AUTH-4] Cookie `Secure` / `SameSite` posture
- **Severity:** Low/Medium
- **Status:** Reported
- **Location:** `lib/auth/session.ts:28`.
- **Description:** `Secure` is gated on `NODE_ENV !== "development"`; `SameSite=Lax`.
  Consider `SameSite=Strict` for the session cookie and ensure `Secure` can't be
  dropped by a misconfigured production environment.
- **Fix:** Tie `Secure` to an explicit local-only flag; evaluate `Strict` for CSRF
  hardening (watch for cross-site navigation flows that legitimately need `Lax`).

### [AUTH-5] JWT algorithms not pinned
- **Severity:** Low
- **Status:** Confirmed
- **Location:** `lib/auth/jwt.ts:36`.
- **Description:** `jwtVerify` is called without `algorithms: ["HS256"]`. **Not
  exploitable today** — the key is a symmetric `Uint8Array`, so jose only accepts HMAC
  algorithms; classic RS256→HS256 alg-confusion does not apply. Pin the algorithm for
  defense in depth and to prevent regressions if key handling ever changes.
- **Fix:** Add `algorithms: ["HS256"]` to the `jwtVerify` options.

---

## API / Access Control

### [API-1] IDOR in package-tags route (read + write any package)
- **Severity:** High
- **Status:** Confirmed
- **Location:** `app/api/ai/package-tags/[packageId]/route.ts` — GET (12-29), POST
  (32-101).
- **Description:** Both handlers call only `requireSession()` (authentication) and key
  off the `packageId` path param with **no ownership/authorization check**. Any
  authenticated user can list tags on, and insert tags into, *any* package by guessing
  or enumerating package IDs.
- **Fix:** Load the package, confirm `talentId === session.sub` (or a valid
  rep-delegation / admin), return 403 otherwise — before both the read and the write.
  Mirror the ownership pattern in `app/api/vault/packages/[packageId]/route.ts`.
- **How to verify:** As user A, POST a tag to a package owned by user B; it currently
  succeeds (201). After the fix it should 403.

### [API-2] `inbound/emails` loads the entire triage table per request
- **Severity:** Medium
- **Status:** Confirmed
- **Location:** `app/api/inbound/emails/route.ts:31`.
- **Description:** `await db.select().from(aiTriageResults).all()` fetches *all* triage
  rows for *all* users, then filters in memory by the caller's `emailIds`.
  **This is not a data leak** — line 37 (`emailIds.includes(tr.emailId)`) ensures only
  the caller's own emails get triage attached before the response is built. The defect
  is performance/DoS: the full table is loaded into the worker on every request and
  grows unbounded.
- **Fix:** `where(inArray(aiTriageResults.emailId, emailIds))`, only querying when
  `emailIds.length > 0`. (Code already guards the `> 0` case for the variable but still
  selects all.)

### [API-3] Possible SSRF in pitch webhook video fetch
- **Severity:** Medium
- **Status:** Reported
- **Location:** `app/api/pitch/webhook/route.ts:89`.
- **Description:** The webhook is HMAC-signed (mitigating), but `videoUrl` from the
  payload is fetched with no origin allow-list and without disabling redirects. A
  compromised/misconfigured upstream could point this at internal services.
- **Fix:** Validate `new URL(videoUrl).origin` against an allow-list (e.g. the
  Higgsfield output origins) and use `fetch(videoUrl, { redirect: "error" })`.

### [BRIDGE-1] `fileScope` parse failure falls back silently
- **Severity:** Medium
- **Status:** Reported
- **Location:** `app/api/bridge/render-bridge/[agentId]/project-grant/route.ts:149-156`.
- **Description:** Malformed `fileScope` JSON is swallowed by try/catch; the scope set
  silently ends up empty/wrong, which can mis-scope a download grant.
- **Fix:** Parse, assert `Array.isArray`, and return a 400 on malformed `fileScope`
  rather than continuing with a degraded scope.

---

## AI / Email / Workers

### [EMAIL-1] Unescaped user input → HTML/XSS in email templates
- **Severity:** Critical (verify reachability)
- **Status:** Reported
- **Location:** `lib/email/templates.ts` — approx. `intendedUse` (~156, ~561, ~598),
  `reason` (~257, ~513), `message` (~311).
- **Description:** User-controlled fields are interpolated directly into HTML email
  bodies without escaping. If any of these originate from attacker-influenced input
  (e.g. a licence request's `intendedUse`/`reason`, an invite `message`), an attacker
  can inject HTML into emails sent to other parties.
- **Fix:** Add an `escapeHtml()` helper and apply to every interpolated user-supplied
  string in the templates.
- **How to verify:** Trace each field back to its caller; confirm whether the value is
  user-supplied and unsanitised. Send a test email with `"<img src=x onerror=...>"` in
  the field and inspect the rendered HTML.

### [AI-1] Prompt-injection exposure in email triage
- **Severity:** High
- **Status:** Reported
- **Location:** `lib/inbound/triage.ts:70-86` plus the triage system prompt.
- **Description:** Untrusted email `From`/`Subject`/recipients are concatenated into the
  LLM prompt. CLAUDE.md states the system prompt guards against injection; this needs
  hand-verification that the guard actually holds and that crafted email content cannot
  steer the classification/structuredData to trigger unintended skills downstream.
- **Fix:** Wrap untrusted fields in explicit delimiters, escape newlines, and keep the
  injection guard in the system prompt. Re-test with adversarial subjects/bodies.

### [WEBHOOK-1] Resend webhook accepts unsigned requests when secret unset
- **Severity:** High
- **Status:** Reported
- **Location:** `app/api/webhooks/resend/route.ts:80-91`.
- **Description:** Signature verification only runs `if (webhookSecret)`. If
  `RESEND_WEBHOOK_SECRET` is not configured, the handler skips verification and accepts
  any request claiming to be inbound email — a forged-email / spoofing vector.
- **Fix:** Reject (HTTP 500 on misconfig, or 401) when the secret is missing instead of
  bypassing verification. Make a configured secret mandatory in production.

### [AI-2] Budget/ceiling parsing robustness
- **Severity:** Low/Medium
- **Status:** Reported
- **Location:** `lib/ai/cost-tracker.ts:58`, `lib/ai/security-alerts.ts:212`.
- **Description:** `parseFloat(ceilingRow?.value ?? "1.00")` returns `NaN` for bad
  values, and `NaN >= x` is always false — so a corrupt ceiling silently disables the
  budget cap. `parseInt(... ?? "10")` lacks an explicit radix and range clamp.
- **Fix:** Validate parsed numbers (`Number.isFinite`), clamp to sane ranges, and fail
  safe to the conservative default.

### [AI-3] Budget-check race across concurrent batches
- **Severity:** Low
- **Status:** Reported
- **Location:** `lib/ai/suggestion-engine.ts:166-183`.
- **Description:** Budget is checked before and within the loop, but two concurrent
  batch runs can both pass the check and jointly exceed the rolling ceiling. No atomic
  guarantee.
- **Fix:** Document as a known limitation; a real fix needs an atomic reservation /
  single-flight guard around batch runs.

### [WORKER-1] AI enrichment failure not surfaced
- **Severity:** Low
- **Status:** Reported
- **Location:** `pipeline-worker/src/index.ts:809-821`.
- **Description:** Errors from the AI tagging service call are only logged; the pipeline
  stage still reports success, yielding packages with incomplete metadata.
- **Fix:** Decide intended semantics — either `await` and propagate failure into job
  status, or move to `ctx.waitUntil` with a recorded enrichment-pending state.

---

## Data-handling robustness

### [DATA-1] Unguarded `JSON.parse` on stored / KV data
- **Severity:** Low
- **Status:** Reported
- **Location:** `app/api/admin/clone-packages/route.ts:38`,
  `app/api/admin/audit/events/route.ts:55`, and similar call sites.
- **Description:** `JSON.parse` on KV / DB text without try/catch or shape validation;
  corrupt or tampered data throws and 500s the endpoint.
- **Fix:** Wrap in try/catch, validate the parsed shape, log and degrade gracefully.

### [DATA-2] Hardcoded model pricing assumptions
- **Severity:** Low
- **Status:** Reported
- **Location:** `comms-worker/src/index.ts:267-268`.
- **Description:** Cost is computed via `modelName.includes("haiku") ? ... : 0`. Any
  other/renamed model silently costs $0, corrupting budget accounting.
- **Fix:** Use a pricing map keyed by model id with a logged non-zero default.

### [DATA-3] Soft-delete not universally filtered
- **Severity:** Low
- **Status:** Reported
- **Description:** Soft deletes use `deletedAt`, but not every package query filters it.
  Some routes (e.g. `app/api/vault/packages/[packageId]/route.ts`) check it; others may
  return logically-deleted rows.
- **Fix:** Audit package queries and add `isNull(scanPackages.deletedAt)` where missing.

---

## Corrections & caveats (read before acting)

- **`inbound/emails` is not a cross-user data leak.** The sweep initially flagged it as
  a Critical data-exposure issue; the in-memory filter at line 37 prevents other users'
  triage data from reaching the response. Treat API-2 strictly as a performance/DoS fix.
- **Middleware signature verification is sound.** The auth weakness (AUTH-1) is the
  server-page `atob` pattern plus matcher gaps — not the middleware's own verification.
- **JWT alg-confusion is not exploitable here** (symmetric secret ⇒ jose accepts only
  HMAC). AUTH-5 stays Low (defense-in-depth pinning only).
- **Reported** items have not been hand-verified — confirm impact/reachability before
  building a fix, especially EMAIL-1 (depends on whether the fields are attacker-
  controlled) and AI-1 (depends on the current system-prompt guard).

## Suggested remediation order

1. **AUTH-1, AUTH-2** — verify all auth decodes and close matcher gaps (highest-
   confidence Highs, broad blast radius).
2. **API-1** — add ownership checks to package-tags (clear, contained fix).
3. **WEBHOOK-1, AI-1, EMAIL-1** — verify then fix (High/Critical but Reported; confirm
   reachability first).
4. **API-2, API-3, BRIDGE-1, AUTH-3** — Medium correctness/perf/SSRF fixes.
5. **AUTH-4, AUTH-5, AI-2/3, WORKER-1, DATA-1/2/3** — Low-severity hardening.
