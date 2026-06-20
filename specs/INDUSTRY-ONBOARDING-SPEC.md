# Spec — Guided Onboarding for Production Companies

**Status:** Draft for review
**Author:** Product
**Date:** June 2026
**Audience:** Founders, eng, design

---

## TL;DR

A production company should be able to land on Image Vault, and within ten minutes have a **fully scaffolded production with its entire cast roster on screen — having typed zero email addresses.**

We achieve this by inverting the starting object. Today onboarding is built around a *person* (talent searches for themselves on TMDB). For industry, the starting object is the **production**. Productions are largely public data, so we can pre-populate the whole cast list from TMDB before the production company has contacted a single actor. The missing emails stop being a blocker and become a backlog that *fills itself over time* — through agent invites, manual resolution, and (the key new piece) **auto-claim when talent later joins.**

The good news from a build perspective: placeholder cast rows, TMDB cast-list import, and the cast lifecycle **already exist** in the codebase. This spec is mostly about sequencing them into a guided flow and adding one loop-closer (auto-claim on signup).

---

## 1. The problem

Two things our partner flagged:

1. **"We need a guided onboarding flow for industry, and setting up one production."**
   Today an industry user signs up, sets up 2FA, and lands on an **empty dashboard**. There is no guided path. The talent role has a polished TMDB-driven onboarding (`app/(auth)/onboarding/`); industry has nothing equivalent. They're dropped into a product with empty Productions and Licences panels and left to figure out organisations → productions → cast → licences on their own.

2. **"Sometimes they won't have the talent emails at this point."**
   This is the crux. A VFX vendor or production company knows *which production* they're working on and *which roles* they need likeness rights for, but at kickoff they frequently do **not** have the performers' personal email addresses. They might have the agency. They might have only a character/actor name off a call sheet or breakdown. If our onboarding demands "enter the actor's email to add them," we stall at the first step for the exact users we most want to activate.

**The reframe:** missing emails are not an error state. They are the *normal* starting condition. Best-in-class onboarding treats "I don't have their email yet" as the default happy path, not an edge case.

---

## 2. Design principles

What "best in class" means here, drawn from the products that do B2B activation well:

- **Pre-populate from where the data already lives.** Vercel imports your repo from GitHub; we import your cast from TMDB. The user *confirms and edits*, they don't *enter from scratch*. This is the single highest-leverage move.
- **Production-first, not person-first.** The production company's mental model is "I'm doing Project Northwind," not "I need to license Jane Doe." Start from their object.
- **Defer the hard part.** Stripe lets you test before you've entered bank details. We let you build a full roster before you've entered any emails. Activation should not depend on data the user doesn't have yet.
- **Make the backlog self-healing.** A reserved cast slot should resolve itself when possible — when talent joins, when an agent fills it in — so the production company's to-do list shrinks without their effort.
- **Time-to-value in one sitting.** The "aha" is *"Image Vault already knows my whole cast and which of them are reachable."* That should land in the first session, before any outreach.
- **Resumable and nagging in a good way.** They will get pulled into a meeting mid-flow. State persists; the dashboard shows a clear "finish setting up [Production]" checklist that pulls them back.
- **Every action is a compliance artifact.** Quietly reinforce that each roster slot becomes an auditable consent record (SAG-AFTRA Article 39). This is the *why it matters*, not just *how to click*.

---

## 3. The core insight: the production is the key that unlocks the cast

A production's cast is public information. If the production company links their project to TMDB (which the production-creation form already supports), we can call the existing `GET /api/productions/[id]/cast/tmdb` endpoint and get back the **full billed cast** — names, characters, TMDB person IDs, profile images — *and* a `matched` flag telling us which of those performers are already on Image Vault.

That means the moment a production company names their project, we can show them:

> **"Project Northwind has 24 cast members. 3 are already on Image Vault and ready to license. Here are the other 21 — reserve them now, invite who you can reach, and the rest will fill in as talent join."**

Zero emails required to reach this state. This is the activation moment.

---

## 4. The guided flow

A resumable, multi-step wizard launched immediately after 2FA setup for industry-role users, and re-entrant from the dashboard. Five steps; the user can finish in under ten minutes and can bail at any point with progress saved.

### Step 0 — Welcome (10 seconds)
One screen. "Let's set up your first production. You'll have your cast roster ready in a few minutes — no need to track down anyone's email first." Sets the expectation that emails are *not* required. Single CTA: **Get started.**

