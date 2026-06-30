# Spec — Organisation-to-Organisation Visibility Consent

**Status:** Phases 1–2 implemented (identity + contacts tiers). Phase 3 (shared-context tier) and Phase 4 (standing connections) remain design-only.
**Author:** Product / Eng
**Date:** June 2026
**Audience:** Founders, eng, design

> **Implementation note.** The model is live: `org_connections` (migration
> `0096`), the consent engine + resolver in `lib/organisations/connections.ts`,
> routes under `app/api/productions/[id]/connections`,
> `app/api/organisations/[id]/connections`, and `app/api/connections/[connId]`
> (+ `/respond`), and UI in `app/(vault)/organisations/connections-section.tsx`
> plus a Connect affordance on the production vendor panel. The `shared_context`
> tier is accepted by the schema/selector but currently renders only the shared
> production name; Phase 3 fills in cast/licence context.

---

## TL;DR

Organisations on Image Vault are **isolated containers** today. A user only ever
sees the orgs they are a member of (`GET /api/organisations` filters by
`organisationMembers.userId`). The only cross-org links that exist are
*operational and one-directional*: a production attaches a vendor org
(`productionVendors`), and a producer authorises a vendor against a specific
licence (`vendorAuthorisations`). Neither of those is a *relationship between
two organisations* — they're plumbing for a specific licence/download.

But organisations that collaborate on a production have a legitimate need to
**see each other as organisations**: who the counterparty is, where they are
registered, who to contact, and (for likeness data) whether they can be
trusted. Right now there is no way for two orgs to say "yes, we're working
together — let us see each other."

This spec proposes a **mutual, consent-first, production-scoped visibility
connection** between two organisations, with **tiered** visibility (identity →
contacts → shared production context). Neither org sees anything about the
other until **both** have opted in, and the grant is **scoped to the production
they actually share** — not a standing, platform-wide directory.

This is a **design document for review**, not a committed build. It deliberately
mirrors primitives that already exist (org invites, the audit ledger, the
vendor-attach flow) so that, if approved, the build is mostly wiring.

---

## 1. The problem

Our partner flagged: *"We need to think about how organisations can consent to
have visibility of each other as they work together on productions."*

Concretely, when a production company attaches a VFX vendor (or a scan house, or
a dubbing studio) to a production:

- The **producer** wants to know: who is this vendor, where are they registered
  (which data-protection regime), are they audited for likeness data, and who is
  my named contact there?
- The **vendor** wants to know: who is the producer/studio I'm taking
  instructions from, and who do I talk to about scope and deliverables?

Today this is solved out-of-band (email, call sheets). On-platform, each side
sees only its own org. The vendor-attach flow (`productionVendors`) tells the
*production* that a vendor is attached, but it does **not** establish a
*reciprocal, consented relationship* where the two orgs can see each other's
identity and contacts in the product.

**Why consent, not automatic?** Because likeness work is sensitive and
relationships are commercial. An org's member list, contacts, and audit posture
should not become visible to a counterparty just because someone attached them
to a production. Visibility must be *something both sides agree to*, and it must
be *revocable*.

---

## 2. Design principles

- **Consent-first and mutual.** Neither org sees the other until **both** accept.
  A one-sided attach (vendor added to a production) is an *invitation to
  connect*, never automatic visibility.
