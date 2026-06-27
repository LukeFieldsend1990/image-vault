# Spec — Cast Invitation, Consent Document & Gentle Performer Conversion

**Status:** implemented (Phases 1–4) · **Author:** Luke + Claude · **Date:** 2026-06-27
**Source of truth for flows:** partner POC `imagevault.html` (cast invite → consent doc → "For performers" explainer) + the multi-select licence-consent screenshot.

---

## TL;DR

The partner's POC shows three connected surfaces we don't yet match:

1. **Producer side — a rich "request access" builder.** When a producer adds cast, they pick from the six §39-tagged **use categories** (VFX, re-use, dubbing §39D, digital replica §39E, AI training §39G, marketing) — each with a plain-English description, an example, and a *sensitive* treatment. Today our cast-invite UI only offers the older flat `licenceTypes` list (film_double, game_character…) and never surfaces the consent taxonomy the rest of the platform already speaks.

2. **Performer/agent side — a consent document.** A sectioned, plain-English document (what's captured, what you're consenting to, who gets access, retention, where data goes, withdrawal rights) where the performer can **add or remove individual consents** against what was requested, watch a **dynamic "In summary"** block update live, and **accept**. *(Per Luke: skip the drawn-signature/typed-name ceremony — a single explicit attestation/accept is enough for now.)*

3. **Conversion — "ImageVault for performers."** The gentle pitch that turns a one-off production-held signer into a registered user who controls their own vault: the explainer page, the "take control / claim your vault" CTA after consenting, and the standing-instructions story.

The use-category taxonomy (`lib/consent/use-categories.ts`) and the consent ledger (`consentRecords` / `complianceEvents`) already exist. This spec is mostly **UI + a thin consent-document/standing-instructions layer on top of existing data** — not a new data plane.

> Builds on `specs/ONBOARDING-POC-GAPS-SPEC.md` §1 (standing instructions + resolver), §2 (taxonomy — *done*), §3 (consent document). This spec narrows those to the exact partner flows and adds the **conversion** angle they don't cover. Where they conflict, this spec's "no signature ceremony" decision wins.

---

## What already exists (don't rebuild)

| Capability | Where | Notes |
|---|---|---|
| Canonical use-category taxonomy | `lib/consent/use-categories.ts` | Six categories, `regimeTag`, `sensitive`, `example`. Matches the POC 1:1. **Reuse as-is.** |
| Consent ledger + projection | `consentRecords`, `complianceEvents` (`lib/compliance/consent.ts`) | Hash-chained events + current-state rows. `grantConsent` / `revokeConsent`. |
| Consent API | `POST|DELETE|GET /api/compliance/consent` | Grants/revokes by `useType` + territory/language. |
| Cast roster + states | `productionCast` (`placeholder→invited→linked→scan_uploaded→consented→declined`) | `licenceTermsJson`, `licenceId`. |
| Cast invite (bulk + per-row) | `POST /api/productions/[id]/cast`, `.../request-licence`, `.../resolve` | Already writes `useCategoriesJson` via `serializeUseCategoryIds`. |
| Licence terms incl. `useCategoriesJson` | `licences` table, `lib/productions/cast.ts` | `reconcileTrainingFlag` keeps `permitAiTraining` ↔ `training` in sync. |
| Invites (Path A/B/C/D) | `invites`, `/api/invites/[token]` | Email → signup → link. |
| Vendor attach + per-cast assignment | `productionVendors`, `vendorAuthorisations` | Out of scope here except where the consent doc *describes* vendor access. |

## What's missing (this spec)

- **Producer request builder** that uses USE_CATEGORIES (with tags/examples/sensitive), not the flat `licenceTypes` list.
- **Performer-facing consent document** surface (render → toggle consents → live summary → accept). No drawn signature.
- **Standing instructions** store + **auto-routing resolver** (`always` / `case_by_case` / `never`) so registered performers/agents can auto-grant or auto-refuse at request time. *(POC-gaps §1; the engine behind "Granted immediately".)*
- **"ImageVault for performers" explainer** + **conversion CTAs** (claim vault / register) on the post-consent screen and on production-held cast rows.

---

## Design

### Surface A — Producer "Request access" builder

