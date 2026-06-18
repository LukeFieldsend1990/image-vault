# Image Vault — Insurer Oversight Spec

> **Phase 8 (Planned): Insurer-facing oversight — give insurance companies per-production, read-only, court-grade visibility into likeness consent and custody, so they can underwrite and defend claims on productions hosted in Image Vault.**

---

## 1. Overview

Insurers underwrite the exact risk Image Vault controls. A performer's biometric likeness, licensed to a production, creates three insurable exposures:

| Policy line | Risk insured | Evidence Image Vault already holds |
|---|---|---|
| **E&O (Errors & Omissions)** | Likeness/rights claims — "you used my face without proper consent" | Tamper-evident consent chain per performer, per licence (`complianceEvents`) |
| **Cyber / privacy** | Biometric breach → BIPA statutory damages ($1k–5k *per* violation) | Custody attestations, access logs, Bridge tamper detection (`bridgeEvents`) |
| **Completion bond / production** | Reshoots and legal delay from clearance gaps | Per-production coverage-gap + use-before-consent risk score (`lib/compliance/scorecard.ts`) |

The pitch to the insurer: **continuous, court-grade evidence lowers their loss ratio and sharpens pricing.** That converts into a recurring oversight seat plus a wedge into the production's whole insurance stack.

The access rail is **already built**. `insurer` is a first-class compliance subtype ([`drizzle/migrations/0059_compliance_role.sql`](../drizzle/migrations/0059_compliance_role.sql)) and `complianceGrants` already supports `scope = "production"` ([`lib/db/schema.ts`](../lib/db/schema.ts)). Today an insurer with a grant sees the same generic read-only evidence view as a union or regulator. This spec adds **insurer-tailored surfaces** and the **producer-driven, per-production grant flow** insurance actually requires.

---

## 2. Core principle — insurance is bound *per production*

Unlike a union or regulator (which legitimately want org-wide or platform-wide oversight of an entire guild), an insurer's visibility is bound to the specific productions they cover. **An insurer on Production A must never see Production B.**

This drives two hard rules:

1. **Insurer grants are production-scoped only.** Grant creation must reject `subtype="insurer"` with `scope` of `platform` or `organisation`. The only valid scopes for an insurer are `production` (primary) and `talent` (rare, for a single-performer policy). Enforced server-side at grant creation, not just in the UI.
2. **The producer adds the insurer, not the platform admin.** Today grants are minted admin-only at `/admin/compliance-access`. Insurance is bound by the production company, so the production coordinator (industry/producer role) must be able to add their insurer to their own production — invite-by-email, mirroring cast onboarding.

Everything else (read-only, no data-plane access, revocable, immutable evidence ledger) is inherited unchanged from the existing compliance role.

---

## 3. Data model changes

### 3.1 Reused as-is (no change)

- `complianceGrants` — `subtype="insurer"`, `scope="production"`, `scopeId=<productionId>`. Already exists.
- `complianceEvents` — immutable, hash-chained consent/custody/use ledger. The evidence source.
- `bridgeEvents` — device lifecycle + tamper alerts. The cyber-risk source.
- `productions`, `productionCast`, `licences` — per-production aggregation roots.
- `lib/compliance/scorecard.ts`, `productions.ts`, `dashboard.ts`, `grants.ts` — scoring + scope checks.

### 3.2 New table — `insurer_policies`

Records the policy an insurer holds against a production. This is the only genuinely new schema, and it unlocks the highest-value flags (lapsed-policy / uninsured-use).

```sql
-- drizzle/migrations/0066_insurer_policies.sql
CREATE TABLE insurer_policies (
  id              TEXT    PRIMARY KEY,
  grant_id        TEXT    NOT NULL REFERENCES compliance_grants(id), -- the insurer's production-scoped grant
  production_id   TEXT    NOT NULL REFERENCES productions(id),
  policy_number   TEXT,                          -- insurer's own reference
  policy_line     TEXT    NOT NULL,              -- eo | cyber | completion_bond | other
  coverage_limit  INTEGER,                       -- whole currency units (e.g. USD), nullable
  currency        TEXT    DEFAULT 'USD',
  effective_from  INTEGER,                        -- unix seconds, nullable
  effective_to    INTEGER,                        -- unix seconds, nullable
  notes           TEXT,
  created_by      TEXT    NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER                         -- soft delete
);

CREATE INDEX idx_insurer_policies_production ON insurer_policies (production_id);
CREATE INDEX idx_insurer_policies_grant      ON insurer_policies (grant_id);
```

Both the insurer (their own policy metadata) and the producer (to record who covers them) can create rows; writes gated by grant ownership or production coordination.

---

## 4. Features

Build cost is relative to the existing compliance surfaces. Most of this is repackaging.

### 4.1 Producer-adds-insurer grant flow — *new, required first*

- New section on the production detail page (industry/coordinator view): **"Insurers"** — list current insurer grants for this production, "Add insurer" by email.
- `POST /api/productions/:id/insurers` → creates a `complianceGrant` with `subtype="insurer"`, `scope="production"`, `scopeId=:id`, `grantedBy=<coordinator>`. If the email has no account, send an insurer signup invite (reuse invite plumbing; `org_subtype` / role pre-set to compliance/insurer).
- `DELETE /api/productions/:id/insurers/:grantId` → revoke (sets `revoked_at`), mirroring policy end.
- **Hard guard:** server rejects any attempt to create an `insurer` grant with scope ≠ `production`/`talent`, regardless of caller (admin included).

### 4.2 Per-production underwriting dashboard — *light*

