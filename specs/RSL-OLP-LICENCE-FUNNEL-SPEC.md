# Spec — Funnelling OLP "permitted-with-terms" requests into Image Vault licences (Phase 2.5)

**Status:** proposed · all open decisions resolved (see Decisions §) · ready to build 2.5a · **Author:** Luke + Claude · **Date:** 2026-06-30
**Builds on:** `specs/RSL-CONSENT-REGISTRY-SPEC.md` (Phases 1–3, merged). This is the deferred **Phase 2.5** — turning a machine consent grant into a real, negotiable, billable licence.

---

## Assumptions locked (recommended defaults — confirm/override)

The interactive question tool dropped; these are the defaults the design assumes. Flag any to flip.

1. **Licensee identity** — auto-provision a **claimable, unverified licensee stub** (org + inert user) from the request's `client_id` + `contact_email`, deduped. No credential until verified + approved. Mirrors IV's existing production/company auto-creation (`resolveCompanyOrg`) and the performer claimable-stub pattern.
2. **Licence scope** — a **packageless, likeness-rights** licence (`packageId = null`); the delivered credential is a **metered royalty key** (`rsk_…`), not a file download.
3. **Pricing** — talent may set a **standing AI rate card**. Rate present + posture green + `auto_accept` → auto-approve; otherwise route to **human negotiation** via the existing requests flow, pre-filled from the rate card.
4. **Payment** — this spec covers **funnel → licence → credential → metered accrual** (`usageEvents` splits). **Payment *capture*** (charging the AI co) is a named follow-on (`RSL-BILLING-SETTLEMENT-SPEC`), because it needs a payments-provider decision and introduces post-paid credit risk.

---

## TL;DR

Today an **amber** OLP request mints a bare consent token — it attests *permission* but creates no `licences` row, sets no fee, and issues no billable credential. This spec makes the amber request **become a first-class Image Vault licence**, so the talent negotiates and approves it with the tools they already use, and the AI client walks away with a metered `rsk_` key that bills through `usageEvents`.

**One principle: don't build a parallel bespoke flow — route OLP into the existing `licences` pipeline.** The `rsl_license_requests.licence_id` join (already in the schema) is the seam.

```
AI → POST /olp/token (amber)
      │
      ├─ create licensee stub (dedup)         ← resolveCompanyOrg + inert user
      ├─ create PENDING licence (likeness)    ← minimum viable licences row
      └─ link rsl_license_requests.licence_id
                    │
     talent sees it in /vault/requests (native), prices it (or rate card auto-prices)
                    │
      AI polls → gets the offer → POST /olp/requests/:id/accept
                    │
     talent approves (or auto-approve) → agreedFee + 15% platform fee + royaltySource (rsk_ key)
                    │
      AI polls → collects rsk_ key ONCE → meters via POST /api/royalties/usage
                    │
             usageEvents accrue (talent/agency/platform split)
```

---

## What already exists (reuse verbatim — do NOT rebuild)

| Capability | Where | Note |
|---|---|---|
| Licence row + auto-created company/org | `POST /api/licences` · `lib/organisations/resolveCompany.ts#resolveCompanyOrg` | Auto-creates production company + org by name. Reuse for the licensee stub's org. |
| Min viable `licences` row | `lib/db/schema.ts` | Required (notNull, no default): `talentId, licenseeId, projectName, productionCompany, intendedUse, validFrom, validTo, createdAt`. `packageId` is **optional** → likeness licence is legal. |
| Approve → fee + royalty | `POST /api/licences/[id]/approve` | `agreedFee = proposedFee`; `platformFee = round(agreedFee × 0.15)`; if `agreedUnitType`+`agreedUnitRatePence` → creates `royaltySources` row + returns raw `rsk_` key **once**. |
| Royalty key | `lib/auth/requireRoyaltySource.ts#generateRoyaltyKey` (`rsk_`+64 hex) · `sha256Hex` | Stored hashed; verified per usage call. |
| Metering ingest | `POST /api/royalties/usage` (Bearer `rsk_`) | Body `{ externalRef, units, eventType?, occurredAt?, detail? }`; idempotent on `externalRef`. |
| Split math | `lib/royalties/split.ts#computeRoyalty` | `gross = units×rate`; talent/agency/platform per `talentSettings` (default **80/10/10**). |
| Negotiation | `licenceNegotiations` · `lib/consent/negotiation.ts` | `addNegotiationRound` (counter/accepted/declined), `latestTalentCounter`, `isThreadClosed`. |
| Requests UI | `/vault/requests` (`requests-client.tsx`, queries `?status=PENDING`) | A PENDING licence surfaces here natively. |
| OLP state + delivery | `rsl_license_requests`, `lib/rsl/olp.ts` (`storeDelivery`/`collectDelivery` KV one-time) | Extend the state machine + generalise delivery to carry the `rsk_` key. |