- **Production-scoped by default.** Two orgs connect *in the context of a
  production they share*. The connection's reason-for-being is the shared work.
  This keeps the blast radius small and the consent legible ("we agreed to see
  each other because we're both on *Project Northwind*").
- **Tiered, least-privilege visibility.** Connecting reveals **identity** by
  default. Contacts and shared-production context are **additional tiers** the
  granting org opts into — not bundled.
- **Revocable, always.** Either org can sever the connection at any time;
  visibility ends immediately. Revocation is audit-logged.
- **Never the data plane.** Visibility is about *who you are and who to talk to*
  — org identity, contacts, audit posture. It is **never** a path to performer
  likeness data. That stays gated by `vendorAuthorisations` + Bridge dual
  custody, exactly as today. This spec adds a *people/identity* layer, not a
  *content* layer.
- **Reuse existing primitives.** Org invites (`organisationInvites`), the
  vendor-attach flow (`productionVendors`), and the audit ledger
  (`complianceEvents`) already exist. This is mostly a new join table + a
  resolver + UI, not a new subsystem.

---

## 3. What exists today (grounding)

| Capability | Where | Note |
|---|---|---|
| Org isolation | `GET /api/organisations` (`app/api/organisations/route.ts`) | Filters strictly by `organisationMembers.userId` |
| Org members / roles | `organisationMembers` (`lib/db/schema.ts`) | owner / admin / member |
| Org invites | `organisationInvites`, `POST /api/organisations/[id]/invites` | Email-based join; the UX pattern to mirror |
| Vendor attached to production | `productionVendors` (`vendorOrgId`, `status: active\|pending\|revoked`) | One-directional, operational; **the natural trigger** for a connect offer |
| Per-licence vendor access | `vendorAuthorisations` | The data-plane grant — **out of scope here**, stays as-is |
| Vendor audit posture | `organisations.vendorAuditPassed` | A tier-3 visibility candidate |
| Audit ledger | `complianceEvents` (`organisationId` nullable) | Where connect/revoke events should be written |

**Key insight:** `productionVendors` already records "org A and org B are both on
production P." That row is the *anchor* a visibility connection hangs off — we
don't need to discover the relationship, only to let both sides **consent** to
seeing each other through it.

---

## 4. The model

### 4.1 A connection is a mutual, scoped, tiered grant

```
orgConnections
  id
  productionId          -- the shared production this connection is scoped to (the anchor)
  orgAId                -- the two orgs, stored in a stable canonical order
  orgBId                --   (e.g. orgAId < orgBId lexically) so a pair is unique
  initiatedByOrgId      -- which side offered the connection
  initiatedByUserId
  status                -- 'pending' | 'active' | 'declined' | 'revoked'
  -- per-side visibility tiers the org is willing to EXPOSE about itself:
  orgATier              -- 'identity' | 'contacts' | 'shared_context'
  orgBTier              -- 'identity' | 'contacts' | 'shared_context'
  acceptedAt
  revokedAt
  revokedByOrgId
  createdAt
  updatedAt
  UNIQUE(productionId, orgAId, orgBId)
```

- **Pairing & uniqueness.** Store the two org ids in a canonical order
  (`orgAId` = lexicographically smaller) so `(productionId, orgAId, orgBId)`
  uniquely identifies the relationship and we never get A→B and B→A duplicates.
- **Per-side tiers.** Each org controls *what it exposes about itself*
  (`orgATier` / `orgBTier`). Visibility is not symmetric by necessity — a vendor
  might expose contacts while the studio exposes identity only. The default on
  accept is `identity`; an org can raise its own tier later.
- **Status lifecycle:**
  `pending → active` (both accepted) `→ revoked` (either severs); or
  `pending → declined`.

### 4.2 The tiers (what becomes visible)

| Tier | Reveals | Source |
|---|---|---|
| `identity` (default) | Org name, type, short code, country / jurisdiction, **audit posture** (`vendorAuditPassed` for vendor types) | `organisations` row |
| `contacts` | Named contacts and their org role (owner / admin), email — i.e. "who to reach" | `organisationMembers` + `users.email`, filtered to a contactable subset (e.g. owners/admins, or members explicitly marked contactable) |
| `shared_context` | The cast / licences on **this production** that both orgs touch (read-only, names + status, never likeness bytes) | `productionVendors`, `vendorAuthorisations`, `productionCast` scoped to `productionId` |

Tiers are cumulative: `contacts` implies `identity`; `shared_context` implies
both. Audit posture is folded into `identity` deliberately — "can we trust this
org with likeness data" is exactly the question a counterparty asks *first*, and
it's already a boolean we can expose without leaking anything sensitive.

> **Decision to confirm:** should audit posture be its own opt-in tier rather
> than bundled into `identity`? Bundling is simpler and matches the real
> question producers ask; splitting is more conservative. Leaning bundled.

### 4.3 The resolver

`lib/orgs/visibility.ts` — a single function the API layer calls before
returning any cross-org data:

```
resolveOrgVisibility(db, viewerOrgIds, targetOrgId, productionId)
  -> { tier: 'identity' | 'contacts' | 'shared_context' | null }
```

Returns the **target org's exposed tier** for this production if an `active`
connection exists between one of the viewer's orgs and the target, else `null`
(no visibility). Mirrors the shape of `resolveOwnerAccess()` in
`lib/productions/access.ts` — a pure-ish gatekeeper every read goes through, so
visibility logic lives in exactly one place.

---

## 5. The flow

### 5.1 Offer → accept (mutual handshake)

1. **Anchor exists.** Org A (producer) attaches Org B (vendor) to production P
   via the existing `productionVendors` flow. This is unchanged and does **not**
   grant visibility.
2. **Offer.** From the production's vendor panel (or the org view), an owner/admin
   of Org A clicks **"Connect with [Vendor]"** and picks the tier A will expose.
   → creates `orgConnections` row, `status: pending`, `initiatedByOrgId: A`.
   If Org B has no members on-platform yet, the offer rides on the existing
   vendor invite (mirrors `organisationInvites`).
3. **Notify.** Org B's owners/admins see a pending connection request (in-app +
   email, reusing `sendEmail` + a new template).