**Where:** the Add-cast / per-cast-row flow in `app/(vault)/productions/[id]/production-detail-client.tsx` (and the setup wizard's Cast/Terms steps).

**Change:** replace the flat `licenceTypes` checkbox group used for *consent scope* with a USE_CATEGORIES selector that mirrors the screenshot:

- One row per category: checkbox · **name** + optional `regimeTag` pill (e.g. `§39E`) · description · (on the performer side) the `example`.
- `sensitive: true` categories (replica §39E, training §39G) get the muted/cautioned styling already implied by the POC (`iv-sensitive`).
- Pre-tick nothing by default on the producer side; the producer is *asking*. The chosen set becomes the **requested scope** carried into the consent document.
- Keep `licenceTypes` (film_double, etc.) only as the licence *product type*, decoupled from consent scope. Persist the chosen categories to `useCategoriesJson` (already supported) and onto the cast row's `licenceTermsJson` so the consent document can render "Requested".

**Reuse:** `listUseCategories()`, `serializeUseCategoryIds()`; existing POST bodies already accept `useCategoriesJson`-derived data via `request-licence` / `resolve`. Mostly a UI swap + making the request routes carry the explicit category array.

### Surface B — Performer/agent consent document

**Where (new):** `app/(vault)/consent/[id]/` (server `page.tsx` + `consent-client.tsx`) — also reachable unauthenticated by a production-held performer via a tokenised link (see Routes). `id` = the routable consent unit (licence id, or a `licenceRequest` id once §1 lands).

**Layout** (mirrors `imagevault.html` `Router.routes['consent-document']`, copy in `lib/consent/document.ts`, **versioned**):

1. Header: "Consent to use your biometric data on *{production}*", who sent it, when.
2. §1 What's being captured.
3. §2 **What you're consenting to** — the USE_CATEGORIES list. Requested ones show a `requested` pill and are **pre-ticked**; performer can untick any and tick extras. Each shows description + example.
4. §3 Who'll have access (controller = production while unclaimed; vendors within scope).
5. §4 How long the data is held (retention copy).
6. §5 Where the data goes (the Bridge; never sold/trained without §39G).
7. §6 Right to withdraw (UK GDPR Art. 7(3) / SAG-AFTRA §39).
8. **Dynamic summary** — "You are about to consent to **X of N** uses" + live bullet list, recomputed on every toggle. Empty state: "sign with nothing ticked to refuse entirely."
9. **Accept** — a single attestation checkbox ("I am {name}, I've read this, I'm consenting freely…") + **Confirm consent** button. **No canvas/typed-name.** On submit: write each ticked category via `grantConsent` (one `consent.granted` event each), flip the cast row to `consented`, record `documentVersion` + `attestedAt` + hashed IP/UA on a lightweight `consentAcceptances` row.

**Agent variant:** when an agent opens the same document on behalf of a performer, show the "forwarded by / acting as agent" banner and let them accept under their standing-instruction authority. (Full agent inbox is §1 below; the document itself is shared.)

### Surface C — Gentle conversion

1. **Post-consent "take control" panel** (POC `iv-perf-take-control`): after a production-held performer confirms, show "You're done — you can leave it there" + "claim your vault / set standing instructions" with a soft, no-pressure CTA and a "we'll email you when it's ready to claim" reassurance.
2. **`/imagevault-for-performers` explainer** (new route): the POC's "What is ImageVault / what changes if you register / standing instructions / claiming past vaults / what it costs" page, with the before/after comparison. Linked from the consent doc (§3) and the post-consent panel.
3. **Claim path:** reuse the existing Path D self-claim. The explainer's "Register" CTA enters signup; on completion the production-held vault flips to claimed and (if §1 is built) the performer sets standing instructions.

### Surface D (engine) — Standing instructions + auto-routing resolver

*(POC-gaps §1 — needed for the "Granted/Refused immediately" outcomes and the agent story. Can ship after A–C as a fast-follow; A–C work without it, just always routing to a human.)*

- `standingInstructions(talentId, useCategoryId, disposition, setBy, updatedAt)` — `always | case_by_case | never`, `UNIQUE(talentId, useCategoryId)`.
- `lib/consent/resolve.ts`: pure `resolveRequest(usesRequested, instructions)` mirroring `ivResolveRequest` — **unanimous-only** auto-resolve (all `always`→grant, all `never`→refuse, anything else → human).
- Wire into the cast request routes: on send, run resolver; auto-grant/refuse + audit, or leave `pending` for the agent/performer.
- Performer/agent UI to set instructions (settings panel or `vault/standing-instructions`).

---

## Schema changes

Minimal — most data already exists.

```sql
-- New: lightweight acceptance record (replaces the POC's signature ceremony)
consentAcceptances
  id TEXT PK
  licenceId TEXT            -- or licenceRequestId once §1 lands
  castId TEXT
  talentId TEXT NULL        -- null while production-held + unclaimed
  acceptedByEmail TEXT      -- who clicked (performer or agent)
  acceptedByRole TEXT       -- 'talent' | 'rep' | 'agent'
  usesConsentedJson TEXT    -- array of useCategoryId
  documentVersion TEXT      -- e.g. '2026.06'
  ipHash TEXT, userAgentHash TEXT
  attestedAt INTEGER

-- New (Surface D, can be a later migration): standing instructions
standingInstructions
  id TEXT PK
  talentId TEXT
  useCategoryId TEXT
  disposition TEXT          -- 'always' | 'case_by_case' | 'never'
  setBy TEXT, updatedAt INTEGER
  UNIQUE(talentId, useCategoryId)
```

Reuse `consentRecords` + `complianceEvents` for the actual consent state/audit — `consentAcceptances` just captures the *document-acceptance* artifact (which wording, by whom). Next migration after `0087_…`.

---

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/consent/[id]/document` | Server-render data for the consent doc (production, requested scope, current ticks, document version). Auth: linked talent / their rep / tokenised production-held link. |
| `POST` | `/api/consent/[id]/accept` | Body `{ uses: string[], attested: true }` → `grantConsent` per use, write `consentAcceptances`, flip cast row to `consented`, notify production. |
| `POST` | `/api/consent/[id]/withdraw` | Body `{ reason }` → `revokeConsent` + audit + notify. (Performer dashboard control.) |
| `GET|PUT` | `/api/talent/standing-instructions` | Surface D: read/set dispositions. |
| `POST` | `/api/productions/[id]/cast/[castId]/request-licence` | *(exists)* — extend to carry the explicit USE_CATEGORIES array + run resolver (Surface D). |

Public consent-doc link for unregistered performers: tokenised, short-TTL, KV-backed (pattern mirrors download tokens). The page lives under `app/(auth)` or a public segment so it renders without a session.

---

## Copy (versioned)

All long-form copy → `lib/consent/document.ts` as a versioned export (`CONSENT_DOCUMENT_V_2026_06`) and `lib/consent/performer-explainer.ts`. Lift wording from the POC (sections 1–6 + explainer) so legal review happens against one stable artifact. Version string is stored on every acceptance so we can always prove which wording was shown.

---

## Phased build order — ALL DELIVERED (2026-06-27)

- **Phase 1 — Producer request builder (Surface A). ✅** §39 USE_CATEGORIES multi-select in `production-detail-client.tsx`; threaded through `POST /api/productions/[id]/cast` → licence `useCategoriesJson` / invite terms / placeholder row, reconciling training↔permitAiTraining.
- **Phase 2 — Consent document + accept (Surface B). ✅** `migration 0088` (`consent_acceptances`, `standing_instructions`); copy in `lib/consent/document.ts` (versioned `2026.06`, retention section omitted); loaders `lib/consent/load.ts`; engine `lib/consent/acceptance.ts` (grant/revoke reconcile + cast→consented + guest acceptance + registration replay); shared client `app/consent/consent-document-client.tsx`; pages `app/consent/[id]` (registered) + `app/consent/access/[token]` (public, tokenised via `lib/consent/token.ts`); routes `GET /api/consent/[id]/document`, `POST .../accept`, `POST .../withdraw`, `GET|POST /api/consent/access/[token]`. Emails `consentRequestEmail` / `consentConfirmedEmail`.
- **Phase 3 — Conversion (Surface C). ✅** Post-accept "take control" panel + `/imagevault-for-performers` explainer + register/claim CTA (signup replay turns guest consent into ledger entries on registration).
- **Phase 4 — Standing instructions + resolver (Surface D). ✅** `lib/consent/resolve.ts` (unanimous-only) + `standing-instructions.ts`; `GET|PUT /api/talent/standing-instructions`; resolver wired into `request-licence` (auto-grant/refuse vs route-to-human); editor in talent Settings + agent's roster Permissions tab.

All type-checked + linted clean; no new test failures.

---

## Decisions (resolved 2026-06-27)

1. **No signature.** Single attestation checkbox + "Confirm consent" button — no drawn/typed signature. Keep `consentAcceptances.ipHash`/`userAgentHash` for evidentiary weight.
2. **Tokenised public consent link** for unregistered performers (short-TTL, KV-backed). Drives conversion; no forced signup to read/accept.
3. **Leave out the retention period.** Drop the "How long the data is held" section (§4) from the consent document copy — no fixed number until legal weighs in. Renumber remaining sections.
4. **Routable unit:** hang consent on the **licence** now; migrate to a `licenceRequests` unit when Surface D's inbox lands.
5. **Keep** the flat `licenceTypes` (licence *product type*) alongside use categories — they answer different questions.