## What's missing (this spec)

- A **talent AI rate card** (per-usage unit price + optional upfront + auto-accept).
- **Licensee stub** provisioning + dedup for anonymous AI clients.
- **Amber → PENDING licence** creation at token time, linked to the OLP request.
- A **machine-side accept** endpoint so the AI can agree to terms across the API boundary.
- **Credential handoff**: deliver the `rsk_` royalty key (not just the consent token) via the OLP poll.
- **Consent-withdrawal cascade**: revoke/posture-red/vault-lock also revokes the `royaltySources` row so metering stops.
- A **required bot contact email** + claimable-stub email verification.
- An **admin control console** (`/admin/rsl`) over the whole rail — kill switches, clients, rate cards, usage caps, request overrides (§9).
- **Metered-dashboard labelling** so OLP earnings are distinguishable in `/royalties` — accrual, feed, and splits already flow through the existing rails (§10).

---

## Design

### 1. State machine (OLP request ↔ licence)

Extend `rsl_license_requests.status` to mirror the licence lifecycle:

```
pending_review  → offered → accepted → granted        (happy path)
     │              │          │
     └──────────────┴──────────┴────→ denied | expired
                                 (auto path: green + rate card auto_accept → straight to granted)
```

| OLP status | Licence status | Meaning |
|---|---|---|
| `pending_review` | *(none yet)* or `PENDING` | request lodged; talent to engage/price |
| `offered` | `PENDING` (+ proposedFee/unit rate) | terms on the table; awaiting AI acceptance |
| `accepted` | `PENDING` | AI accepted; awaiting talent approval |
| `granted` | `APPROVED` (+ `royaltySources`) | credential issued, deliverable once |
| `denied` | `DENIED`/`REVOKED` | refused or withdrawn |

### 2. Licensee identity — claimable stub

**A contact email is required.** The bot's request MUST carry a `contact_email` (self-declared, untrusted) on any amber/funnel path — it's how we reach the licensee's owner, send the claim/verify link, and give the talent/admin someone to contact. A request that reaches amber with no `contact_email` is rejected `400 invalid_request` ("a contact_email is required to license this likeness"). Red/denied requests never need one. The email is treated as **unverified** until the stub is claimed (email-verified) via the existing invite flow; the admin panel shows verified vs unverified plainly.

On the **first** amber request from a client (deduped by normalised `client_id`, else `contact_email`):

- **Org**: `resolveCompanyOrg(clientName)` → reuse/create an org tagged `orgType: "ai_licensee"` (new value; `orgType` is app-enum over a TEXT column — no DB migration).
- **User**: a stub `users` row, `role: "industry"`, `email: contact_email`, random un-loginable `passwordHash`, new nullable `unclaimedAt` set. Claim later via the existing invite/verify flow (email a claim link). Inert stubs have **metered-API access only** — never downloads/bridge.
- Persist the `client_id → licenseeId` mapping (a small `rsl_clients` table, or reuse the org + a lookup on `contact_email`) so repeat requests reuse the stub.

> Abuse control: stubs/licences are created **only on amber** (red is denied, unknown slug 404s), behind the existing per-IP rate limit + notification debounce, and **deduped** to one open licence per `(talentId, client, usage)`. See §Security.

### 3. Amber → PENDING licence (field mapping)