### Step 1 — Your company (the organisation)
The lightest possible org creation. We need a name; everything else is deferred.

- **Company name** (required) → creates the `organisations` row, `orgType: "production_company"`, current user becomes `owner`.
- Optional, collapsed by default: website, billing email.
- We do **not** ask them to invite their team here — that's a distraction from the goal. We surface "invite your team" as a *later* dashboard nudge.

> Reuses existing `POST /api/organisations`. No backend change.

### Step 2 — Find your production
TMDB-powered search, identical pattern to the talent onboarding search but for titles.

- Search field: "What are you working on?" → debounced TMDB title search (`/api/productions/tmdb-search`, already exists).
- Results show poster, title, year, type. One click links it: pre-fills name, year, type, `tmdbId`.
- **Escape hatch:** "It's not listed / it's unannounced" → manual entry (name + type only; everything else optional). This path skips the TMDB cast import but everything downstream still works with manual/CSV cast entry.
- Optional inline: SAG-AFTRA project number (we explain why — "we'll stamp it on every consent record for your Article 39 filings"). Can be added later.

> Reuses existing `POST /api/productions`. No backend change.

### Step 3 — Your cast (the centerpiece)
**This is the screen that makes us best-in-class.** On entering, we call `GET /api/productions/[id]/cast/tmdb` and import the full cast as `productionCast` rows — **all as placeholders** by default (status `placeholder`, `tmdbId` and `actorName` populated, `sourceNote: "TMDB credits"`). No emails, no invites sent yet.

The user sees their entire cast as a roster, each row tagged with a **reachability state**:

| Tag | Meaning | What the user does |
|---|---|---|
| ✅ **On Image Vault** | TMDB person matched an existing talent account (`matched: true`) | One click → send licence request. The fast path. |
| ✉️ **Have their email** | User types an email inline | Promotes placeholder → invite sent |
| 🏢 **Have their agency** | User picks/invites the representing agency | Routes to agent-mediated fill (see §5) |
| ⏳ **Reserved** | No contact yet — the default | Leave it. It self-heals (see §5). |

Critical UX details:
- **Bulk select.** "Send licence requests to all 3 matched" in one action. "Invite all reachable." Don't make them go row by row.
- **Inline, optional email.** Adding an email is a single inline field per row — never a modal, never required.
- **Trim the roster.** They can remove cast they don't need rights for (background, archival, etc.) so the roster reflects *their* scope, not TMDB's full billing.
- **The roster is the deliverable.** They can finish the wizard here with most rows still `Reserved`. That's a *complete, valid* state — a fully scaffolded production. We celebrate it, we don't warn about it.

> Reuses `GET /api/productions/[id]/cast/tmdb` and `POST /api/productions/[id]/cast`. **Net-new:** a bulk-import action that writes all TMDB cast as placeholder rows in one call (today the TMDB tab is manual, row-by-row).

### Step 4 — Set your default terms (optional, smart)
Rather than ask for licence terms per actor, ask **once** for production-level defaults: intended use (e.g. "Digital double · VFX"), territory, AI-training permission, validity window. These become the default `licenceTermsJson` applied to every invite/licence under this production. Per-actor overrides happen later if needed.

This is a deliberate altitude choice: production companies negotiate broadly similar terms across a cast. One form, not twenty-four.

> **Net-new:** production-level default terms (store on the production or a side table; applied at cast-resolution time).

### Step 5 — Done / what happens next
A clear summary and an honest map of the backlog:

> "Project Northwind is set up. 24 roles on your roster: 3 ready to license now, 5 invited, 16 reserved. We'll let you know the moment a reserved performer joins Image Vault — and you can add emails or invite agencies any time."

CTAs: **Send the 3 ready licence requests** (primary), **Go to production**, **Invite my team**.

---

## 5. Solving "no emails yet" — the cast resolution lifecycle

A reserved slot (`status: placeholder`) can become a real, consented licence through **four independent paths**. The production company never has to block on any one of them.

### Path A — Auto-matched (already here)
TMDB person ID matched an existing talent. The licence request flow is one click. *This works today.*

### Path B — Direct email (already here)
The production company gets the actor's email later (from production office, agency, the actor). They open the reserved row, add the email → `promoteCastMember()` sends the invite and stores the terms. On signup the talent auto-links and a licence is created. *This works today via the resolve endpoint; we surface it more prominently.*

