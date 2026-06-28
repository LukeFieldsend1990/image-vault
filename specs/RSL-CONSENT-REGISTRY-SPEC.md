# Spec — RSL (Really Simple Licensing) + Human Consent Registry

**Status:** Phases 1–2 implemented · Phase 3 proposed · **Author:** Luke + Claude · **Date:** 2026-06-28
**Origin:** Cate Blanchett / RSL Media's [Human Consent Registry](https://gizmodo.com/cate-blanchett-launches-human-consent-registry-to-help-protect-your-likeness-from-ai-industry-scraping-2000776268) (free public registry; red/amber/green AI-use consent; "Human Consent ID") + the [RSL 1.0 standard](https://rslstandard.org/rsl) (machine-readable licensing for the AI web; RSS co-creator). Both push the same mission as Image Vault: **people keep custody of their likeness, and machines can read the terms.**

---

## TL;DR

Image Vault is already ~80% of an RSL implementation — it just doesn't *speak the standard* or *expose any of it*. Our existing primitives map almost 1:1 onto RSL and the Registry's stoplight:

| Image Vault today | RSL / Registry equivalent |
|---|---|
| `standingInstructions` disposition `never` / `case_by_case` / `always` on the AI use-categories | Registry stoplight **red** / **amber** / **green** |
| `useCategories` `training` (§39G), `replica` (§39E), `permitAiTraining` | RSL `<permits type="usage">ai-train</permits>` etc. |
| licence request → approve → fee / royalty flow | RSL **Open License Protocol** (license server) |
| `royaltySources` unit pricing (per-generation / per-1k-inferences / per-frame) | RSL `<payment type="inference"\|"training">` |
| `validFrom`/`validTo`, `territory`, `exclusivity`, `fileScope` | RSL licence terms / scope |
| compliance ledger (`complianceEvents`), audit export | RSL provenance / acceptance artifacts |

**The gap is purely surface and protocol:** nothing we hold is machine-readable, discoverable (robots.txt / `.well-known` / HTTP `Link`), publicly declarable, or transactable by a non-human agent. RSL fills exactly that gap, and the Human Consent Registry gives talent a recognisable, mission-aligned public artifact (a **Human Consent ID** badge).

This spec adopts RSL in **three escalating, independently-shippable layers**:

1. **Publish + Declare** — a per-talent public *consent posture* (stoplight) + machine-readable **RSL `license.xml`**, discoverable the way the standard expects.
2. **Be the License Server** — expose Image Vault as an RSL **Open License Protocol (OLP)** endpoint so AI companies/crawlers programmatically discover terms and get routed into our existing licence → approve → pay/royalty flow.
3. **Federate to the Registry** — let talent push their Image Vault posture to RSL Media's Human Consent Registry, obtain a **Human Consent ID**, and show it as a verified badge.

> **Not zero-knowledge — and RSL doesn't change that.** Per `CLAUDE.md`, the platform is server-mediated. The RSL surfaces we publish describe **licensing terms and consent posture**, and point machines *back to Image Vault as the place to license*. They never expose scan bytes, file lists, or biometric data. Image Vault becomes the **license-acquisition point**, not a public file host.

---

## Decisions locked (from Luke, 2026-06-28)

