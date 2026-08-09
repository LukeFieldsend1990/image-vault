# Image Vault — Consent Logger & Chain of Custody Roadmap

> **Origin:** A SAG-insider lawyer reviewing the platform said the two most compelling things in it are the **consent logger** and the **chain of custody**. This spec takes that as the strategic signal it is: these two are the wedge, everything else is supporting cast. It records what shipped in the polish pass, and what to build next around those two pillars.
>
> **Author:** Luke + Claude · **Date:** 2026-08 · **Status:** Phase 0 shipped; Phases 1–3 proposed

---

## The strategic read

Both pillars were substantively strong and presentationally weak. The evidence that makes them compelling — a genuine hash-chained ledger, per-file SHA-256 fingerprints, IP/UA digests on every acceptance, a full negotiation history — was in the database and never reached the page.

That gap has a specific shape, and it generalises into the roadmap below:

1. **We record more than we show.** Every feature here that scores highly costs little, because the data already exists.
2. **We show the positive and hide the negative.** Consent granted was rendered; consent *refused* was not rendered anywhere in the product. In a dispute, the refusal is the operative half.
3. **We assert integrity rather than demonstrating it.** "Tamper-evident" was a word in a footer. It is now a hash on a page, a QR code, and a public endpoint that recomputes the chain in front of the reader.

The unifying principle: **make the evidence legible to someone who does not trust us.** That is the same person the lawyer was describing.

### One constraint that governs everything here

Per `CLAUDE.md`: the platform is **not** zero-knowledge, not zero-trust, and not end-to-end encrypted. The Worker handles file bytes; the platform can technically read stored content. Nothing in this roadmap may imply otherwise. Security rests on access control (auth, dual-custody 2FA, time-limited tokens, audit logging), storage-provider encryption at rest, and a tamper-**evident** ledger. Every claim below is scoped to that.

---

## Phase 0 — Shipped in this pass

| # | What | Where |
|---|---|---|
| 0.1 | **One document grammar.** Shared print palette and type stack; four semantic event tones replacing nine ad-hoc hexes; shared `HashQuads` / `TamperSeal` / `DocRule` / `DocMeta` / `DocEnd` furniture. Adopted by the custody record, the consent receipt, and the compliance certificate. | `lib/documents/palette.ts`, `app/components/seal.tsx`, `lib/compliance/certificate.ts` |
| 0.2 | **Chain of Custody Record, rebuilt.** Cover page, the chain rail (filled node = sealed into the ledger, hollow = derived operational record), per-entry `seq`/`hash`/`prevHash` link lines, day rules, a parties table, the file manifest with SHA-256 digests, a per-chain integrity index, tamper seal + QR, A4 print furniture with a running footer. | `app/(vault)/vault/packages/[packageId]/chain-of-custody/custody-client.tsx` |
| 0.3 | **Custody API carries the evidence.** Ledger positions on every compliance event, per-chain `verifyChain()` results computed at read time, the file manifest, the record hash via `chainSetHash`, and — a real bug fix — the `talent:{id}` chain, which was silently excluded so talent-scoped events never appeared on any custody record. | `app/api/vault/packages/[packageId]/activity/route.ts` |
| 0.4 | **Document seals.** `document_seals` binds a printed document to the ledger state it was issued against, addressed by an opaque 22-character ref. | `drizzle/migrations/0102_document_seals.sql`, `lib/compliance/seal.ts` |
| 0.5 | **Public verification.** `/verify/{ref}` — unauthenticated, PII-free, recomputes the chains live and returns `intact` / `appended` / `broken` / `revoked`. Distinguishes ledger *growth* (normal on an append-only chain) from *tampering*, which most naive hash-seal implementations conflate. | `app/verify/[ref]/page.tsx`, `app/api/verify/[ref]/route.ts` |
| 0.6 | **Consent document, restyled.** Brand tokens throughout (the pre-refresh `rgba(192,57,43,…)` literals are gone), serif title, numbered mono gutter, the two sensitive uses (§39E replica, §39G training) framed apart behind a second explicit confirmation, and a live decision rail showing **Consenting to** and **Withholding** side by side while the performer reads. | `app/consent/consent-document-client.tsx` |
| 0.7 | **The Consent Receipt.** The artifact the performer keeps: granted and withheld enumerated exhaustively, the attestation verbatim with its document version, the evidence block (acceptance id, UTC timestamp, IP/UA digests), ledger `seq` and `hash` per grant, seal + QR, and the §39 / UK GDPR Art 7(3) withdrawal notice. Emailed to the performer (and the agent, when the agent confirmed on their behalf). | `lib/consent/receipt.ts`, `app/consent/receipt/[acceptanceId]/`, `lib/email/templates.ts` |
| 0.8 | **Ledger appends survive a race.** `appendEvent` now retries on a `UNIQUE(chain_key, seq)` collision, re-reading the tip so the retried event chains off the *new* tip. The module's own comment claimed "a racing duplicate seq throws and the caller retries" — no caller retried, so the documented concurrency strategy was never implemented. Retry lives in `appendEvent` rather than at call sites because the loser must recompute `prevHash`; retrying with the original values would produce a chain that fails verification. | `lib/compliance/ledger.ts` |
| 0.9 | **Dropped appends are recorded instead of discarded.** `appendEventBg` still never throws into its caller — an audit write must not fail a download — but a failure now lands in `ledger_append_failures` with the full spec, ready to replay onto the chain's current tip. Surfaced as an admin tile and a page, because a count that nobody sees is the same as no count. Replay appends at the tip (an append-only chain cannot take an insertion) and stamps the original failure time into the payload so the record stays honest about when the event occurred. | `drizzle/migrations/0103_ledger_append_failures.sql`, `lib/compliance/failures.ts`, `app/(vault)/admin/ledger-failures/` |
| 0.10 | **Leak trace-back** (was 2.1). Paste a SHA-256 or a recovered watermark payload and get the scan, the recipient, and every recorded release. Two routes in: content hash for a byte-identical copy, geometry watermark for a re-exported one. The two are held apart deliberately — a hash match names the *file* (any recipient could be the source), a watermark match names the *recipient*, and every result states which it is. | `lib/forensics/trace.ts`, `app/api/forensics/trace/`, `app/(vault)/trace/` |