At `POST /api/rsl/olp/token` amber path, after the licensee stub, create the licence (reusing `POST /api/licences` internals, server-side):

| licences column | Value |
|---|---|
| `talentId` | from the slug's profile |
| `licenseeId` | the stub user |
| `projectName` | `client_name` ‖ `client_id` ‖ `"AI licence"` |
| `productionCompany` | `client_name` ‖ `client_id` |
| `intendedUse` | `intended_use` ‖ `"AI ${usage}"` |
| `validFrom` / `validTo` | `now` / `now + rateCard.termDays` (default 365) |
| `licenceType` | `ai-train → training_data`, `ai-use → ai_avatar` |
| `useCategoriesJson` / `permitAiTraining` | `[training]`/`[replica]` via `reconcileTrainingFlag` |
| `packageId` / `fileScope` | `null` / `"all"` (unused for metered) |
| `deliveryMode` | **`metered_api`** (new app-enum value; TEXT column, no migration) |
| `proposedUnitType` / `proposedUnitRatePence` | from rate card if present, else null (to negotiate) |
| `proposedFee` | rate card upfront fee if present |
| `source` | `"olp"` (new nullable column, for UI/filtering) |

Set `rsl_license_requests.licence_id` = the new id, status → `offered` (rate card present) or `pending_review` (talent must price).

### 4. Rate card + pricing

New table `rsl_rate_cards` — a talent's standing AI price list:

```ts
rsl_rate_cards(
  id, talentId, useCategoryId,           // training | replica
  unitType,                              // per_generation | per_1k_inferences | per_frame | per_second
  unitRatePence,
  upfrontFeePence,                       // nullable
  termDays default 365,
  autoAccept default 0,                  // green + this ⇒ auto-license, no human
  currency default 'USD',                // single platform currency (see note)
  active default 1,
  createdAt, updatedAt,
  UNIQUE(talentId, useCategoryId)
)
```

> **Money & currency.** The Image Vault currency is **USD — dollars + cents**, single-currency. All amounts stay **integer cents** (minor units); the existing `*Pence` column names (`unitRatePence`, `proposedFee`, …) are a **legacy misnomer — read them as "cents"**, and format for display as USD (`$1,234.56`). No DB rename in this spec; a follow-on can de-anglicise the naming. No multi-currency / FX.

Decision matrix (posture × rate card):

| Posture | Rate card | Outcome |
|---|---|---|
| red | — | `403 access_denied` (unchanged) |
| green | present + `autoAccept` | **auto-approve**: APPROVED licence + `royaltySources`, key delivered on next poll |
| green | present, no autoAccept | `offered` — AI accepts, talent one-click approves |
| green / amber | absent | `pending_review` — talent prices it in `/vault/requests` |
| amber | present | `offered` — pre-filled from rate card; talent still approves |

### 5. Machine-side accept

`POST /api/rsl/olp/requests/[id]/accept` — public, capability = the `request_id` (already documented as a bearer secret). Body optional `{ comment }` (counter-offers are a later add). Effect: record a `licenceNegotiations` round `party: "producer", action: "accepted"` for the licence, set OLP status `accepted`, notify talent/reps/admins "AI accepted — approve to issue credential". Poll reflects `accepted`.

The AI's loop: `token` (202 + offer) → `GET requests/:id` (poll offer) → `accept` → poll until `granted` → collect key.

### 6. Approval → credential handoff

Talent/rep/admin approves via the existing `/api/rsl/requests/[id]` (grant) which now **approves the linked licence** (reuses approve internals): sets `agreedFee`/`platformFee` and, from the agreed unit rate, creates the `royaltySources` row + raw `rsk_` key. That key is stored one-time in KV (`storeDelivery`, generalised to a JSON payload) and handed to the AI on its next `GET requests/:id` poll:

```json
{ "status":"granted", "license":"rsl_…", "royalty_key":"rsk_…",
  "usage_endpoint":"https://changling.io/api/royalties/usage",
  "unit_type":"per_generation", "unit_rate_pence":50, "expires_at":… }
```

The AI meters use with `Authorization: Bearer rsk_…` at `/api/royalties/usage` — unchanged, already live.