1. **Scope:** all three layers, phased (1 → 2 → 3).
2. **Default posture = Prohibited (red).** A talent only shows amber/green where their **existing AI-use standing instruction** says so. Unset = red. The standing-instructions setting copy must be updated to make clear it now *also* drives the public RSL/consent posture.
3. **Two-key publication gate — be very careful with the public internet.** Even when a talent opts in, **nothing is served publicly until an admin approves it per-talent.** Default **off**; admin holds the master switch over all public exposure. **Unlisted per-talent URLs only — no enumerable public directory.**
4. **Monetization:** RSL `<payment>` terms route AI use through our **existing fee + `royaltySources`** machinery. Image Vault is the paid rail.
5. **Posture scope (Q2):** start with the **two AI/biometric categories the Registry maps cleanly** — `training` (§39G) and `replica` (§39E). These drive the headline stoplight + RSL `<permits>`/`<prohibits>`. Other categories (`dub` §39D, `vfx-this`, `reuse`, `marketing`) are carried as **stubs** in the model and rendered as detail rows, but don't yet emit standalone RSL usage terms — wired in later behind the same derivation.
6. **Registry federation reality (Q1 — researched):** RSL Media has **no public self-serve write API today**. It's a *"request to partner… to help shape the next phase"* programme; registration requires **identity verification** on rslmedia.org, is **US/EU only**, and the "Human Consent Standard 1.0" is a **draft**. So Phase 3 is **deferred to a feature-flagged adapter + a manual "claim & paste your Human Consent ID" bridge**, plus a business action to join the partner programme — *not* programmatic minting. See revised Phase 3.

---

## What already exists (don't rebuild)

| Capability | Where | Notes |
|---|---|---|
| AI use-category taxonomy w/ regime tags + `sensitive` | `lib/consent/use-categories.ts` | `training` (§39G), `replica` (§39E) are the AI-likeness categories that drive posture. **Reuse as-is.** |
| Per-talent disposition (the "AI opt-in") | `standingInstructions` table (`lib/db/schema.ts`), `PUT /api/talent/standing-instructions` | `never` / `case_by_case` / `always` per `useCategoryId`. **This is the existing "opted into AI use" setting.** |
| Standing-instructions settings UI | `app/(vault)/settings/standing-instructions.tsx`, `app/(vault)/settings/page.tsx:344` | Already renders §39G/§39E with `sensitive` badge. We extend the copy + add the publish toggle here. |
| Per-licence AI flag, kept in sync | `licences.permitAiTraining`, `reconcileTrainingFlag()` in `lib/consent/use-categories.ts` | Don't fork this — derive RSL from the same source. |
| Licence request → approve → fee/royalty | `POST /api/licences`, `.../[id]/approve`, `royaltySources`, `usageEvents` | This **is** our OLP backend. Phase 2 wraps it, doesn't replace it. |
| Unit pricing for AI use | `royaltySources` (`unitType`, `unitRatePence`) | Maps to RSL `<payment type="inference"/"training">`. |
| Tokenised public, no-login surface (precedent) | `/api/consent/access/[token]`, `lib/consent/token.ts` (KV, TTL) | Same pattern we reuse for unlisted public RSL URLs. |
| Compliance ledger + audit export | `complianceEvents`, `/api/licences/[id]/audit/export` | Provenance for any RSL acceptance. |
| Public short codes | `LC-####`, user/org codes (`lib/codes/`) | We add an **unguessable** slug for public RSL — *not* the enumerable codes. |
| Vault lock (gate precedent) | `users.vaultLocked`, `/api/settings/vault-lock` | Mental model for the admin master-switch UX. |

## What's missing (this spec)

- A **two-key, admin-gated publication state** for each talent's public consent profile.
- A **derivation layer** mapping standing instructions → stoplight posture → RSL XML (single source of truth, no new posture store).
- **Public surfaces**: unlisted consent-profile page + `license.xml`, with correct **discovery** (HTML `<link rel="license">`, HTTP `Link`, site `robots.txt` License directive, `.well-known`).
- An **OLP / license-server endpoint** that turns a machine licence request into our existing PENDING-licence flow and returns RSL-shaped offers/tokens.
- A **Registry federation client** + Human Consent ID storage and badge.
- An **admin console** to review and approve publication requests.

---

## Design

### Core principle — one source of truth, derived everywhere

Posture is **never stored**; it is *derived* from `standingInstructions` so it can never drift from what the talent actually set:

```
disposition (per AI use-category)        stoplight        RSL
─────────────────────────────────────────────────────────────────────
never            → PROHIBITED (red)    → <prohibits type="usage">ai-train</prohibits>
case_by_case     → WITH TERMS (amber)  → <permits>…</permits> + <payment> + server=OLP
always           → PERMITTED (green)   → <permits>…</permits> (+ payment if a price is set)
unset / missing  → PROHIBITED (red)    → prohibit (default-deny)
```