---

## Phase 1 — Cheap, high-signal (next)

Everything in this phase is built on data already being written. Estimates are rough engineering days.

> **Correction (2026-08).** The first version of this spec proposed a nightly chain monitor and seq-gap detection as the fix for dropped ledger appends. **Both were wrong about what they achieve**, and the reasoning is worth keeping because it is easy to get wrong twice:
>
> `appendEvent` assigns `seq` from the chain's current tip *at write time*. So an append that never happened leaves a chain that is one event shorter than it should be — with every `prevHash` matching, every hash recomputing, and `verifyChain` passing. **There is no gap and no break to find.** Seq gaps only arise from deleting a row that was written, and `verifyChain` already catches those (`e.seq !== i`), so seq-gap detection was near-redundant with the check we already run.
>
> A dropped append is therefore unrecoverable after the fact by any amount of scanning. The only moment it is knowable is the moment it fails — which is what 1.1 below now does. See "Shipped" 0.8–0.9.
>
> The residual case for a periodic monitor is **detection latency** for tampering with rows that *were* written: chains are verified today only when someone opens a record, so a deletion could sit unnoticed until the dispute that makes it matter. That is real but speculative at current scale, and it was deprioritised in favour of leak trace-back. Revisit alongside external anchoring (2.3), which is what would make periodic verification independently meaningful.

### 1.1 ~~Nightly chain monitor~~ → **Durable ledger appends** (shipped, see 0.8–0.9)

### 1.2 ~~Seq-gap detection~~ — dropped, see the correction above

### 1.3 Admin audit reads the ledger

`app/api/admin/audit/events/route.ts` fans out over nine tables and never touches `compliance_events`. Consent grants, withdrawals, custody legs, attestations, and transfers are invisible to admins — the most legally significant events in the system are missing from the log that exists to surface them.

**Effort:** 1 day. **Reuses:** `loadChainEvents`, the existing category/severity synthesis.

### 1.4 Withdrawal impact preview

Before a performer withdraws, show exactly what stops: which licences, which vendors, which pending uses — and what stays lawful, because §39 and Art 7(3) both say past in-scope use is not undone. Turns the scariest button in the product into the most reassuring one.

**Effort:** 2 days. **Reuses:** `lib/compliance/enforce.ts`, `consentRecords`, the §5 copy already in `lib/consent/document.ts`.

### 1.5 Negotiation redline

`licenceNegotiations` already stores every proposed scope, fee, and comment per round. Render "what changed in round 3" as a diff rather than a list of full positions the reader has to compare by eye.

**Effort:** 1–2 days. **Reuses:** `lib/consent/negotiation.ts`, the receipt's granted/withheld partition.

### 1.6 Standing-instruction auto-answer

`standingInstructions` exists (`always` / `case_by_case` / `never` per use category) and the consent document ignores it. Pre-untick against a `never`, badge it — *"your standing instruction is never for §39G; we have unticked it"* — and flag any override to the agent.

**Effort:** 1 day. **Reuses:** `lib/consent/standing-instructions.ts`.

---

## Phase 2 — Differentiators

### 2.1 ~~Leak trace-back~~ — **shipped, see 0.10**

One follow-up is worth naming, because the shipped version has a real limit: the watermark route needs the payload to have been recovered already. `POST /api/admin/geometry-fingerprints/detect` does that, but it requires a `packageId` up front — which is precisely what you do not have when a file turns up in the wild.

**2.1a — blind watermark detection.** Run a suspect file against every issued fingerprint rather than one package's. Expensive (it streams each candidate original from R2 to establish vertex indices), so it needs a narrowing step first — file size, vertex count, or a talent hint — before it fans out. Until that exists, the watermark route is only usable when the investigator can already guess the package, and the content-hash route carries most of the practical load.

**Effort:** 3–4 days.