### 7. Consent-withdrawal cascade

Extend the withdrawal path (already honoured for tokens in `introspect`): when a talent unpublishes / posture→red / vault-locks / admin-revokes, also set the linked `royaltySources.status = "revoked"` so **metering stops immediately** (the usage endpoint already rejects revoked sources). Belt-and-braces with the introspect re-check.

### 8. Surfacing (talent/rep)

The PENDING licence appears in `/vault/requests` natively. Enhancement: when `source = "olp"`, badge it "AI licence · via RSL", show the **client identity + contact email** and that it's metered/likeness, and (if a rate card exists) a one-click **Approve at my rate**. The talent also sees the resulting earnings in their existing `/royalties` dashboard (§10).

### 9. Admin control surface (`/admin/rsl`)

Everything in this funnel is operable and overridable by an admin — `/admin/rsl` becomes the single console for the whole AI-licensing rail, extending the existing approve/deny panel. Admin (whitelist) can:

- **Global kill switch** — `rsl_settings.olp_enabled` and `auto_accept_enabled` (platform-wide). Off = the token endpoint stops issuing/creating; a hard stop independent of any talent setting.
- **OLP requests / licences** — list + filter (pending / offered / accepted / granted / denied) across all talent; **approve, deny, or override** any request; force-expire; re-issue or **revoke a credential** (flips `royaltySources.status='revoked'` → metering stops).
- **Rate cards** — view/edit **any** talent's `rsl_rate_cards`, and force `auto_accept` off per-talent or globally.
- **Licensee stubs** — list AI clients, see verified-vs-unverified + contact email, **verify/claim, suspend, or block** a client (blocked client → all future token calls denied); see every licence/source per client.
- **Usage caps** — set a per-source or per-client usage ceiling (the credit-risk stopgap, §Security).
- **Metered oversight** — an admin metered view (§10) of all OLP-originated sources: accrual, splits, top clients, anomalies.
- **Audit** — every admin action (approve/deny/revoke/verify/block/cap) is logged; reuses the existing admin-action audit pattern.

Implementation: expand `app/(vault)/admin/rsl/` with tabbed sections (Requests · Rate cards · Clients · Usage · Settings) over new admin APIs under `app/api/admin/rsl/*`. All gated by `isAdmin` (same whitelist as the rest of `/admin`).

### 10. Metered dashboard integration

Because the funnel issues real `royaltySources` rows, **OLP earnings flow into the existing metered dashboard automatically** — no parallel reporting. Specifically:

- **Talent** `/royalties` (`royalties-client.tsx` → `/api/royalties/summary`, `/feed`, `/sources`) already reads `royaltySources` + `usageEvents`; an OLP-originated source shows up there as soon as it's created. Enhancement: tag sources with `origin: "olp"` + the client name so the dashboard labels "AI licence (RSL)" rows and filters by them.
- **Live feed** — OLP metering events (`POST /api/royalties/usage`) already land in `/api/royalties/feed`, so the real-time meter reflects AI usage with no change.
- **Admin** — an admin metered view aggregates OLP sources platform-wide (total accrual, per-client, per-talent, platform-fee take), surfaced under `/admin/rsl` (§9) and/or the existing `/admin/financial`.
- **Splits** unchanged — `computeRoyalty` (80/10/10 default via `talentSettings`) applies identically to OLP usage.

The only new plumbing is the `origin`/`client` labelling so AI-sourced revenue is *distinguishable* in the dashboard — the accrual, feed, and splits are the same rails the metered dashboard already runs.

---

## Data-model changes (migrations `0092`+)