The insurer's primary screen for one production. Reuses `scorecard.ts` + `productions.ts`; reframes the existing 0–100 compliance health as an **underwriting grade (A/B/C)**:

- Cast onboarding % (consented / linked / invited / placeholder / declined).
- Coverage gaps — live licences with no recorded 39.B consent.
- Use-before-consent violations (`lib/compliance/violations.ts`).
- Active strikes.
- Policy panel (from `insurer_policies`): line, limit, effective window, and a **lapsed/uninsured** flag if usage exists outside the policy window.

### 4.3 Claims evidence pack — *light–medium, the differentiator*

On-demand, signed, exportable bundle for one production / licence / talent: consent ledger, custody chain, download events, tamper log — sourced from the hash-chained `complianceEvents` + existing certificates. This is the artifact handed to defense counsel when a claim lands; no competitor produces it. Likely a PDF/JSON export endpoint reusing the certificate generation path.

### 4.4 Portfolio roll-up — *light*

For an insurer covering many productions: a book view of every production they hold a grant on — risk grade, open gaps, trend — scoped strictly to their grants (never platform-wide). Reuses the productions tracker filtered by the caller's active insurer grants.

### 4.5 Continuous risk monitoring + alerts — *medium, fast-follow*

Insurers price at bind but bleed money when risk drifts mid-policy. Push a notification to the scoped insurer when *their* production crosses a threshold: new use-without-consent violation, Bridge tamper alert, strike declared, or policy-vs-usage mismatch. Hooks `bridgeEvents` + `complianceEvents` into the existing notification system.

### 4.6 Cyber-underwriting controls view — *light, fast-follow*

Surface existing biometric-isolation + security-custody attestation events as a SOC2-lite controls page for cyber underwriters. Ties into the Vanta-style compliance dashboard already built.

---

## 5. Access & gating

- Insurer = `role/trueRole = "compliance"`, distinguished by holding grants of `subtype="insurer"`.
- All insurer reads go through `hasGrantForScope()` / the evidence access layer — **read-only, no data-plane access, never raw scan bytes** (unchanged compliance guarantee).
- Insurer landing page: extend `/evidence` (or a dedicated `/underwriting`) to render the underwriting dashboard + portfolio when the watcher's subtype is `insurer`.
- Platform/org-wide oversight helpers (`canViewPlatformOversight()`) must **exclude** insurer subtype — data minimization.

---

## 6. MVP slice

Ship in this order:

1. **§4.1 producer-adds-insurer grant flow** (+ §2 hard guard) — unblocks everything; nothing works until an insurer can be attached to a production by the producer.
2. **§4.2 per-production underwriting dashboard** — the demo screen.
3. **§4.3 claims evidence pack** — the differentiator.

Then fast-follow with **§4.4 portfolio**, **§4.5 monitoring**, **§4.6 cyber controls**, and the **§3.2 `insurer_policies`** table (needed for the policy panel + lapsed/uninsured flags).

---

## 7. Open questions

- **Pricing/packaging:** per-insurer-seat, per-production, or rev-share with the production company?
- **Evidence pack format:** PDF (counsel-friendly) vs JSON (machine-readable for actuarial ingest) — likely both.
- **Self-serve insurer signup** vs producer-invite-only for V1 (lean invite-only to keep the per-production binding clean).
- **Talent visibility:** should talent see which insurers can view their consent evidence on a given production? (Recommend yes — consistent with the platform's transparency posture.)

---

## 8. Build checklist

- [x] `0066_insurer_policies.sql` migration (§3.2) — `insurerPolicies` table + Drizzle schema
- [x] Hard guard: reject non-production/talent scope for `insurer` grants (§2)
- [x] `POST` / `DELETE /api/productions/:id/insurers` + production-detail "Insurers" UI (§4.1)
- [x] Insurer underwriting dashboard (per-production) (§4.2) — `/underwriting`, A–D grade, cast onboarding, coverage gaps, use-violations, strikes, policy panel + lapsed/uninsured-use flags
- [ ] Claims evidence pack export endpoint + UI (§4.3) — *next*
- [x] Portfolio roll-up view (§4.4) — landing list scoped to the insurer's grants (worst-risk-first); deepen with trend later
- [ ] Risk monitoring notifications (§4.5)
- [ ] Cyber controls view (§4.6)
- [x] Exclude insurer subtype from platform/org oversight helpers (§5) — insurer grants can't be platform-scoped (hard guard), so `canViewPlatformOversight()` / `hasPlatformGrant()` already exclude them

### Phase 8 MVP #2 (this PR) — §4.2 underwriting dashboard + §3.2 policies + §4.4 portfolio

- `lib/compliance/underwriting.ts` — `gradeFor` (A–D, hard breaches/strikes cap the grade), `buildUnderwritingView` (per-production), `buildPortfolio` (insurer's book), policy `lapsed` + production-level `uninsuredUse` (usage outside every live policy window). Composes the existing `buildProductionsOverview` / `detectUseViolationsForLicences` so figures tie out with the union surface.
- `lib/compliance/insurer-access.ts` — `resolveInsurerAccess`: a watcher is authorised only by an active insurer grant on that exact production (admins may view).
- `GET /api/insurer/productions` (portfolio), `GET /api/insurer/productions/:id` (dashboard), `GET`/`POST /api/insurer/productions/:id/policies`, `DELETE …/policies/:policyId` (soft-archive). Policy writes require the grant holder.
- `/underwriting` page + client: portfolio sidebar with grade badges, per-production dashboard (grade hero, alerts, metrics, cast bar, policy panel with add/archive). Insurer watchers land here; nav item injected for the insurer subtype.
