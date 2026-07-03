# Domain migration: `changling.io` → `imagevault.ai`

Runbook for moving Image Vault from `changling.io` to the newly-purchased
`imagevault.ai` (registered through Cloudflare, so it already exists as a zone
with Cloudflare nameservers).

This document has three parts:

1. **What the branch already changed** (code + config) — no action needed beyond review + deploy.
2. **Cloudflare / DNS / Resend side** — the manual infra steps, organised by your 8 areas.
3. **Gaps** — everything on top of your list that also has to move, plus the ordered cutover + rollback.

> **Golden rule:** do **not** tear down `changling.io`. Keep its zone live and add a
> **301 redirect to `imagevault.ai` preserving the path** (see Gap G2). Emails already
> sent, published RSL feeds, installed bridge clients, and connected MCP clients all
> contain `changling.io` URLs and must keep resolving.

---

## Part 1 — What this branch (`domain-migration-imagevault-ai`) already changed

All code + config now defaults to `imagevault.ai`. Concretely:

| Area | Files |
|------|-------|
| Runtime base URL / from-email (the values that actually matter at runtime) | `wrangler.toml` + `comms-worker`, `pipeline-worker`, `ai-worker`, `ai-cron-worker`, `higgs-worker` `wrangler.toml` → `APP_URL`, `NEXT_PUBLIC_BASE_URL`, `RESEND_FROM_EMAIL` |
| **Inbound email domain** (aliases like `brave-falcon@…`) | `lib/inbound/alias.ts` → `INBOUND_DOMAIN = "imagevault.ai"` |
| Every `?? "https://changling.io"` fallback in ~50 API routes / libs / skills | `app/**`, `lib/**` |
| R2 CORS allowlist | `scripts/r2-cors.json` |
| RSL synthetic licensee email | `lib/rsl/licensee.ts` (`…@licensee.imagevault.ai`) |
| From-email default + display name | `lib/email/send.ts`, `lib/email/send-direct.ts` → `Image Vault <noreply@imagevault.ai>` |
| MCP connect string + semantic-layer copy | `app/api/mcp/route.ts`, `lib/mcp/semantic-layer.ts`, `CLAUDE.md` |
| Marketing links / browser-frame mockups | `app/(marketing)/**` |

**Deliberately NOT touched** (do separately if you want a full brand sweep):
`SPEC.md`, `specs/*.md`, `OPENNEXT-MIGRATION.md`, `CAS_BRIDGE_INTEGRATION.md`, and
`__tests__/**` still contain historical `changling.io` references. They are cosmetic /
illustrative and don't affect runtime. The `.claude/settings.local.json` references to a
local `changling-vault-bridge` path are your machine's bridge repo — unrelated.

> **Decision baked in:** the from-email display name was changed from **"Changling"** to
> **"Image Vault"**. If you want to keep the "Changling" brand name on the new domain,
> revert that half of the change (the address `noreply@imagevault.ai` stays either way).

Nothing here is host-validating: **JWT issuer/audience** (`image-vault` / `image-vault-app`)
and the **TOTP issuer** (`"Image Vault"`) are brand slugs, not domains — existing sessions'
tokens and existing authenticator-app 2FA enrolments keep working. Only cookies are affected
(see Gap G4).

---

## Part 2 — Cloudflare / DNS / Resend side, by your 8 areas

### 1. Site URL itself
The app is a single Worker named **`image-vault`** deployed via OpenNext (`npm run deploy`).
There are **no `routes`/`custom_domains` in wrangler.toml** — the custom domain is bound in the dashboard.

- Cloudflare dash → **Workers & Pages → `image-vault` → Settings → Domains & Routes → Add → Custom Domain → `imagevault.ai`** (and `www.imagevault.ai` if you want it). Cloudflare provisions the proxied DNS record + edge cert automatically.
- Deploy this branch so the Worker ships with the new `[vars]` (`APP_URL`, `NEXT_PUBLIC_BASE_URL`).
- The other 5 workers (comms/pipeline/ai/ai-cron/higgs) are **queue/cron consumers with no HTTP domain** — they only use `APP_URL` to *build* links, so they just need re-deploying with the new var (`npm run deploy:worker`, `deploy:ai-worker`, `deploy:ai-cron`, `deploy:higgs-worker`, and comms).
- **Secrets carry over** — `wrangler secret put …` values persist across deploys; you do **not** re-enter `JWT_SECRET`, `ANTHROPIC_API_KEY`, etc.

### 2. Email — send AND receive (Resend)
Both directions run through **Resend**, so the domain has to be verified there and DNS records added on the `imagevault.ai` zone.

**Send (outbound `noreply@imagevault.ai`):**
- Resend dashboard → **Domains → Add `imagevault.ai`** → add the **SPF (TXT), DKIM (CNAME/TXT), and DMARC (TXT)** records it generates into the Cloudflare DNS for the zone. Wait for "Verified".
- `RESEND_FROM_EMAIL` is already set to `Image Vault <noreply@imagevault.ai>` in every worker.
- New domains have zero sending reputation — expect a short deliverability warm-up (see Gap G10).