"AI use-categories" for posture = the two the Registry maps cleanly: **`training` (§39G)** and **`replica` (§39E)** (Q2). A new helper `lib/rsl/posture.ts#derivePosture(talentId)` returns the per-category stoplight + an overall worst-case light for the badge.

**Stubs for the rest (Q2).** The derivation is written over a category list, not hard-coded to two: `RSL_USAGE_MAP` in `lib/rsl/posture.ts` maps each `useCategoryId` → an RSL usage token, but only `training`/`replica` have non-null tokens for now:

```ts
// lib/rsl/posture.ts
export const RSL_USAGE_MAP: Record<string, string | null> = {
  training: "ai-train",   // §39G — live
  replica:  "ai-use",     // §39E — live
  dub:      null,         // §39D — stub: rendered as detail, no standalone RSL term yet
  "vfx-this": null,       // stub
  reuse:    null,         // stub
  marketing: null,        // stub
};
```
`derivePosture` skips `null`-mapped categories when emitting `<permits>`/`<prohibits>`, but still returns their stoplight for the human-readable detail rows. Adding a category later is a one-line map change — no schema or route change.

---

### Phase 1 — Publish + Declare

#### Data model — `rslProfiles` (new table)

A dedicated table keeps the **exposure controls** isolated and auditable; posture itself stays derived.