### 2.2 Comprehension telemetry

Record scroll depth, per-section dwell, and total time-on-document into `consentAcceptances`. The receipt then states: *document displayed for 4m 12s; all five sections viewed; §39G section viewed for 38s before confirmation.*

Consent litigation turns on **informed**, not just given. This attacks that directly and cheaply, and I have not seen another platform in this space attempt it. Design carefully: it is telemetry about a person under legal pressure, so it must be disclosed in the document itself, retained as aggregate durations rather than an event stream, and never used to nudge.

**Effort:** 2–3 days.

### 2.3 External anchoring

Publish a daily signed Merkle root over all chain tips to somewhere append-only and public. This is the difference between *"we say we didn't backdate"* and *"you can prove we didn't."* Without it, a party who distrusts the platform has to trust the platform's own database — which is exactly the reader this whole pillar is built for.

**Effort:** 3–5 days, plus a decision on the anchor target.

### 2.4 Litigation bundle export

One ZIP: custody record, every consent receipt, the licence contract, the compliance certificate, and a manifest with hashes of each. `lib/compliance/evidence-pack.ts` already does a version of this for insurers — generalise it and give it a front door.

**Effort:** 2–3 days.

### 2.5 Two-party custody handoff

`transfer.requested` / `transfer.approved` exist but are single-sided. Promote them into a genuine custody leg with a countersigned attestation from the receiving organisation, so a handoff has two signatures on the ledger rather than one assertion.

**Effort:** 3–4 days. **Reuses:** `lib/compliance/transfers.ts`, `lib/compliance/attestations.ts`.

### 2.6 Per-performer lifetime custody

The `talent:{id}` chain is now included in package records (0.3) but has no view of its own. A performer's whole likeness history across every production, in one record, is a thing no agent can currently produce for a client.

**Effort:** 2–3 days.

---

## Phase 3 — Longer horizon

| # | What | Why it matters | Notes |
|---|---|---|---|
| 3.1 | **Guardian co-consent for minors** | Two-party attestation, both chained. A live SAG concern with essentially no tooling anywhere. | Needs a legal read on who may consent for a minor per territory before build. |
| 3.2 | **Consent expiry + one-click re-consent** | `validFrom`/`validTo` exist and nothing acts on them. Nudge at T-30, mint a fresh ledger event on renewal. | Pairs with 1.4. |
| 3.3 | **Locale-versioned documents** | Store the language version shown alongside `documentVersion`. A performer who consented in a language they don't read has an obvious argument. | Directly relevant to the §39D dubbing clients. |
| 3.4 | **Consent-scope enforcement receipts** | Surface `use.metered` / `use.blocked` back to the performer: *"3 uses matched your consent, 1 was blocked."* Closes the loop from consent to enforcement. | `lib/compliance/enforce.ts` already emits both. |
| 3.5 | **Live custody panel** | Who can reach this scan *right now* — open access windows, next expiry, active grants. The record is retrospective; this is the present tense. | `accessWindows`, `bridgeGrants`. |
| 3.6 | **Access anomaly flags** | Unusual geo, out-of-hours, first-seen device, marked inline in the record rather than in a separate alerting system. | `downloadEvents.ip` / `userAgent`, `bridgeEvents`. |
| 3.7 | **Read-aloud consent document** | Accessibility, and a strong answer on informed consent for performers who don't read easily. | Record in the acceptance that the audio version was used. |

---

## Sequencing recommendation

Durable appends (0.8–0.9) and leak trace-back (0.10) are done. What follows, in order:

1. **2.1a — blind watermark detection.** Trace-back's content-hash route works today; the watermark route only works when you can already guess the package. Closing that is what makes the feature hold up when the file has been re-exported, which is the case that actually arises.
2. **1.3 — admin audit reads the ledger.** One day. Consent grants, withdrawals, custody legs and transfers are still invisible in the admin audit log, which is the log that exists to surface exactly those.
3. **1.6 — standing-instruction auto-answer**, then **1.4 — withdrawal impact preview.** Both make the consent surface act on data it already holds.
4. **2.3 — external anchoring**, when there is an external party who needs to distrust us and be satisfied anyway. This is also the point at which periodic chain verification becomes worth revisiting: anchoring gives a monitor something independent to check against, which on its own it does not have.

Everything else can follow demand.

---

## Related specs

- [`INSURER-OVERSIGHT-SPEC.md`](./INSURER-OVERSIGHT-SPEC.md) — the insurer consumes exactly this evidence; 2.4 is its natural export format.
- [`RSL-CONSENT-REGISTRY-SPEC.md`](./RSL-CONSENT-REGISTRY-SPEC.md) — machine-readable consent; the receipt is the human-readable counterpart of the same record.
- [`CAST-CONSENT-CONVERSION-SPEC.md`](./CAST-CONSENT-CONVERSION-SPEC.md) — the guest-acceptance path whose ledger replay 0.7 surfaces as "ledger entry pending".
- [`../docs/brand-refresh-spec.md`](../docs/brand-refresh-spec.md) — the token system 0.1 extends into print.