**Receive (inbound aliases `word-word@imagevault.ai` → triage):**
- The receive path is: Resend inbound → webhook `POST /api/webhooks/resend` (verifies svix sig, resolves alias by `@imagevault.ai` suffix, enqueues to `INBOUND_QUEUE`) → `comms-worker` fetches full email from Resend and triages. See `app/api/webhooks/resend/route.ts` + `comms-worker/src/index.ts`.
- Resend dashboard → enable **inbound/receiving** for `imagevault.ai` → add the **MX record(s)** Resend specifies on the zone (inbound and sending MX may differ — follow Resend's exact values).
- Point the **receiving webhook at `https://imagevault.ai/api/webhooks/resend`**.
- `RESEND_WEBHOOK_SECRET` is the **svix signing secret of that webhook**. If Resend issues a new secret for the new domain/webhook, `wrangler secret put RESEND_WEBHOOK_SECRET` (main worker). If you reuse the same webhook, it's unchanged.
- Existing aliases stored in D1 are just the local part (`brave-falcon`); they automatically become `@imagevault.ai` because `INBOUND_DOMAIN` changed. **But** anyone who already saved `brave-falcon@changling.io` will need the redirect/relay (Gap G2 doesn't help email — see note there).

### 3. Render bridge URL
- The render-bridge API (`app/api/bridge/render-bridge/*`, `app/api/bridge/packages/[id]/open`) lives **under the app domain**, so it moves automatically once the custom domain + deploy are live.
- Presigned R2 URLs it hands out use the **R2 S3 endpoint** `https://<accountId>.r2.cloudflarestorage.com/…`, **not** the site domain — they are unaffected by the migration (but see area 6 / Gap re CORS for browser-initiated ones).
- Grant manifests are signed with `BRIDGE_SIGNING_KEY_JWK` (domain-independent).
- **Action:** the **bridge desktop app** (separate repo `changling-vault-bridge`) has the vault URL configured client-side. Update its default to `https://imagevault.ai` and re-point/re-issue installed clients. Until then the 301 redirect keeps them working (see G5).

### 4. RSL functionality
- Public registry (`/c/<slug>`), OLP server (`/api/rsl/olp`), `license.xml`, and `/api/royalties/usage` all live under the app domain and move with it.
- RSL XML **embeds absolute URLs** built from `NEXT_PUBLIC_BASE_URL` (`lib/rsl/profile.ts`) — new feeds will publish `imagevault.ai` URLs once deployed.
- **Already-published RSL feeds / anything an external AI licensee cached** points at `changling.io`. The 301 redirect (G2) keeps those resolving; **re-publish / refresh** live feeds so the canonical identity is the new domain.
- Synthetic licensee email now `…@licensee.imagevault.ai` — affects only newly-created licensees.

### 5. MCP functionality
- Server is `/api/mcp` under the app domain — moves automatically.
- **Existing `mcp_` tokens keep working** (SHA-256 hashed in D1, host-independent). Admins just reconnect with the new URL:
  `claude mcp add --transport http image-vault https://imagevault.ai/api/mcp --header "Authorization: Bearer mcp_…"`
- The 301 redirect covers clients still pointed at the old URL until they reconnect.

### 6. CORS
- `scripts/r2-cors.json` now allows `https://imagevault.ai` + `https://*.imagevault.ai` (kept `http://localhost:3000`).
- **Apply it to the R2 bucket(s)** — browser direct-to-R2 **uploads** (`/api/vault/upload/presign`) and any browser-side presigned fetches break without it:
  ```bash
  wrangler r2 bucket cors put image-vault-scans --file scripts/r2-cors.json
  # repeat for the dev bucket if you use browser uploads in preview:
  wrangler r2 bucket cors put image-vault-scans-dev --file scripts/r2-cors.json
  ```
  (Or R2 dashboard → bucket → Settings → CORS Policy.) Consider **keeping the old origin in the allowlist during cutover** and removing it after.

### 7. Inbox triage
- No domain-critical logic of its own — it depends entirely on **area 2 (receive)** working. Once inbound MX + webhook + `INBOUND_DOMAIN` are aligned, triage runs unchanged.
- Note: the triage system prompt in `comms-worker/src/index.ts` still calls the platform **"Changling"** (brand copy, harmless). Update if you're doing a full brand rename.

### 8. Presigned download URLs
- Host is the **R2 account endpoint** (`<accountId>.r2.cloudflarestorage.com`), **not** the site domain → **URLs themselves are unaffected**. Download tokens (KV) and `R2_ACCESS_KEY_ID/SECRET` are domain-independent.
- The **only** migration action for this area is the **R2 CORS update** (area 6) for browser-initiated fetches. Server-streamed downloads (`/api/vault/files/[id]`) are unaffected.

---

## Part 3 — Gaps (beyond your list) + cutover + rollback

### Gaps found

- **G1 — Only the app Worker needs a custom domain.** The other 5 workers are queue/cron consumers; re-deploy them for the new `APP_URL` but they take no domain.
- **G2 — Keep `changling.io` + add a 301 redirect (critical).** In the `changling.io` zone add a **Redirect Rule / Bulk Redirect**: `changling.io/*` → `https://imagevault.ai/$1`, 301, preserve query string. This is what keeps **already-sent email links, published RSL feeds, connected MCP clients, and installed bridge apps** alive. ⚠️ Redirects only cover **HTTP**; they do **not** forward **inbound email** to `*@changling.io`. If people mail old aliases, keep `changling.io`'s inbound MX + Resend receiving active in parallel (the app matches both suffixes only if you also add `changling.io` back to `INBOUND_DOMAIN` as a secondary — currently single-value; see note below).
- **G3 — Resend DNS is the long pole.** SPF/DKIM/DMARC (send) **and** MX (receive) must all verify on `imagevault.ai` before email works either way. Do this first; DNS + verification can take time.
- **G4 — Users must re-login once.** Session cookies are host-only (no `Domain=` attribute set), so a domain switch invalidates them client-side. Expected and harmless; just communicate it. JWT/TOTP are unaffected (brand slugs).
- **G5 — Bridge desktop clients.** Separate `changling-vault-bridge` repo + already-installed `.app`s carry the vault URL. Update the default and reconfigure/re-issue; redirect covers the gap meanwhile.
- **G6 — Re-publish RSL / refresh external caches.** New canonical identity is `imagevault.ai`; bump/re-emit live feeds.
- **G7 — MCP reconnect.** Admins re-run `claude mcp add` with the new URL (tokens stay valid).
- **G8 — External agent integrations.** `specs/AGENT-INTEGRATION-SPEC.md` documents `IMAGE_VAULT_URL=https://changling.io` for third-party agents — notify integrators to update.
- **G9 — Outbound webhook callbacks that point back at us.** e.g. Higgsfield callbacks built from `APP_URL` resolve to the new domain after deploy, but any callback URL **already registered** with an external provider against `changling.io` relies on the redirect until re-registered.
- **G10 — Email reputation warm-up + DMARC alignment** on the fresh domain.
- **G11 — Tenant subdomains / demo.** `unitedagents.changling.io`, `demo.changling.io`, etc. (SPEC) move to `*.imagevault.ai`. Currently stubbed; handle when you activate multi-tenant themes.
- **G12 — SEO/`robots`/sitemap/Search Console.** No `metadataBase`/canonical is set today (nothing to change), but register the new domain in Search Console and submit the new sitemap; the 301 preserves ranking.
- **G13 — Local dev.** No `.dev.vars` present; if you add one, set `NEXT_PUBLIC_BASE_URL`/`RESEND_FROM_EMAIL` there too.
- **G14 — No change needed:** Twilio SMS 2FA (from-number only), R2 presign endpoint, TMDB (outbound), `wrangler secret` values.

> **Note on dual-domain inbound:** `INBOUND_DOMAIN` is a single string today. If you must
> accept mail at both `@changling.io` and `@imagevault.ai` during transition, change
> `lib/inbound/alias.ts` + `findAlias()` in `app/api/webhooks/resend/route.ts` to check a
> **list** of domains, and keep both zones' inbound MX + Resend receiving active.

### Ordered cutover runbook

1. **DNS first (Resend):** add `imagevault.ai` in Resend; add SPF/DKIM/DMARC (send) + MX (receive) records in the CF zone; wait for "Verified".
2. **R2 CORS:** `wrangler r2 bucket cors put …` (keep old origin listed during cutover).
3. **Deploy the branch:** merge → `npm run deploy` (app) + re-deploy all 5 workers. Ships new `[vars]`.
4. **Bind custom domain** `imagevault.ai` to the `image-vault` Worker; wait for cert.
5. **Resend webhook:** point receiving webhook at `https://imagevault.ai/api/webhooks/resend`; set `RESEND_WEBHOOK_SECRET` if it changed.
6. **Old-domain 301 redirect** on the `changling.io` zone (G2); keep old inbound MX live in parallel if needed.
7. **Reconnect/notify:** MCP admins (G7), bridge clients (G5), external agent integrators (G8); re-register any external callbacks (G9); re-publish RSL (G6).
8. **Search Console** new property + sitemap (G12).

### Verification checklist (post-cutover)

- [ ] `https://imagevault.ai` loads; login works (users re-auth once).
- [ ] Outbound email arrives from `noreply@imagevault.ai`, passes SPF/DKIM/DMARC.
- [ ] CC an alias `word-word@imagevault.ai` → email appears in inbox + triaged.
- [ ] Browser upload (presign → direct-to-R2 PUT) succeeds — confirms CORS.
- [ ] Dual-custody download completes; presigned GET streams.
- [ ] Render bridge grant + package open works.
- [ ] `/c/<slug>` + `/api/rsl/olp` return `imagevault.ai` URLs.
- [ ] `claude mcp add … https://imagevault.ai/api/mcp` connects with an existing token.
- [ ] `https://changling.io/<any-path>` 301s to `imagevault.ai/<same-path>`.

### Rollback

Fast: **remove the custom domain from the Worker and re-point `changling.io`** (or revert the branch's `[vars]` and re-deploy) — minutes, since the old zone is untouched. R2 CORS keeping both origins means no upload breakage during a rollback.