```ts
export const rslProfiles = sqliteTable("rsl_profiles", {
  id: text("id").primaryKey(),                          // uuid
  talentId: text("talent_id").notNull().unique().references(() => users.id),
  // — key 1: talent —
  publishOptIn: integer("publish_opt_in", { mode: "boolean" }).notNull().default(false),
  // — key 2: admin (master switch; default OFF even if publishOptIn is true) —
  adminApproved: integer("admin_approved", { mode: "boolean" }).notNull().default(false),
  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: integer("approved_at"),
  // — unlisted public address (unguessable; NOT the enumerable LC/AH codes) —
  publicSlug: text("public_slug").unique(),             // e.g. 32-char base62
  // — minimal public card fields (talent-curated, no biometric data) —
  displayName: text("display_name"),
  profession: text("profession"),
  linksJson: text("links_json"),                        // website / socials, talent-entered
  // — Phase 2/3 —
  licenseServerEnabled: integer("license_server_enabled", { mode: "boolean" }).notNull().default(false),
  humanConsentId: text("human_consent_id"),             // from external Registry (Phase 3)
  registryStatus: text("registry_status", {
    enum: ["not_linked", "pending", "linked", "error"],
  }).notNull().default("not_linked"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

Migration: `drizzle/migrations/0031_rsl_profiles.sql` (next sequential number).

**Publication predicate (enforced in one place, `lib/rsl/visibility.ts#isPublic`):**
```
isPublic(profile) === profile.publishOptIn && profile.adminApproved && !!profile.publicSlug
                      && !talent.vaultLocked     // locking the vault also pulls public RSL
```
Every public route calls this first; if false → `404` (not `403` — we don't confirm existence).

#### Talent settings UI (extend, don't add a new page)

In `app/(vault)/settings/standing-instructions.tsx`:
- Add an explainer above the AI categories: *"These choices also set your public AI-consent posture (red / amber / green) if you publish a consent profile below."*
- Add a **"Public consent profile"** card (talent key):
  - Toggle `publishOptIn` (writes via new `PATCH /api/rsl/profile`).
  - Live **preview** of the stoplight + the human-readable terms exactly as the public would see them.
  - Clear state copy: *"Opted in — awaiting Image Vault admin approval"* vs *"Live at `changling.io/c/<slug>`"* vs *"Not published"*. Reinforces that admin approval is required.
  - Minimal curated fields: display name, profession, links (no scan/biometric data ever).

#### Admin console (the master switch)

New `app/(vault)/admin/rsl/` + `app/api/admin/rsl/route.ts`:
- Queue of talent with `publishOptIn === true && adminApproved === false`.
- Per-talent: preview the exact public page + `license.xml`, then **Approve** (sets `adminApproved`, `approvedBy`, `approvedAt`, mints `publicSlug`) or **Revoke** (flips off, retires slug).
- Admin-whitelist gated (`isAdmin`), and every approve/revoke writes a `complianceEvent` for provenance.

#### Public surfaces (only when `isPublic`)

1. **Consent profile page** — `app/c/[slug]/page.tsx` → `GET /c/<slug>`
   Server component. Human-readable: stoplight, plain-English per-category terms, "To license, contact Image Vault" CTA (→ Phase 2 OLP / licence request), Human Consent ID badge (Phase 3). Emits discovery metadata:
   - HTML `<link rel="license" type="application/rsl+xml" href="/api/rsl/<slug>/license.xml">`
   - HTTP `Link: </api/rsl/<slug>/license.xml>; rel="license"` header
   - `<meta name="robots" content="noindex">` unless Q3 says otherwise (default: unlisted, not indexed).

2. **RSL license document** — `app/api/rsl/[slug]/license.xml/route.ts` → `GET /api/rsl/<slug>/license.xml`
   `Content-Type: application/rsl+xml`. Generated by `lib/rsl/xml.ts#renderTalentRsl(profile, posture)`:

   ```xml
   <rsl xmlns="https://rslstandard.org/rsl">
     <content url="https://changling.io/c/SLUG" server="https://changling.io/api/rsl/olp">
       <!-- amber: licensable with terms -->
       <license>
         <permits type="usage">ai-train</permits>      <!-- §39G training -->
         <permits type="usage">ai-use</permits>        <!-- §39E replica/inference -->
         <payment type="training"><standard>https://changling.io/api/rsl/olp</standard></payment>
         <payment type="inference"><amount currency="GBP">…</amount></payment> <!-- from royaltySources -->
       </license>
       <!-- red categories emitted as prohibitions -->
       <license><prohibits type="usage">ai-train</prohibits></license>
     </content>
   </rsl>
   ```
   Default-deny: anything not explicitly permitted is prohibited. Amounts are pulled from the talent's `royaltySources` unit pricing when present.

3. **Site-level protective baseline** (no PII, safe to be fully public):
   - `app/robots.txt/route.ts` (or static) adds an RSL `License:` directive → `app/.well-known/rsl.xml/route.ts`, a **generic platform policy** stating: content on Image Vault is licensable only via the OLP endpoint; default-deny AI training/use. This is the "label on the front door" — it names no talent and exposes nothing per-person.

> **No enumerable directory.** There is deliberately no "list all opted-in talent" route. Each profile is reachable only via its unguessable slug (shared by the talent or surfaced inside an authenticated relationship). This is the careful-public-exposure requirement made concrete.

---

### Phase 2 — Be the License Server (Open License Protocol)

Wrap, don't replace, the existing licence engine. **OLP is concretely implementable today**: per the [OLP spec](https://rslstandard.org/api) it's an **OAuth 2.0 extension** — clients hit a token endpoint with `grant_type=rsl`, and RSL License Servers (explicitly intended to be run by "licensing agencies" — i.e. us) issue licenses as OAuth-style credentials. This maps neatly onto our existing token/`rsk_`-key issuance.

- **`POST /api/rsl/olp/token`** — OAuth2 token endpoint, `grant_type=rsl`. Client presents the content ref (slug) + requested usage; we return either a license-acquisition challenge (payment/consent required) or, once granted, a bearer license token.
- **`POST /api/rsl/olp`** (`lib/rsl/olp.ts`) — license-acquisition flow behind the token endpoint:
  1. Machine agent posts an offer/request referencing `content` (slug) + intended `usage` (`ai-train` / `ai-use`) + requesting org.
  2. If the talent posture is **red** for that usage → `403` + RSL `<prohibits>` body. **Amber/green** → create a **PENDING licence** by calling the existing `POST /api/licences` internals (server-side, no cookie forwarding — same pattern as skills), with `permitAiTraining` / `useCategoriesJson` derived from the request.
  3. Return an **RSL license offer**: the `royaltySources` unit pricing as `<payment>`, plus a status URL. Approval still flows through the human dual-custody/standing-instruction path — `always` can auto-grant, `case_by_case` notifies the talent. **No bypass of consent.**
  4. On approval + payment, issue a **license token** (mirror `royaltySources` `rsk_` key issuance / download-token TTL pattern) the agent presents for metered use; usage accrues via `usageEvents`.
- **Crawler Authentication Protocol (CAP):** unauthenticated AI crawler hitting a gated resource gets `402`/`403` + a `Link: rel="license"` pointer to the OLP token endpoint. (Lightweight pointer first; full CAP verification later.)
- **Encrypted Media Standard (EMS) — later.** RSL's EMS lets a licensed client retrieve a symmetric **JWK** to decrypt an asset. This aligns with our existing `lib/crypto` + R2 encryption-at-rest, and is a natural future enhancement to gate *actual scan delivery* through a licensed key handoff — but it is **out of scope for Phase 2** (we keep delivery on the existing dual-custody/bridge path).
- Everything is logged to `complianceEvents` for a clean provenance chain (machine licence → grant → metered use).

> **Built vs deferred (Phase 2 as shipped).** Built: the full OLP request/consent/credential state machine — discovery, `grant_type=rsl` token endpoint, posture-enforced decision (deny/auto-grant/route-to-human), license-token mint + one-time delivery + introspection, CAP `Link`/`WWW-Authenticate` helpers, and an admin review console. The license token attests **granted consent** for a usage. Deferred (Phase 2.5): wiring a granted OLP request into a *formal* `licences` row + `royaltySources` so metered **billing/settlement** actually moves money (needs a licensee identity + payment integration — a product decision); appending OLP events into the hash-chained `complianceEvents` ledger (kept in `rsl_license_requests` for now to avoid corrupting the chain); a talent-facing requests UI (the grant/deny **API** already authorises talent + rep, so it's surfaced in the admin console first); and full CAP enforcement on the data-plane download/bridge paths + EMS key handoff.

This is the monetization answer made real: **an AI company that wants a likeness is routed into our paid fee + royalty rails**, with consent enforced by the talent's existing dispositions.

---

### Phase 3 — Federate to the Human Consent Registry (deferred / manual-bridge first)

**Researched constraint (Q1):** RSL Media's registry (`registry.rslmedia.org`) launched June 2026 with **no public self-serve write API**. It's a *"request to partner to help shape the next phase"* programme; registration requires **identity verification** on rslmedia.org, is **US/EU only**, and the **Human Consent Standard 1.0 is a draft**. So we cannot programmatically mint Human Consent IDs today. Plan:

- **Business action (now):** submit the RSL Media **partner request** (entertainment / rights-management track) to get on the roadmap and early API access. This is the gating dependency, not code.
- **Interim — manual claim bridge (shippable now):** in settings, a *"Claim your Human Consent ID"* card that **deep-links the talent to rslmedia.org** pre-filled where possible (name, profession, links, and their derived stoplight so the two systems agree), then lets them **paste the returned Human Consent ID back**. We store it on `rslProfiles.humanConsentId`, set `registryStatus = "linked"`, and render the **verified badge**. No API dependency.
- **Future — adapter (`lib/rsl/registry.ts`), feature-flagged:** when the partner/API path opens, swap the manual bridge for programmatic push (posture + minimal identity → Human Consent ID) against the then-published spec. Keep the same storage/badge so the UI doesn't change.
- One-way only (Image Vault → Registry); Registry-as-source-of-truth is out of scope. Surface the **US/EU-only** limitation in the UI so non-eligible talent aren't misled.

---

## Security & exposure (explicit, per "be very careful")

- **Default-deny everywhere.** Posture defaults red; publication defaults off; admin switch defaults off; unknown usage in OLP is prohibited.
- **Two independent keys** (talent `publishOptIn` + admin `adminApproved`) checked in a single `isPublic()` predicate. No route renders public RSL without it.
- **Unlisted, unguessable slugs**; `noindex` by default; **no directory**; `404` (not `403`) on non-public to avoid confirming existence.
- **No biometric / file / scan data** on any public surface — terms and posture only. Scans remain auth- + licence-gated exactly as today.
- **Vault lock supersedes** — locking the vault pulls public RSL immediately.
- **Admin actions audited** (`complianceEvents`); approval is per-talent, revocable, and re-reviewed if the talent materially changes identity fields.
- **OLP creates intent, never access** — it can mint a PENDING licence; it cannot grant download/consent. Dual-custody and standing instructions still govern.

---

## Phasing / deliverables

| Phase | Ships | Effort |
|---|---|---|
| **1 — Publish + Declare** ✅ | `rslProfiles` table (`0090_rsl_profiles.sql`), `lib/rsl/{posture,visibility,profile,xml}.ts`, settings toggle + standing-instructions copy, admin console (`/admin/rsl`), public `/c/<slug>` + `/api/rsl/<slug>/license.xml`, `robots.txt` + `.well-known/rsl.xml` baseline | Medium — **done** |
| **2 — License Server** ✅ | OLP discovery (`GET /api/rsl/olp`) + token endpoint (`POST /api/rsl/olp/token`, grant_type=rsl) + poll + introspect; `rsl_license_requests` table (`0091`); posture-enforced grant/deny (red denies, green auto-grants, amber → human review); license-token mint/introspect; CAP helpers; admin review console | Medium–High — **done** |
| **3 — Federate** | `registry.ts` client, Human Consent ID storage + badge, settings action, feature flag | Small–Medium (gated on external API) |

Each phase is independently valuable and shippable. Phase 1 alone delivers the mission-aligned, press-ready story ("Image Vault speaks RSL; your talent get a public consent posture and can carry a Human Consent ID").

---

## Open questions

1. ✅ **Resolved — External Registry API.** No public write API today; partner-request stage, identity-verified, US/EU-only, draft standard. Phase 3 = manual claim-and-paste bridge now + feature-flagged adapter later + submit the partner request. (See revised Phase 3.) **Business action owner: Martin** (business partner) will submit the RSL Media partner request. Supporting brief + draft email + source links captured in Notion → [Image Vault concepts › RSL Media partner request (Human Consent Registry)](https://app.notion.com/p/38d9ff52f91c8193a5cef3c8a9ef4dc3).
2. ✅ **Resolved — Posture category set.** Start with `training` (§39G) + `replica` (§39E); other categories carried as stubs in `RSL_USAGE_MAP`, rendered as detail, no standalone RSL term yet. (See Core principle.)
3. **Slug style.** Unguessable random slug (max privacy, recommended) vs a talent-chosen vanity handle (nicer to share, slightly more enumerable). Default: random, with optional vanity later.
4. **`robots.txt`/`noindex`.** Keep all public RSL `noindex` + rely on talent sharing the link (recommended, matches "unlisted"), or allow indexing for talent who explicitly want maximum discoverability?
5. **Domain.** Confirm public surfaces live on `changling.io` (per the MCP connect example in `CLAUDE.md`) and not a separate apex.
6. **Naming overlap.** "RSL" = the open standard; "RSL Media" = the nonprofit behind the Registry. Confirm we're comfortable using the RSL name/badging in product copy (likely yes given the mission alignment, but worth a deliberate call).

---

## Why this fits Image Vault's mission

The Human Consent Registry gives an individual a *declaration* ("don't train on me / here are my terms"). RSL makes that declaration *machine-readable*. Image Vault already holds the **custody, consent ledger, dual-custody approval, and royalty rails** to make those terms *enforceable and payable*. Adopting RSL turns Image Vault from a private vault into the **place the open AI web comes to license a likeness on the talent's terms** — same mission (custody of your image), now legible to machines, and monetized through rails we already run.
