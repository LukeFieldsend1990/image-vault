# OpenNext Migration — Handoff

> **Status:** Repo-side migration **complete and pushed** on branch
> `claude/build-failures-e36e9a6-rze4ng` (commit `8ffdade`). Remaining work is
> **Cloudflare account-side only** (secrets, deploy, domain cutover) — see
> [Remaining steps](#remaining-steps-cloudflare-side).

---

## Why we're doing this

Production deploys to Cloudflare **Pages** (via `@cloudflare/next-on-pages`)
started failing with:

```
Generated Pages Functions bundle size (27010171) is over the limit of 25.0 MiB
Failed: generating Pages Functions failed.
```

`next-on-pages` emits **one edge function per route**, each carrying ~75–90 KiB
of Next.js runtime wrapper. At **288 routes** the bundle hit **~25.76 MiB**,
crossing the hard **25 MiB Pages Functions limit**. It first went over around
commit `e36e9a6` (added `/underwriting` + insurer routes) — a threshold crossed,
not a code bug. Every new route re-breaks it. The 25 MiB Pages limit is **not
raisable** (no plan/dashboard/Enterprise lever for Pages Functions), and
`next-on-pages` is **deprecated**.

## The fix

Migrate to **OpenNext** (`@opennextjs/cloudflare`), Cloudflare's recommended
adapter. It bundles the whole app into a **single Worker** instead of 288
functions.

- **Result:** the Worker deploys at **2.35 MiB gzipped** against the **10 MiB**
  Workers limit (the limit is on the *gzipped* size) — huge headroom vs. the
  25.76 MiB failure.
- Deployment target changes from **Pages → Workers** (with Static Assets).
- Still a fully edge-distributed app; it just leaves Next's restricted "edge
  runtime" for the **Node.js-compatible Workers runtime** (`nodejs_compat`).

## What did NOT change

- **No data/resource migration.** Same D1 database, both R2 buckets, KV
  namespace, all four Queues, Vectorize index, Workers AI, and the two service
  bindings (`image-vault-ai`, `image-vault-ai-cron`) — all re-bound by **the
  same IDs** from `wrangler.toml`.
- The **dedicated workers** (`pipeline-worker`, `comms-worker`, `ai-worker`,
  `ai-cron-worker`, `geo-fingerprint-worker`, `higgs-worker`) are independent
  and untouched.
- App logic / business behavior — nothing rewritten.

---

## What changed in the repo (already done on the branch)

| Area | Change |
|---|---|
| Adapter | Removed `@cloudflare/next-on-pages`; added `@opennextjs/cloudflare` (devDep) |
| `open-next.config.ts` | New — `defineCloudflareConfig()` (no ISR cache configured yet) |
| `wrangler.toml` | `pages_build_output_dir` → `main = ".open-next/worker.js"` + `[assets]`; **all bindings unchanged** |
| `next.config.ts` | `setupDevPlatform()` → `initOpenNextCloudflareForDev()`, **guarded to `NODE_ENV === "development"`** (must NOT run during `next build`) |
| Routes/pages (288) | Removed every `export const runtime = "edge";` |
| lib + app (57 files) | `getRequestContext()` (`@cloudflare/next-on-pages`) → `getCloudflareContext()` (`@opennextjs/cloudflare`) |
| `env.d.ts` | References `@cloudflare/workers-types` directly (was transitive via next-on-pages); added `PIPELINE_BUCKET`, queues, `AI_CRON_SERVICE` to `CloudflareEnv` |
| Tests (20 files) | Mocks updated: `@cloudflare/next-on-pages`→`@opennextjs/cloudflare`, `getRequestContext`→`getCloudflareContext` |
| `package.json` | Scripts: `cf:build` / `preview` / `deploy` now use `opennextjs-cloudflare` |
| `.gitignore` | Added `.open-next` |
| `CLAUDE.md` | Updated runtime model, commands, API-route pattern |

### Verified locally before handoff
- `npx opennextjs-cloudflare build` → **exit 0**
- `npx wrangler deploy --dry-run` → **Total Upload ~20 MiB / gzip 2.35 MiB**, all bindings attached
- `npx tsc --noEmit` → clean for `app/` + `lib/`
- `npm test` → **311 passing / 12 failing** — the 12 are **pre-existing** (mock-chain data assertions in `compliance-consent`, `compliance-attest-transfer`, `render-bridge-project-grant`; they also fail on the parent commit `c30adf6`). **No new regressions.**

---

## Remaining steps (Cloudflare-side)

Do these in order. **Production keeps serving from the existing Pages site the
whole time** — the domain cutover is last and reversible.

### 1. Pull & install
```bash
git checkout claude/build-failures-e36e9a6-rze4ng
git pull
npm ci
```

### 2. Put secrets on the new Worker
Secrets do **not** carry over from the Pages project. Copy the full list from
the Pages project dashboard. Known set referenced by the app:
```bash
wrangler secret put JWT_SECRET
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put RESEND_WEBHOOK_SECRET
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put TMDB_API_KEY
wrangler secret put ENCRYPTION_MASTER_KEY
wrangler secret put BRIDGE_SIGNING_KEY_JWK
# also any others on the Pages project, e.g. MESHY_API_KEY, FINGERPRINT_SIGNING_KEY,
# HIGGSFIELD_API_KEY, HIGGSFIELD_WEBHOOK_SECRET, TWILIO_* (if in use)
```

### 3. First deploy to the free `*.workers.dev` URL (does NOT touch changling.io)
```bash
npm run deploy
```
Prints `https://image-vault.<account>.workers.dev`.
⚠️ **Bindings point at PRODUCTION D1/R2/KV** (approved). Writes during testing
hit prod data — prefer reversible actions, or wire staging bindings first.

### 4. Test on the workers.dev URL
Exercise: login + 2FA, a dual-custody download, vault upload, inbox/triage,
admin console, MCP endpoint, bridge/webhook callbacks.

### 5. Cutover (reversible)
Dashboard → the Worker → **Custom Domains** → add `changling.io`.
**Rollback:** re-point `changling.io` to the Pages project (minutes).

### 6. After cutover
- Optional: set up **Workers Builds** (connect repo, build command `npm run deploy`)
  to restore git-push auto-deploy.
- Disconnect the old **Pages** project's git integration so it stops building.

---

## Known follow-ups (discuss, not blocking)
- **ISR/SSG caching** is unconfigured (fine — app is mostly dynamic SSR). To
  enable later, add an R2 incremental cache in `open-next.config.ts` (commented
  pointer is in the file). See https://opennext.js.org/cloudflare/caching
- **`next/image`** optimization may need a loader / `remotePatterns` config if
  used — verify post-cutover.

## Gotchas
- `initOpenNextCloudflareForDev()` must stay **dev-only guarded** — unguarded it
  attempts a remote binding session during `next build` and fails in CI.
- The Worker size limit is on the **gzipped** size (2.35 MiB ≪ 10 MiB), not the
  ~20 MiB uncompressed upload total.

## References
- Cloudflare blog: https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/
- Cloudflare docs: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- OpenNext docs: https://opennext.js.org/cloudflare