4. **Accept / decline.** Org B reviews who is asking (it can already see A's
   `identity` in the *request* context) and either declines or accepts, choosing
   the tier **it** will expose back. → `status: active`, `acceptedAt` set.
5. **Now mutual.** Both orgs can see each other at their respective exposed tiers,
   scoped to production P, via the resolver.

### 5.2 Revoke

Either org's owner/admin clicks **"Disconnect."** → `status: revoked`,
`revokedAt` / `revokedByOrgId` set; the resolver immediately returns `null` for
both directions. Audit event written.

### 5.3 Audit

Every transition (`offer`, `accept`, `decline`, `revoke`, `tier_change`) writes
a `complianceEvents` row with both `organisationId`s referenced, so the
relationship history is provable for compliance/insurer oversight (which already
reads `complianceEvents`).

---

## 6. Routes (sketch)

- `POST /api/productions/[id]/connections` — Org A offers a connection to a
  target org on this production. Body `{ targetOrgId, exposeTier }`. Owner/admin
  of the initiating org only; the initiating org must own/manage P, the target
  must be an attached vendor (or vice-versa).
- `GET /api/organisations/[id]/connections` — list this org's connections
  (incoming pending, active, by production), for the org view.
- `POST /api/connections/[connId]/respond` — target org accepts/declines. Body
  `{ action: 'accept' | 'decline', exposeTier? }`.
- `PATCH /api/connections/[connId]` — change *your own* exposed tier.
- `DELETE /api/connections/[connId]` — revoke (either party).
- **Gating reads:** `GET /api/organisations/[id]` and the production vendor panel
  call `resolveOrgVisibility()` and return only the permitted tier's fields when
  the viewer is a *connected counterparty* rather than a member.

All mutating routes follow the standard `requireSession` + `isErrorResponse`
pattern and re-check org membership/role server-side.

---

## 7. UI surfaces

- **Production → vendor panel:** next to each attached vendor, a **"Connect"**
  affordance (offer) and, once active, a compact counterparty card (identity
  tier; contacts/shared-context if exposed). This is the primary entry point —
  it's where the collaboration is already visible.
- **Organisations view (`app/(vault)/organisations/`):** a **"Connections"**
  section per org listing active/pending connections, with accept/decline for
  incoming offers and a tier control + disconnect for active ones. Slots in
  alongside the Productions / Members sections added in the onboarding-enrichment
  work.
- **Counterparty card component:** one reusable card that renders an org at a
  given tier (identity / + contacts / + shared context), used in both surfaces.

---

## 8. Edge cases & guardrails

