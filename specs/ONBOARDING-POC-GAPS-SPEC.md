# Spec — Onboarding POC Gaps

**Status:** Draft for review
**Author:** Product / Eng
**Date:** June 2026
**Audience:** Founders, eng, design

---

## TL;DR

Our business partner's interactive onboarding prototype (`imagevault.html`) models **six onboarding arcs** — production company, vendor (+ Bridge), agency, agent, production team-member, and performer (+ consent). Our shipped build covers the *engineering reality* underneath several of these (real R2 multipart upload, render-bridge agent, compliance/insurer oversight, pipeline processing) but does **not yet express the consent-and-routing model** that is the prototype's core thesis: **programmable consent that routes itself.**

This spec catalogues the gaps between the prototype and the current codebase, ranks them by leverage, and gives each a concrete build sketch (schema, routes, files). It is a **working document to pick up later**, not a commitment to a sprint. Nothing here needs to be built in one pass — the gaps are independent and individually shippable.

The recommended sequence is **#2 → #1 → #3 → #4** (use-category taxonomy → standing instructions / auto-routing → performer consent document → agency & agent model). That quartet is the prototype's heart.

---

## 0. How to read this

Each gap below has:

- **Prototype** — what the POC models.
- **Today** — what the codebase actually does (with file references).
- **Gap** — the precise delta.
- **Build sketch** — schema, routes, and files to add/modify.
- **Effort / Leverage** — rough sizing.