### Path C — Agent-mediated (mostly new wiring)
**This is the pragmatic bridge for the no-email case.** Production companies almost always know the *agency* even when they don't have the actor's personal email — it's on the breakdown/call sheet. So:

- On a reserved row, offer **"Invite their representation."** The user enters the agency contact (or picks from agencies already on Image Vault).
- We send a rep/agency invite scoped to *that cast slot*. The agent joins (or is already on IV), sees "[Production] has reserved a role for your client [Actor]," and either fills in the client's email or, if they already manage that talent, **links them directly.**
- The agent becomes the one who supplies the email we don't have — which is exactly how representation works in the real industry.

> Image Vault already has rep delegation (`talent_reps`) and org invites. **Net-new:** wire a cast-slot-scoped agency invite and a rep-side "resolve this reserved role" surface. High value, medium effort.

### Path D — Self-claim on signup (the loop-closer, net-new)
Today, when a talent signs up, we only link them to a cast row if they came through a *specific invite*. We do **not** match an organically-joining talent against open placeholder rows. That's the gap that makes placeholders feel like dead data.

**Proposal:** on every talent signup *and* on TMDB-profile confirmation in talent onboarding, match the talent's `tmdbId` (and fall back to normalized name) against open `productionCast` placeholders across all productions. On a match:

- Surface to the talent: **"A production has reserved a role for you — [Character] in [Production] by [Company]. Is this you?"** → on confirm, link the cast row (`status: linked`), and notify the production company.
- Notify the production company: **"[Actor] just joined Image Vault and claimed their role in [Production]. Send a licence request?"**

This is what makes the roster self-healing. Reserved slots resolve *without the production company doing anything*, and the production company gets a delightful "it's filling itself in" signal that drives retention.

> **Net-new:** placeholder-matching at signup/onboarding-confirm. Must be consenting and non-creepy — the talent confirms the match; we never auto-expose their email to the production company without the licence flow. Guard against name-collision false positives (require tmdbId match, or talent confirmation for name-only matches).

### The lifecycle, end to end

```
placeholder ──(add email)──────────► invited ──(talent signs up)──► linked ──► (scan uploaded) ──► consented
    │                                                                  ▲
    ├──(invite agency, Path C)────────────────────────────────────────┤
    └──(talent joins & claims, Path D)────────────────────────────────┘
```

Existing `productionCast.status` enum already supports every state in this diagram: `placeholder | invited | linked | scan_uploaded | consented | declined`. We are not inventing states — we are adding *transitions into* them.

---

## 6. What exists vs. what's net-new

Grounding the scope so we don't rebuild what's there.

| Capability | Status | Notes |
|---|---|---|
| Org creation (`POST /api/organisations`) | ✅ Exists | Reuse as Step 1 |
| Production creation + TMDB title link | ✅ Exists | Reuse as Step 2 |
| TMDB cast-list fetch + talent matching (`/cast/tmdb`) | ✅ Exists | The engine of Step 3 |
| Placeholder cast rows (name-only) | ✅ Exists | `status: placeholder`, `actorName`, `tmdbId` |
| Cast invite / link / licence creation | ✅ Exists | `POST /cast`, `promoteCastMember()` |
| Cast lifecycle states | ✅ Exists | Full enum already in schema |
| **Guided industry onboarding wizard** | ❌ Net-new | Steps 0–5; the core of this spec |
| **Bulk TMDB→placeholder import** | ❌ Net-new | One action vs. row-by-row tab today |
| **Production-level default terms** | ❌ Net-new | Step 4 |
| **Agent-mediated slot resolution (Path C)** | ⚠️ Partial | Rep/org invites exist; cast-slot scoping is new |
| **Auto-claim on talent signup (Path D)** | ❌ Net-new | The loop-closer; highest delight-per-effort |
| **Dashboard "finish setup" checklist** | ❌ Net-new | Drives resumption |

The bulk of the value comes from *sequencing existing primitives* plus **two** genuinely new behaviors: bulk placeholder import and auto-claim on signup.

---

## 7. The dashboard after onboarding

The wizard isn't the whole story — the dashboard has to pull them back to finish the backlog.

