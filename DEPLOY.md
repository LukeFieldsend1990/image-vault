# Deploy Runbook

How to ship the app + its satellite Workers to Cloudflare, and the manual steps
that don't happen automatically on deploy.

> **Context (July 2026):** the codebase was migrated from `changling.io` to
> `imagevault.ai` (sender, app URLs, inbound alias domain, R2 CORS). These
> changes are merged to `main` but **only take effect once the Workers are
> redeployed and the R2 CORS step below is applied.**

## Prerequisites

- Node + repo deps: `npm ci`
- Authenticated Wrangler. Either `wrangler login`, or export a scoped token:
  ```bash
  export CLOUDFLARE_API_TOKEN=<token>
  export CLOUDFLARE_ACCOUNT_ID=2db6ad770fad71b79fa3249b202c6c37
  ```
- Start from the latest `main`:
  ```bash
  git checkout main && git pull
  npm ci
  ```

### Token permissions (custom API token, scoped to this account)

All **Edit** unless noted:

| Permission | Why |
|---|---|
| Account · Workers Scripts — Edit | deploy scripts + upload OpenNext assets |
| Account · Workers KV Storage — Edit | KV bindings (sessions, tokens) |
| Account · Workers R2 Storage — Edit | R2 bindings **and the `cors set` step** |
| Account · D1 — Edit | D1 binding / migrations |
| Account · Queues — Edit | pipeline / inbound queue bindings |
| Account · Vectorize — Edit | `package-search` binding |
| Account · Workers AI — Read | `[ai]` binding |
| Account · Account Settings — Read | resolve the account |

The built-in **"Edit Cloudflare Workers"** template covers Scripts + KV + R2 but
predates D1/Queues/Vectorize — use a **custom token** with the rows above to
avoid a permission error mid-deploy.

## 1. Deploy the Workers

Run from the repo root. The main app is an OpenNext build (slowest); the rest are
plain Wrangler Workers.

```bash
npm run deploy                     # main app (imagevault.ai) — OpenNext build + deploy
npm run deploy:comms-worker        # inbound email → triage (+ contact forward path)
npm run deploy:ai-worker           # AI processing
npm run deploy:ai-cron             # scheduled AI batch
npm run deploy:worker              # pipeline-worker (scan processing)
npm run deploy:higgs-worker        # pitch vignette generation
npm run deploy:geo-fingerprint-worker   # only if this worker is active
```

All read `RESEND_FROM_EMAIL`, `APP_URL`, and (main app) `NEXT_PUBLIC_BASE_URL`
from their `wrangler.toml` `[vars]` — already set to `imagevault.ai`, so no
secrets change is required for the migration. Existing secrets
(`RESEND_API_KEY`, `JWT_SECRET`, etc.) are untouched.

## 2. Apply R2 CORS (NOT automatic on deploy)

Browser uploads presign directly to the `image-vault-scans` bucket. The allowed
origins moved to `imagevault.ai` in `scripts/r2-cors.json`; apply it or uploads
from the new origin are CORS-blocked:

```bash
wrangler r2 bucket cors set image-vault-scans --file scripts/r2-cors.json
# verify:
wrangler r2 bucket cors list image-vault-scans
```

(Only the scans bucket needs CORS — `image-vault-pipeline` is worker-internal.)

## 3. Verify

- [ ] **Custom domain:** `imagevault.ai` is a Custom Domain on the `image-vault`
      Worker (Dashboard → Workers → image-vault → Settings → Domains). It already
      resolves — the Resend webhook hits `https://imagevault.ai/api/webhooks/resend`.
- [ ] **Sending:** trigger any transactional email (e.g. submit `/contact`).
      In Resend → **Emails**, confirm a delivered send from
      `noreply@imagevault.ai` (no 403).
- [ ] **Inbound + contact forward:** email `contact@imagevault.ai`. It should land
      in `lukefieldsend@googlemail.com` and `Martin.davison@gmail.com`, and the
      Resend webhook event shows `{"ok":true,"routed":true,"forwarded":"contact"}`.
- [ ] **Inbound aliases:** aliases now generate as `name@imagevault.ai`
      (`INBOUND_DOMAIN`). Send a test to an existing alias and confirm it triages.
      Old `name@changling.io` aliases are dead (domain removed from Resend).
- [ ] **Uploads:** upload a scan from the app on `imagevault.ai` — no CORS error
      in the browser console (confirms step 2).

## Notes

- `changling.io` is being decommissioned (removed from Resend — can no longer
  send or receive). The only intentional `changling.io` references left in code
  are two comments in `lib/email/send.ts` and `lib/inbound/contact-forward.ts`
  noting it is **not** a verified sender, plus historical docs and the
  `changling-vault-bridge` repo name.
- No D1 migration is required for this change.