- **No visibility without an anchor.** A connection requires a shared
  `productionId`. No production in common → no offer. (A future "standing
  org-to-org connection" — §10 — would relax this; deliberately out of scope
  now.)
- **Membership beats connection.** If the viewer is an actual member of the
  target org, they see everything as a member; the resolver is only consulted
  for *non-member counterparties*.
- **Tier downgrade is immediate.** Lowering your exposed tier (or revoking)
  takes effect on the next read — no caching of cross-org data.
- **Pending offers expose only the initiator's identity** to the target, so the
  target knows who is asking without a grant existing yet. The initiator sees
  nothing of the target beyond what the anchor (vendor attach) already implied.
- **Data plane stays separate.** `shared_context` shows cast/licence *names and
  statuses* for the shared production, never scan bytes or download tokens.
  Likeness access remains `vendorAuthorisations` + Bridge, untouched.
- **Org deletion / vendor revoke.** Revoking the `productionVendors` attachment
  should cascade the connection to `revoked` (the anchor is gone).
- **Audit immutability.** Connect/revoke events are append-only in
  `complianceEvents`; revocation does not erase history.

---

## 9. What's net-new vs reused

| Piece | Status |
|---|---|
| `orgConnections` table + migration | ❌ Net-new |
| `resolveOrgVisibility()` resolver | ❌ Net-new (mirrors `resolveOwnerAccess`) |
| Offer / respond / revoke routes | ❌ Net-new |
| Counterparty card + connections UI | ❌ Net-new |
| Vendor-attach anchor (`productionVendors`) | ✅ Reuse as the trigger |
| Email + in-app notify (`sendEmail`, templates) | ✅ Reuse |
| Audit (`complianceEvents`) | ✅ Reuse |
| Invite-an-org-not-yet-on-platform | ✅ Reuse `organisationInvites` shape |

---

## 10. Phasing

**Phase 1 — Identity handshake.** `orgConnections` + offer/accept/revoke +
`identity` tier only + the counterparty card on the production vendor panel.
This alone answers "who is this counterparty and can I trust them (audit
posture)" — the most-asked question — with full mutual consent.

**Phase 2 — Contacts tier.** Expose named owner/admin contacts so collaborators
can reach each other in-product. Adds the contactable-member concept.

**Phase 3 — Shared production context.** Read-only shared cast/licence status on
the common production. Highest fidelity to the actual collaboration; build once
1–2 prove the model.

**Phase 4 (maybe) — Standing org-to-org connections.** Relax the
production-scope requirement for orgs that work together repeatedly (a persistent
handshake that spans productions). Only if demand is real — production-scoped is
the safer default and may be sufficient.

---

## 11. Open questions

1. **Audit posture: bundled into `identity` or its own tier?** Leaning bundled
   (it's the first question a counterparty asks). Confirm.
2. **Who can offer/accept?** Owner+admin, or owner only? Connections are a
   commercial/trust decision — leaning owner+admin, matching who can already
   invite members and toggle implicit access.
3. **Contacts tier granularity:** expose *all* owners/admins, or a single
   nominated "production contact" per org? A nominated contact is cleaner but
   needs a new field; all-admins reuses what's there.
4. **Production-scoped vs org-to-org:** is production-scoped sufficient long
   term, or do repeat collaborators need standing connections (§10) sooner?
5. **Auto-offer on vendor attach?** Should attaching a vendor *prompt* an offer
   inline (one fewer step), or stay a separate explicit action? Inline is
   smoother but risks conflating attach (operational) with connect (consent).
   Leaning separate-but-prompted.

---

*Appendix: grounded in the current codebase — `lib/db/schema.ts`
(`organisations`, `organisationMembers`, `organisationInvites`,
`productionVendors`, `vendorAuthorisations`, `complianceEvents`),
`lib/productions/access.ts` (`resolveOwnerAccess`, the resolver pattern to
mirror), and `app/api/organisations/`. No data-plane changes: likeness access
remains gated by `vendorAuthorisations` + Bridge dual custody.*