References to the prototype point at `imagevault.html` (the partner's POC). References to the codebase use real paths.

---

## 1. Standing Instructions + auto-routing resolver + agent inbox

**Leverage: highest. Effort: large.** This is the most differentiated idea in the prototype and is entirely absent today.

### Prototype
Performers set **per-use-category** rules — `always` / `case-by-case` / `never`. A resolver (`ivResolveRequest`) runs at request time:

- all requested uses set to `always` → **auto-grant**
- all requested uses set to `never` → **auto-refuse**
- any `case-by-case`, any mix, or no instructions on file → **route to the agent inbox** for a human decision

The **agent inbox** then offers four actions per request: *grant*, *refuse*, *forward* (to the performer), and *counter* (approve a narrower scope with a comment). Requests carry a status lifecycle: `new → forwarded → signed | refused | countered | auto-granted | auto-refused`. The inbox splits into an **"Action needed"** tab and an **"Auto-handled"** tab so agents only see what needs them.

### Today
Only per-licence `licences.preauthUntil` / `preauthSetBy` exists — a blanket time-window pre-auth set per licence by a rep. There is no category-level rule store, no resolver, and no agent decision queue. "case-by-case" appears only as incidental text in compliance code, not as a routing primitive.

### Gap
The entire rule-based consent engine and the agent decision surface.

### Build sketch

**Schema (new tables):**

```
standingInstructions
  id, talentId, useCategoryId, disposition ('always'|'case_by_case'|'never'),
  setBy (userId), updatedAt
  UNIQUE(talentId, useCategoryId)

licenceRequests            -- the routable unit (may precede a full licence)
  id, productionId, castId, talentId, repId,
  usesRequestedJson,       -- array of useCategoryId
  proposedWindow,          -- e.g. 'Until 31 Dec 2027'
  status,                  -- new | forwarded | signed | refused | countered | auto_granted | auto_refused
  resolution,              -- 'auto' | 'agent' | 'performer' | null
  resolvedAt, resolvedBy, resolvedReason,
  counterScopeJson, counterComment,
  createdBy, createdAt
```

**Resolver:** `lib/consent/resolve.ts` — a pure function mirroring `ivResolveRequest`:
`resolveRequest(usesRequested, standingInstructions) -> { auto: boolean, action?: 'granted'|'refused', reason?: string }`.
Conservative rule: only **unanimous** `always`/`never` auto-resolves; everything else needs a human.

**Routes:**
- `POST /api/licences/requests` — create a request; run resolver; either auto-resolve (write licence + audit) or enqueue for the agent.
- `GET /api/agent/inbox` — list requests needing this agent, filterable by status; plus an `?auto=1` view.
- `POST /api/licences/requests/[id]/decision` — body `{ action: 'grant'|'refuse'|'forward'|'counter', scope?, comment? }`.
- `GET|PUT /api/talent/standing-instructions` — performer reads/sets their rules (lives on the performer dashboard, **not** in registration — see prototype note that SIs were deliberately moved out of signup).

**Files:** `lib/consent/resolve.ts`, `app/(vault)/agent/inbox/`, `app/(vault)/vault/standing-instructions/` (or a settings panel).

**Note:** depends on **#2** (a stable `useCategoryId` vocabulary). Build #2 first.

---

## 2. Canonical use-category taxonomy tied to legal regime sections

**Leverage: high (foundational). Effort: small–medium.** Build this before #1 and #3.

### Prototype
Six named categories, each with a legal tag, a `sensitive` flag, and a plain-English example:

| id | name | regime tag | sensitive |
|----|------|-----------|-----------|
| `vfx-this` | VFX work on this production | — | no |
| `reuse` | Re-use on later productions | — | no |
| `dub` | Dubbing and localisation | §39D | no |
| `replica` | Digital replica creation | §39E | yes |
| `training` | Training data for generative AI | §39G | yes |
| `marketing` | Marketing and promotion | — | no |

### Today
Free-text `licences.intendedUse`, a `permitAiTraining` boolean, and `licenceType`. No structured taxonomy, no regime mapping, no shared vocabulary across consent / licences / standing instructions.

### Gap
A single canonical list that consent documents, licence terms, and standing instructions all reference by stable id.

### Build sketch
- `lib/consent/use-categories.ts` — exported const array (id, name, description, example, regimeTag, sensitive). Code-defined, like the skills registry; no DB cold-start cost.
- Optional `useCategories` table only if categories need to vary per regime/agreement; otherwise keep it in code.
- Migrate `intendedUse` usage to reference category ids (keep the free-text field for notes).
- Wire `permitAiTraining` to the `training` (§39G) category so the boolean and the taxonomy don't drift.

---

## 3. Performer-facing consent document + signature/attestation + withdrawal

**Leverage: high (legal trust). Effort: medium.**

### Prototype
A plain-English consent document with sections: *what's being captured, what you're consenting to, who'll have access, how long the data is held, where the data goes, your right to withdraw.* Signed with **typed name + drawn signature + an attestation checkbox**. The performer then "claims" their vault; production-held vaults flip to claimed. Consent can be **withdrawn** from the dashboard (with a reason), per production.

### Today
`consentRecords` (territory/language) and `scrubAttestations` exist — but the attestation UI we've built is for **vendor scrub/purge**, not **performer consent signing**. Path D self-claim exists; the consent-document signing surface and the withdraw-consent flow do not.

### Gap
The performer-facing consent artifact (render + sign + store), and a withdrawal flow.

### Build sketch

**Schema:**
```
consentSignatures
  id, consentRecordId | licenceRequestId, talentId,
  typedName, signatureSvg (or r2Key), attestedAt, ipHash, userAgentHash,
  usesConsentedJson, documentVersion

consentWithdrawals
  id, consentRecordId, talentId, reason, withdrawnAt
```

**Routes:**
- `GET /api/consent/[id]/document` — server-renders the consent doc from licence/request + use categories (#2).
- `POST /api/consent/[id]/sign` — body `{ typedName, signatureSvg, attested: true, uses }`.
- `POST /api/consent/[id]/withdraw` — body `{ reason }`; emits audit + notifications to production.

**Files:** `app/(vault)/consent/[id]/` (document + sign), withdraw control on the performer dashboard, `lib/consent/document.ts` (the canonical copy, versioned).

**Note:** version the document so we can prove *which wording* a performer signed.

---

## 4. Agency-as-organisation + agent onboarding + agent identity

**Leverage: high. Effort: medium–large.**

### Prototype
An **agency** (e.g. Curtis Brown) registers as the first-class org; its admin invites **agents**; agents have their own identity (codes `AG-####`) and an inbox where they act on behalf of performers (ties directly into #1). Agent onboarding is a guided arc: welcome → password → 2FA → terms → done → inbox.

### Today
A `rep` role linked to talent via `talentReps`, but reps land on a bare roster. Organisations exist only for vendors/production companies — there is **no agency org type**, no agency-invites-agent flow, and no agent inbox. `AG` codes are minted but the surrounding model is thin.

### Gap
Agency as an organisation type, the agency→agent invite/onboarding flow, and the agent inbox (shared with #1).

### Build sketch
- Add `agency` to `lib/organisations/orgTypes.ts` (prefix `AG` already used for rep codes — reconcile).
- Reuse `organisationMembers` / `organisationInvites` for agency→agent.
- Agent onboarding arc mirroring the existing invitee pattern (welcome / password / 2FA / terms / done) landing on `/agent/inbox`.
- Link a performer's `talentReps` row to the agent's agency so requests route to the right inbox.

---

## 5. Guided-onboarding "escalation to human" off-ramps

**Leverage: medium (trust + data quality). Effort: small.** Cheap win, slot in anytime.

### Prototype
Every wizard has graceful exits:
- **"That's not us"** on the entity step — the legal entity is **locked** (set at invite time) and disputing it opens a "we'll come back within one working day" path rather than letting the user proceed with wrong data.
- **"Something else"** on the union/regime step — non-standard regimes (both Equity + SAG-AFTRA, ACTRA, non-union, etc.) escalate to human review; regime is parked as `Pending review`.

### Today
Guided production setup + concierge exist, but no structured dispute/escalation off-ramps. A wrong legal entity or regime can flow straight through.

### Gap
Locked-entity dispute + non-standard-regime escalation, both producing a tracked "needs human" record.

### Build sketch
- `onboardingEscalations` table: `id, kind ('entity_dispute'|'regime_review'), productionId, raisedBy, note, status, createdAt`.
- Wire into the production setup wizard steps; surface to admins (reuse the admin console / MCP).
- Park `production.regime` as `pending_review` until resolved.

---

## 6. Production-level countries / jurisdictions

**Leverage: medium. Effort: small–medium.**

### Prototype
Productions carry a list of active countries (a `home` country + others), each with a status, plus an add-country flow that **escalates** non-standard jurisdictions to human review.

### Today
`territory` is **per-licence free text** (`licences.territory`, `productionDefaultTerms.territory`, `consentRecords.territory`). No production-level country set.

### Gap
Model jurisdictions once at the production level instead of as repeated per-licence strings.

### Build sketch
- `productionCountries` table: `id, productionId, country, isHome (bool), status ('in_scope'|'pending_review'|'removed'), addedAt`.
- Add-country / remove-country routes under `app/api/productions/[id]/countries/`.
- Default new licences' `territory` from the production's in-scope countries.

---

## 7. Bridge as a guided 5-step setup checklist with local-network attestation

**Leverage: medium (liability anchor). Effort: small–medium.**

### Prototype
A progress-tracked checklist: **generate token → install agent (OS-specific command) → secure local folder → test connection → attest.** The **attest** step is an audit-logged human confirmation that the proxy folder is locked down (authorised workstations only, excluded from render-farm crawlers, no secondary backups/mirrors). The **test** step verifies the agent actually connected.

### Today
The Bridge works technically — `lib/auth/requireBridgeToken.ts`, `app/api/bridge/tokens`, `app/api/bridge/render-bridge` (enroll/heartbeat/project-grant), `app/(vault)/settings/bridge/bridge-client.tsx` — but it's presented as a settings page with a Docker command, not a guided checklist. The **test-connection** and **local-network attestation** steps are missing.

### Gap
Frame setup as the 5-step checklist and add the two missing steps, especially the audit-logged attestation.

### Build sketch
- Reuse existing `bridgeEvents` for `agent_online` to drive the live "test connected" state.
- `bridgeAttestations` record: `id, organisationId, attestedBy, attestedAt, statementVersion`.
- Restructure `bridge-client.tsx` into the 5-item checklist with per-step status (todo / waiting / done / failed) and a progress bar.

---

## 8. Capture-company deliverable upload queue (push model)

**Leverage: medium. Effort: large.** Confirm scope before building — may be a deliberate design divergence.

### Prototype
Capture companies (scan houses, dubbing studios) **push** processed scans, tagging each file with AH/PR/look/type codes, receive receipts, then **purge** local copies with attestation. The production sees a "deliverables received" record per file.

### Today
Upload is **talent/rep-oriented** (`app/api/vault/upload/{initiate,presign,complete,status}` — multipart R2). Vendors only **pull** via render-bridge. The capture-company push-upload-with-code-tagging + purge attestation isn't there, and there's no first-class "deliverable" record (closest is `pipelineOutputs`, keyed by SKU).

### Gap
A vendor-facing upload queue that tags files with chain codes, plus a deliverables ledger and purge attestation.

### Build sketch
- `deliverables` table: `id, scanCode, ahCode, prCode, vendorOrgId, look, type, fileName, sizeBytes, isFolder, receivedAt, purged, purgedAt`.
- Vendor upload UI reusing the multipart pipeline but with per-row code tagging (default PR/AH/look/type pre-fill) → receipts → purge confirmation (audit-logged).
- **Open question for the partner:** is push-upload in scope, or is pull-cache (render-bridge) the deliberate single model for getting processed data around?

---

## What's already covered (and what we're ahead on)

The prototype does **not** model these — they're places our build leads:

- Compliance / insurer / union oversight (`complianceGrants`, `insurerPolicies`, underwriting grades).
- Real multipart-R2 upload with SHA-256 integrity and resume.
- Pipeline SKU processing (preview / realtime / vfx / training).
- Production-included scans with abuse tracking; scrub periods + attestations.
- Licence reference codes (`LC-####`); chain codes (`IV-AH-…-PR-…-Sxx`).
- Admin MCP + AI email triage.

Largely covered, with cosmetic deltas only:

- Production-company onboarding wizard (`/productions/setup`) — prototype adds nicer copy and the off-ramps in #5.
- Production team-member invites (`organisationMembers` / `organisationInvites`) — prototype adds Admin/Operator permission tiers.
- Vendor attach-to-production + 2FA-mandatory.

**Probable deliberate divergences (confirm, don't assume gaps):**
- Capture-company **push** upload (#8) vs our render-bridge **pull** cache.
- Vendor **self-selects** its type/country in the prototype; we set `orgSubtype` at invite time.

---

## Recommended build order

1. **#2 Use-category taxonomy** — foundational, small. Unlocks the rest.
2. **#1 Standing instructions + resolver + agent inbox** — the core thesis.
3. **#3 Performer consent document + signature + withdrawal** — legal trust.
4. **#4 Agency + agent model** — completes the routing loop with #1.
5. **#5 Escalation off-ramps** and **#7 Bridge checklist** — cheap trust wins, drop in anytime.
6. **#6 Production countries** — when multi-territory becomes a priority.
7. **#8 Deliverable push-upload** — only after confirming it's in scope.

---

## Open questions

- Is the capture-company **push-upload** model (#8) in scope, or is pull-cache the single intended path?
- Should use categories (#2) be **code-defined** (like skills) or **DB-backed** (varying per regime/agreement)?
- Do agents (#4) get their own login identity now, or remain modelled as `rep` until the inbox lands?
- Standing instructions (#1): confirm the conservative "unanimous-only" auto-resolve rule is the policy we want legally.