- **`rsl_rate_cards`** table (above) — migration `0092`.
- **`rsl_clients`** (or reuse orgs) mapping `client_id`/`contact_email → licenseeId` — migration `0093`.
- **`licences.source`** TEXT nullable (`"olp"`) — migration `0094` (additive).
- **`users.unclaimedAt`** INTEGER nullable — migration `0095` (additive).
- **`rsl_license_requests`**: add `accepted_at` INTEGER; extend `status` enum with `offered`, `accepted` (app-level; TEXT column) — migration `0096` for `accepted_at`.
- **`rsl_settings`** (singleton) — `olp_enabled`, `auto_accept_enabled` platform kill switches — migration `0097`.
- **`royaltySources`**: add `origin` TEXT nullable (`"olp"`) + `clientId` TEXT nullable (for dashboard labelling/filtering) + `usageCapUnits` INTEGER nullable (credit stopgap) — migration `0098` (additive).
- **licensee stub**: add `blockedAt` INTEGER nullable on the client/org (or `users`) so admin can hard-block a bot — migration `0099`.
- App-enum-only (no DB migration): `deliveryMode += "metered_api"`, `orgType += "ai_licensee"`.

## Endpoints (new / changed)

| Endpoint | Change |
|---|---|
| `POST /api/rsl/olp/token` | **requires `contact_email`** on amber (else `400`); provisions licensee stub + creates PENDING licence + links request; returns offer (rate card if present); auto-approves when green + autoAccept + platform kill-switch on. |
| `POST /api/rsl/olp/requests/[id]/accept` | **new** — AI accepts current terms. |
| `GET /api/rsl/olp/requests/[id]` | returns `offer` + status; delivers `royalty_key` (not just token) once on `granted`. |
| `POST /api/rsl/requests/[id]` (grant) | grant now **approves the linked licence** + issues royalty key. |
| `GET/PUT /api/rsl/rate-card` | **new** — talent (self/rep/admin) manages the rate card. |
| `GET/POST /api/admin/rsl/*` | **new** — admin console APIs: `settings` (kill switches), `clients` (verify/suspend/block), `rate-cards`, `usage` (caps + metered oversight), `requests` (override/revoke). All `isAdmin`. |
| `POST /api/royalties/usage` | unchanged (already the metering rail; honours `royaltySources.status` + usage cap). |

## Security & abuse

- **Consent still governs**: red denies; auto-approve only when the talent explicitly set `autoAccept` on a rate card **and** posture is green. Everything else needs a human approve.
- **Stub/licence spam** bounded by: amber-only creation, per-IP rate limit + notification debounce (already live), and hard dedup to one open licence per `(talentId, client, usage)`.
- **Inert licensee stubs** get **metered-API access only** — never downloads, bridge, or dual-custody file delivery.
- **Withdrawal cascades** to `royaltySources` (metering halts at once).
- **Credit risk (post-paid)**: without payment capture, a licensee could accrue unbounded `usageEvents`. Mitigations to design in the billing follow-on: prepaid balance / usage ceiling per source / periodic settlement. Until then, consider a **usage cap** per source as a stopgap.

## Out of scope (follow-on: `RSL-BILLING-SETTLEMENT-SPEC`)

Actual payment **capture** (invoice / prepaid / card), licensee **KYC/verification** hardening, counter-offers over the API, and OLP events into the hash-chained compliance ledger.

## Phasing

| Phase | Ships |
|---|---|
| **2.5a — Funnel** | rate card + licensee stub + amber→PENDING licence + surfacing in `/vault/requests`. Human prices/approves; key delivered. |
| **2.5b — Auto-license** | green + `autoAccept` fast path + machine `accept` endpoint + withdrawal→royalty revoke cascade. |
| **2.5c — Billing** | the settlement follow-on (payment capture, usage caps, KYC). |

## Decisions (resolved)

1. ✅ **Four core assumptions confirmed** — auto-provisioned claimable licensee stub · packageless likeness-metered licence · published-rate-instant-else-human pricing · funnel + metering in scope, payment capture deferred.
2. ✅ **Term** — 365 days per OLP licence, talent-overridable via the rate card; **expire-and-re-request** (no silent auto-renew, so consent is re-affirmed each term).
3. ✅ **Currency** — **USD, dollars + cents**, single-currency; amounts are integer cents (see "Money & currency" note); no multi-currency/FX.
4. ✅ **Usage-cap stopgap** — **yes**, a per-source usage ceiling (admin-settable, §9) to bound credit risk until payment capture ships.
5. ✅ **Stub claim email** — sent **only once a licence is approved** (no email on casual/unapproved requests).
