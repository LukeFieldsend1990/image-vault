# Spec — RSL billing & settlement (making the money move)

**Status:** proposed · **Author:** Luke + Claude · **Date:** 2026-07-01
**Builds on:** `specs/RSL-OLP-LICENCE-FUNNEL-SPEC.md` (Phase 2.5, merged). That phase makes AI use *metered* — every generation writes a `usageEvents` row with talent/agency/platform splits — but no money actually moves. This spec is the deferred **2.5c**: charge the AI client, hold the platform cut, and pay out the talent (and agency).

---

## Decisions (recommended defaults — locked unless flagged)

1. **Provider — Stripe.** Stripe *Payments/Checkout* to charge licensees; Stripe *Connect (Express)* to pay out talent/agencies. Standard marketplace stack; Stripe carries PCI + payout KYC so we never touch card data.
2. **Model — prepaid by default, postpaid on verification.** An anonymous AI client (unverified `rsl_clients` stub) can only run on a **prepaid balance**: they top up, usage draws it down, metering pauses at zero. A **verified** client can be switched to **postpaid** (monthly invoice, card/ACH on file). Protects us from non-payment by unknown bots while keeping friction low for real partners.
3. **Currency — USD, cents.** Matches the platform. Single currency (Stripe handles the client's card FX).
4. **Payouts — monthly, threshold-gated, Connect Express.** Accrued `talentPence`/`agencyPence` pay out monthly once above a minimum (e.g. $20), after the platform holds its `platformPence` + upfront `platformFee`.
5. **Scope — this spec covers charge-in + hold + payout-out + statements.** Tax handling (1099/VAT), disputes/chargeback automation, and multi-currency are follow-ons.

---

## TL;DR

The splits are already computed and recorded on every `usageEvents` row (`grossPence`, `talentPence`, `agencyPence`, `platformPence`, default 80/10/10). What's missing is the two ends:

```
                       ┌─── charge-in ───┐        ┌─── payout-out ───┐
 AI client  ──Stripe──▶│ licensee_account │──────▶│  platform holds  │
 (card/ACH)   Payments │  balance (cents) │ split │  its cut         │
                       └────────┬─────────┘        ├── talent  ──────▶│ Stripe
   /api/royalties/usage ────────┘  draws down       ├── agency  ──────▶│ Connect
   (usageEvents already split)                      └──────────────────┘ (Express)
```

**Nothing about metering changes** — we add a *balance gate* in front of it (prepaid can't over-spend) and a *ledger + payout* behind it. Reuse `usageEvents` as the source of truth; never re-derive splits.

---

## What already exists (reuse)

| Piece | Where | Note |
|---|---|---|
| Per-event splits | `usageEvents` (`grossPence/talentPence/agencyPence/platformPence`) · `lib/royalties/split.ts` | The canonical amounts. Billing **sums** these; it never recomputes. |
| Split percentages | `talentSettings` (talent/agency/platform %), default 80/10/10 | Already applied at event time and snapshotted per row. |
| Upfront fee + platform cut | `licences.agreedFee` / `platformFee` (15%) | One-off charge at licence approval. |
| Metered source + key | `royaltySources` (`rsk_`), `usage_cap_units` | The credit ceiling gate hooks alongside the new balance gate. |
| AI client identity | `rsl_clients` (verified, blocked, contactEmail) | The billing customer. Verified ⇒ eligible for postpaid. |
| Metering ingest | `POST /api/royalties/usage` | Add a balance check here (prepaid) — the only change to the hot path. |
| Royalties dashboard | `/royalties` + `/api/royalties/summary`/`feed` | Extend with "paid vs accrued vs pending payout". |

## What's missing (this spec)

- A **licensee account** with a prepaid balance (+ optional postpaid terms).
- **Charge-in**: Stripe Checkout/PaymentIntent to top up (prepaid) or a saved payment method billed monthly (postpaid).
- A **balance gate** in metering so prepaid usage can't exceed funds.
- A **ledger** (double-entry-ish) tying charges, usage draw-downs, platform holds, and payouts together.
- **Payout accounts** (Connect Express) for talent/agencies + a **monthly settlement** job.
- **Statements/invoices** for licensees and payout reports for talent.
- **Webhooks** (Stripe → us) with signature verification + idempotency.
- **Admin billing console** (balances, holds, refunds, payout status).

---

## Design

### 1. Accounts & ledger (data model)

```ts
// One billing account per AI licensee client.
licensee_accounts(
  id, clientId → rsl_clients.id (unique),
  mode: 'prepaid' | 'postpaid' default 'prepaid',
  balanceCents integer default 0,          // prepaid float
  stripeCustomerId, defaultPaymentMethodId, // postpaid
  autoTopUpCents, autoTopUpThresholdCents,  // optional auto-refill
  status: 'active' | 'suspended',
  createdAt, updatedAt
)

// Connect payout target for a talent or agency.
payout_accounts(
  id, ownerType: 'talent' | 'agency', ownerId → users.id / organisations.id,
  stripeConnectId, chargesEnabled bool, payoutsEnabled bool,  // from Connect onboarding
  status, createdAt, updatedAt
)

// Append-only money ledger. Every cent that moves is a row.
billing_ledger(
  id, ts,
  kind: 'topup' | 'usage_debit' | 'platform_hold' | 'talent_accrual'
      | 'agency_accrual' | 'payout' | 'refund' | 'adjustment',
  accountId → licensee_accounts.id (nullable for payouts),
  payoutAccountId → payout_accounts.id (nullable),
  usageEventId → usage_events.id (nullable, links a debit to its event),
  licenceId, talentId,
  amountCents integer,          // signed; + into balance/accrual, − out
  currency default 'USD',
  stripeRef,                    // PaymentIntent / Transfer / Payout id
  detailJson,
)

// Periodic settlement runs (monthly), for statements + idempotency.
settlement_runs(
  id, periodStart, periodEnd, status: 'open'|'processing'|'complete'|'error',
  createdAt, completedAt
)
```

Invariant: for any period, `Σ topups = Σ usage_debits(+refunds) `, and `Σ usage_debit = Σ (platform_hold + talent_accrual + agency_accrual)` per event. The ledger is the audit trail; balances are a materialised convenience recomputable from it.

### 2. Charge-in (licensee pays)

- **Prepaid top-up** — `POST /api/billing/topup` → Stripe **Checkout Session** (hosted, PCI-safe) for a chosen amount; on `checkout.session.completed` webhook we `topup` the ledger + bump `balanceCents`. Optional **auto-top-up**: when a usage debit drops the balance below `autoTopUpThreshold`, charge the saved method for `autoTopUp`.
- **Postpaid** (verified clients only) — save a payment method; a monthly job bills the period's `usage_debit` sum via a `PaymentIntent`. On failure → dunning → suspend (`status='suspended'` blocks the balance gate).
- Everything is Stripe-hosted / off-session; we store only `stripeCustomerId` / `paymentMethodId` refs.

### 3. Balance gate (the one hot-path change)

In `POST /api/royalties/usage`, after the existing `usage_cap_units` check and before writing the event, for OLP sources whose account is **prepaid**:

```
cost = units × unitRatePence
if account.mode == 'prepaid' && account.balanceCents < cost → 402 { error:'insufficient_balance', balanceCents }
```

On success, in the same transaction as the `usageEvents` insert: `balanceCents -= cost` and append a `usage_debit` (−cost) + `platform_hold`/`talent_accrual`/`agency_accrual` rows mirroring the event's splits. Postpaid skips the balance check (accrues to the monthly invoice). This makes the prepaid float **self-limiting** — a bot can never run up an unpayable tab (superseding the interim `usage_cap_units` stopgap, which stays as a belt-and-braces ceiling).

### 4. Payout-out (talent/agency gets paid)

- **Onboarding** — talent/agency links a Stripe **Connect Express** account (`/settings` → "Get paid" → Stripe hosted onboarding). `payout_accounts.payoutsEnabled` tracks readiness.
- **Monthly settlement** (`settlement_runs`, a cron worker): for the period, sum `talent_accrual` per talent and `agency_accrual` per agency from the ledger; if ≥ threshold and `payoutsEnabled`, create a Stripe **Transfer** (from platform balance to the Connect account) + append a `payout` row. Below threshold → rolls into next period. Platform keeps `platform_hold`.
- Uses Stripe **Connect** so payouts carry their own KYC/tax handling; we never hold client funds beyond the float.

### 5. Statements & dashboard

- **Licensee** — `GET /api/billing/statement` (per period): top-ups, usage by licence/talent, current balance. Emailed monthly to `rsl_clients.contactEmail`.
- **Talent** — extend `/royalties`: "Accrued (this period)", "Paid out", "Pending payout", "Connect status". Reads the ledger, not a recompute.
- **Admin** — a billing console (below).

### 6. Admin billing console (`/admin/rsl` → Billing tab)

Admins can: view every licensee balance + ledger; **manual top-up / adjustment / refund**; **suspend/hold** an account (blocks the gate); force or retry a **payout**; see platform take per period; export the ledger. All actions append `adjustment`/`refund` ledger rows and are audited. Ties into the existing kill switches (§ funnel spec).

### 7. Unclaimed stub handling

An unverified `rsl_clients` stub is **prepaid-only** and **cannot receive a payout** (it's a payer, not a payee). It must top up before any metering succeeds (balance gate). Verification (admin, § funnel spec) unlocks postpaid eligibility. This closes the credit-risk hole the funnel spec flagged: **no money is owed that wasn't prepaid**, until a client is known and explicitly put on postpaid terms.

## Security & correctness

- **Stripe webhooks** verified via signing secret (`STRIPE_WEBHOOK_SECRET`); every handler **idempotent** on the Stripe event id (dedup table or ledger `stripeRef` unique).
- **No card data on our servers** — Checkout/Connect are Stripe-hosted; we store only customer/method/account refs.
- **Money math in integer cents**, single-writer transactions for balance + ledger; balance is always reconcilable from the ledger (a nightly check flags drift).
- **Idempotent metering** already (usageEvents `externalRef`); the debit reuses the same guard so a replayed generation never double-charges.
- **Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_*` via `wrangler secret put`.

## Endpoints (new)

| Endpoint | Purpose |
|---|---|
| `POST /api/billing/topup` | Prepaid top-up → Stripe Checkout session |
| `POST /api/billing/method` | Save a payment method (postpaid) |
| `GET /api/billing/account` | Licensee balance + mode (authed via `rsk_` or claimed login) |
| `GET /api/billing/statement` | Period statement |
| `POST /api/billing/webhook` | Stripe webhook sink (signature-verified) |
| `POST /api/payouts/connect` | Start talent/agency Connect onboarding |
| `GET /api/payouts/status` | Connect readiness + pending/paid |
| `POST /api/admin/billing/*` | Admin: adjust, refund, suspend, force payout, export |
| cron `settlement-worker` | Monthly accrual → Transfers |

## Phasing

| Phase | Ships | Value |
|---|---|---|
| **A — Charge-in (prepaid)** | `licensee_accounts` + ledger + top-up Checkout + balance gate | Money actually comes in; bots can't over-spend. Metering becomes truly payable. |
| **B — Payout-out** | `payout_accounts` Connect onboarding + monthly settlement + talent dashboard | Talent gets paid; platform take realised. |
| **C — Postpaid + statements** | verified-client postpaid invoicing, dunning, statements, admin billing console | Frictionless for real partners; full ops. |

Ship A first — it's the piece that turns "metered" into "paid", and it's self-protecting.

## Open questions

1. **Stripe confirmed** as the provider (vs Paddle/adyen)? Recommend Stripe.
2. **Payout threshold + cadence** — $20 monthly default OK?
3. **Platform economics** — the 80/10/10 usage split + 15% upfront: is the *platform's* slice of usage the fixed `platformSharePct`, or should OLP-sourced usage carry a different platform rate?
4. **Who owns tax** — do we issue 1099s/handle VAT (needs Stripe Tax), or is that out of scope for v1?
5. **Free tier** — should a talent be able to license AI use for **$0** (green, rate 0) and skip billing entirely, or is every OLP licence chargeable?