- **Setup checklist card** per production: "Project Northwind — 8 of 24 cast resolved." Progress bar. Expands to the unresolved roster.
- **Activity feed:** "Jane Doe joined Image Vault and claimed her role" / "Agency X filled in 3 of your reserved roles." This is the self-healing made visible — the reason they come back.
- **One-click batch actions:** "3 talent are ready — send licence requests."

---

## 8. Success metrics

Define activation precisely so we can tell if this works.

- **Primary activation:** % of new industry signups that reach a production with ≥1 cast row, within 24h of signup. Target: this is the number the whole flow optimizes.
- **Email-free activation:** % of activated productions that reached their first roster with **zero emails entered.** This validates the core thesis. Target high — this *should* be the common path.
- **Time-to-roster:** median minutes from signup to first populated cast roster. Target < 10 min.
- **Backlog resolution rate:** % of placeholder rows that reach `linked`/`consented` within 30/60/90 days, split by path (A/B/C/D). Tells us whether the self-healing actually heals.
- **Self-claim contribution:** % of resolutions coming via Path D. Validates the loop-closer was worth building.
- **Return rate:** % of industry users who come back within 7 days (the dashboard nudges + self-claim notifications should drive this).

---

## 9. Edge cases & guardrails

- **Name-collision false positives (Path D).** Require a `tmdbId` match for silent surfacing; for name-only matches, always require explicit talent confirmation. Never link on name alone without a human in the loop.
- **Privacy.** A reserved placeholder must never leak a talent's contact details to the production company. The production company sees "Reserved — [public name/character]"; the email only ever flows through the invite/licence machinery, never exposed raw. Path D notifies the production company that someone *claimed* a role — it does not hand over their email.
- **Talent declines a reserved role.** `status: declined`. Production company sees it, can re-route to a different performer or remove the slot. No silent failure.
- **Production not on TMDB.** Manual + CSV cast entry already exist; the wizard's escape hatch routes there. Lose the auto-import magic, keep everything else.
- **Wrong TMDB match.** Easy unlink/re-search at the production level; cast import is re-runnable.
- **Duplicate cast.** Dedupe on `tmdbId` within a production (already a field); for name-only entries, soft-warn on near-duplicates.
- **Roster churn.** Re-running TMDB import on a production that gained cast should *add* new rows, not clobber resolved ones. Merge, don't replace.
- **Org already exists.** If the user was invited into an existing org, skip Step 1 and go straight to "create a production in [Org]."

---

## 10. Phasing

**Phase 1 — The guided flow (the spine).** Wizard steps 0–5, bulk TMDB→placeholder import, production-level default terms, dashboard setup checklist. Ships the core "fully scaffolded production, zero emails" experience entirely on existing primitives + two small net-new pieces. This alone addresses both of the partner's asks.

**Phase 2 — Self-healing.** Path D auto-claim on signup + the activity feed that surfaces it. This is what turns a good onboarding into a *retention engine*. Modest build, outsized delight.

**Phase 3 — Agent-mediated fill (Path C).** Cast-slot-scoped agency invites and the rep-side resolution surface. Highest real-world fidelity to how casting actually works; do it once Phases 1–2 prove the funnel.

---

## 11. Open questions

1. **Where do production-level default terms live** — a column block on `productions`, or a small `productionDefaultTerms` table? Leaning toward the latter for cleanliness and future per-region defaults.
2. **Path D consent surface** — is the claim prompt part of talent *onboarding* (inline in the existing TMDB-confirm step, which already has their `tmdbId` in hand — very natural), or a post-onboarding dashboard card, or both? The onboarding-confirm step is the most elegant insertion point.
3. **Agency directory** — for Path C, do we lean on agencies already on Image Vault (pick from list) before falling back to free-text invite? Depends on current agency density on the platform.
4. **How aggressive is the self-claim notification to the production company?** Email + in-app, or in-app only until they opt in? Don't want to train them to ignore us.
5. **SAG number capture** — push harder for it in onboarding (compliance is our wedge) or keep it optional to protect time-to-value? Probably optional-but-prominent.

---

*Appendix: this spec is grounded in the current codebase — `app/(auth)/onboarding/`, `app/(vault)/productions/`, `app/api/productions/[id]/cast/`, and `lib/db/schema.ts` (`productionCast`, `invites`, `productions`, `organisations`). The cast lifecycle enum and TMDB cast-import endpoint already exist; this is largely a sequencing-and-loop-closing effort, not a from-scratch build.*
