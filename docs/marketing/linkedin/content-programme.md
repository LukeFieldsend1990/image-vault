# Image Vault — LinkedIn Content Programme

A post bank built from the real build history (490 PRs across `image-vault` and `changling-vault-bridge`, 2 Apr – 7 Jul 2026), the Notion strategy docs, and the shipped product. Designed to sustain months of presence: nine recurring series plus long-form articles, ~120 post ideas, each with a hook, an angle, and a suggested image from `./images/`.

---

## 0. Voice, guardrails, and how to use this

**Voice.** Building in the open, candid, technically literate, industry-fluent. The house rule from the UTA crib sheet applies to marketing too: *"be the most honest person at the table — overclaiming kills the deal; candour wins it."* Short paragraphs. Concrete numbers. No hype words ("revolutionary", "game-changing").

**Hard guardrails — never violate:**
- **Never** describe the platform as *zero-knowledge*, *zero-trust*, or *end-to-end encrypted*. The sanctioned framing: server-mediated, secured by access control — dual-custody 2FA, time-limited tokens, vault lock, audit ledger — plus AES-256 at rest and TLS 1.3 in transit. (There is even a great post in *why* we dropped those claims — B2.)
- **Bridge honesty:** it is *cooperative-agent custody + audit + attestation*, not hardware DRM. Say "we make misuse logged, attributable, and detectable", never "copy-proof".
- **Likeness Monitor honesty:** adjudication, alerting and triage are live; the public-platform crawler is currently simulated. Frame as "how we designed it" until the Apify/Rekognition stage ships.
- **No implied endorsements.** SAG-AFTRA and Equity have not endorsed the platform. We *map to* Article 39; we are not *approved by* the union. Same for agencies: United Agents is a design partner aesthetic, not a client claim.
- **Demo stills carry fictional data with real names** (Warner Bros., Channing Tatum, EA Sports FC, Nike, Blade Runner 3). Before posting any `demo-*.png`, either crop those names out or caption clearly: *"Product demo — fictional example data."* Never let a screenshot imply a client relationship.
- Speak of performers as rights-holders, never as "assets". The scan is the asset; the person owns it.

**Terminology to use consistently** (it compounds into brand vocabulary): dual-custody download · tamper-evident hash-chained ledger · strike lock · scrub attestation · standing instructions · stoplight consent posture · Render Bridge · geometry fingerprinting · monitoring-reference licence · metered royalty keys · consent document · "Your likeness. Your terms."

**Cadence.** 4–5 posts/week sustains presence without flooding: one Building-in-the-Open, one Article 39/Union post, one Three Chairs, one design/technical post, one commercial/positioning post. Long-form article every 2–3 weeks. Rotate series so consecutive days never repeat a format.

**Formats.** `[T]` text post · `[TI]` text + single image · `[C]` carousel (use deck slides / sequential explainer frames) · `[A]` LinkedIn article.

---

## 1. The spine — the real build timeline

Everything chains back to this. Reference it in posts ("Week 3 of the build…", "PR #121 was the day we…"):

| Phase | When | What shipped |
|---|---|---|
| 0 | pre-April | Auth + TOTP, vault, licence lifecycle, dual-custody download, pipeline, desktop CAS Bridge |
| 1 | 2–5 Apr (#1–19) | Hardening, audit log, first AI layer with per-call cost tracking |
| 2 | 6–9 Apr (#20–37) | Inbound email + AI triage + the skill system |
| 3 | 12–18 Apr (#38–63) | Custody fixes, semantic search, placeholder licences, **scrub attestations** |
| 4 | 27 Apr–12 May (#64–104) | Multi-agency prep, organisations, first animated demo |
| 5 | 12–15 May (#105–120, bridge #2–11) | **Render Bridge** — enforcement on the licensee's own render farm |
| 6 | 15–31 May (#121–127, #158–181) | **Geometry fingerprinting** + the streaming saga |
| 7 | 18 May–4 Jun (#128–157, #182–197) | **The SAG-AFTRA pivot**: royalty meter + hash-chained compliance ledger |
| 8 | 4–13 Jun (#198–260) | Production cast onboarding, Higgs vignettes, **admin MCP server** |
| 9 | 13 Jun (#261–271) | The industry graph: vendors, transfers, watcher roles — in one day |
| 10 | 15–19 Jun (#272–310) | Union + insurer oversight, Equity regime, **OpenNext migration** |
| 11 | 20–27 Jun (#311–409) | Guided onboarding, **negotiable §39 consent documents**, org graph |
| 12 | 28 Jun–7 Jul (#410–475) | **RSL / machine-readable consent**, Likeness Monitor, security sweep, imagevault.ai launch |

---

## 2. Series A — "Building the Vault" (building in the open, chronological)

The flagship chain. Number them (Build Log 01, 02, …) so followers can binge backwards. Each post: what we built, why, what it means for the industry. ~2 per week.

**A1 · Why we started with a terabyte of someone's face** `[TI · explainer-t004.png]`
Hook: *"A modern scan package is 200 GB to a full terabyte. It is someone's face, body, and movement — and until now it lived on whatever drive the production left it on."*
Angle: the origin problem. Scans are now standard on major productions; the performer has no visibility after wrap. Introduce the vault as the canonical archive. End: "This series is the whole build, PR by PR, back to PR #1."

**A2 · PR #1 was a password reset** `[T]`
Hook: *"Our PR #1 wasn't a feature. It was a password-reset flow."*
Angle: unglamorous truth of building trust infrastructure — before anything clever, the boring parts must be right: recovery, sessions, mandatory 2FA for every role. Security products earn the right to be interesting later.

**A3 · The audit log that silently dropped writes** `[T]`
Hook: *"Week one, we discovered our audit log was quietly losing entries. For a chain-of-custody product, that's an extinction-level bug."*
Angle: PR #2 — edge runtimes terminate before async writes land; `ctx.waitUntil()` fixed it. Lesson: an audit trail you can't trust is worse than none. Sets up the later hash-chained ledger arc.

**A4 · Dual custody: no single human can release a likeness** `[C · deck-slide-4.png, demo-talent stills]`
Hook: *"No file leaves the vault unless two different people, on two different sides of the deal, each pass 2FA."*
Angle: the signature mechanism — licensee initiates with TOTP, talent/rep authorises with theirs, a time-limited token releases exactly one download, every byte logged. "Structural, not policy."

**A5 · The AI layer we capped at $1 a fortnight** `[T]`
Hook: *"Our production AI budget is $1.00 per 14 days. Hard ceiling. Enforced in code."*
Angle: every AI call cost-logged, budget-gated, with a free fallback model; features degrade gracefully to zero AI. The anti-hype AI story — judgement, not spend.

**A6 · We gave the inbox a threat model** `[TI · product-platform.png (inbox section crop)]`
Hook: *"Licensing enquiries arrive by email. So do social-engineering attempts. Our inbox treats every message as hostile until proven otherwise."*
Angle: AI triage into 11 categories, entity extraction, risk flags — prompt injection, spoofed senders, pressure tactics — flagged in red before anyone replies.

**A7 · Emails that become one-click actions** `[T]`
Hook: *"An enquiry arrives → it's classified → the right action appears, pre-filled → a human reviews and clicks Run."*
Angle: the skill system (PR #32) — typed, self-describing tools suggested by triage category, executed under the user's own permissions. We built MCP-style tooling two months before wiring in actual MCP.

**A8 · Deals close before scans exist** `[T]`
Hook: *"Real production deals don't wait for files. So our licences can exist before the scan does."*
Angle: placeholder `AWAITING_PACKAGE` licences (PR #55) — deal-first, scans-later; auto-advances when the package lands. Product shaped by how the industry actually works.

**A9 · A licence should end with proof, not silence** `[TI · explainer-t064.png]`
Hook: *"What happens when a likeness licence expires? On most productions: nothing. Nobody deletes anything."*
Angle: the wind-down loop (PR #58, #61) — expiry/revocation → immediate bridge purge → 14-day scrub period → formal scrub attestation, or escalation. "Trust, but get it in writing that the data is gone."

**A10 · We put an agent on the render farm** `[TI · deck-slide-6.png]`
Hook: *"Licence revoked at 14:02. Files deleted from the vendor's render share at 14:02:30 — by our agent, on their infrastructure."*
Angle: Render Bridge (phase 5) — the project grant is the single source of truth; anything on disk not in the grant is unlicensed and gets deleted. Enforcement follows the file.

**A11 · The 48-hour question** `[T]`
Hook: *"If the render farm loses internet, should it keep serving licensed scans — or destroy them?"*
Angle: the offline-grace trade-off — a blip shouldn't nuke licensed content; a days-dark agent shouldn't keep serving possibly-revoked files. Our answer: 48 hours of grace, then defensive wipe. Invite debate: where would you draw it?

**A12 · Invisible watermarks in a million-vertex mesh** `[T]`
Hook: *"Move 640 vertices by two hundredths of a millimetre and you've signed a 3D scan — invisibly, permanently, per licensee."*
Angle: geometry fingerprinting (PR #121) — HMAC-derived bits embedded as sub-tolerance displacements; leaked mesh → confidence-ranked attribution to the exact licence. "We logged the download" becomes "we can name the leaker."

**A13 · Processing 3 GB scans in 128 MB of memory** `[T]`
Hook: *"Our watermarker gets 128 MB of RAM and 30 seconds. The files are 3 GB. Here's how that works anyway."*
Angle: the streaming saga (#158–181) — range reads, checkpointed resumable passes, client-side vertex extraction. Engineering-audience credibility post.

**A14 · The day the union agreement changed our roadmap** `[TI · deck-slide-5.png]`
Hook: *"On 30 May we merged a PR with no code in it. It repositioned the whole company."*
Angle: PR #138 — the Article 39 strategic read. 39.A (no-scan replicas) erodes storage-as-moat; the durable position is the consent, audit, and royalty layer. Segue to Series D.

**A15 · A royalty meter that ticks per generation** `[TI · product-platform.png (royalties crop)]`
Hook: *"Generative AI broke the one-time licence fee. One licence can drive ten thousand generations."*
Angle: royalty source keys, per-use webhooks, server-side splits, a live-ticking Royalty Hub. A likeness earns continuously, not once.

**A16 · A ledger where every event seals the one before** `[TI · deck-slide-3.png]`
Hook: *"Our compliance ledger can't be quietly edited. Not by a producer. Not by us."*
Angle: append-only hash chain; revocation is a new event, never a deletion; certificates sealed with the ledger tip hash. Disputes settled by evidence, not memory.

**A17 · One click, one compliance certificate** `[TI · demo-production-s4.png (caveat: demo data)]`
Hook: *"Under the 2026 agreement, productions have to evidence digital-replica compliance. Today that evidence lives in PDFs and inboxes."*
Angle: the Article 39 certificate — obligations walked clause-by-clause, met/gap per clause, sealed. Compliance reviews in minutes.

**A18 · Cast a whole production without typing an email** `[TI · demo-production-s2.png (caveat)]`
Hook: *"We watched a producer try to onboard 40 cast members. Step one was a spreadsheet of emails nobody had."*
Angle: link a production to its public cast list, pre-populate everyone, missing emails become a self-healing backlog — agent invites, auto-claim on signup. Zero emails typed as the happy path.

**A19 · We gave an AI admin hands — and made it use 2FA** `[T]`
Hook: *"Our AI assistant can lock downloads and kill sessions. Every single mutation demands a fresh 6-digit TOTP code from a human."*
Angle: the admin MCP server (PR #250) — hashed scoped tokens, per-call TOTP on anything mutating, full audit with secret redaction. Dual custody extended to AI agents.

**A20 · One day, seven PRs, a whole industry graph** `[T]`
Hook: *"June 13: producers, VFX vendors, sub-vendors, scan companies, unions and insurers each got their own scoped, revocable place in the system. In one day."*
Angle: the industry migration (#261–271) — likeness data moves through an ecosystem, not a pair; model the ecosystem. Highlight the read-only union/insurer watcher role.

**A21 · Route #288 broke our deploys** `[T]`
Hook: *"Growth bug: at route #288 our deploy artifact hit a hard 25 MiB platform limit. Every new feature made the product undeployable."*
Angle: the OpenNext migration (PR #308) — 288 route functions → one 2.35 MiB Worker. Numbers-driven infra story, zero downtime, no data migration.

**A22 · Consent became a negotiation, not a checkbox** `[TI · explainer-t044.png]`
Hook: *"A performer unticking one line of a consent request isn't a rejection. It's a counter-offer. Our system finally treats it that way."*
Angle: the §39 consent document (#393–409) — producers request by use category, performers confirm or counter, reps pre-negotiate, every round versioned on the ledger.

**A23 · We taught the vault to speak to AI crawlers** `[TI · deck-slide-6.png]`
Hook: *"An AI company's crawler just negotiated a likeness licence with one of our talent profiles. No human on our side touched it — by design."*
Angle: RSL + stoplight posture (PR #410) — red denies, green auto-grants at the talent's rate card, amber routes to a human; granted requests become real metered licences. Consent for the AI web, on the performer's terms.

**A24 · 490 PRs, 14 weeks: what we'd tell ourselves at PR #1** `[C · deck slides recap]`
Hook: *"Fourteen weeks ago this was a password-reset PR. Here's the whole arc — and the three decisions that mattered most."*
Angle: retrospective — (1) audit-first paid off when compliance became the product; (2) the union agreement was a plot twist we could absorb because consent was already an event stream; (3) honesty about what we're *not* (zero-knowledge, hardware DRM) kept us credible. Launch announcement energy; links back through the series.

---

## 3. Series B — "Design Decisions" (the choices behind the build)

Engineering/product-audience posts. One per week. These earn trust precisely because they admit trade-offs.

**B1 · We deleted our best buzzword** `[T]`
PR #249: dropping zero-knowledge. A forgotten passphrase would put an irreplaceable terabyte one bad day from permanent loss — and our users are actors, not cryptographers. Security by ceremony and audit, not cryptographic theatre. (This is the single most differentiating candour post — pin it.)

**B2 · The backdoor with a timer** `[T]`
We built talent "pre-authorisation" so VFX teams could pull files during a shoot. Then we admitted what it was: a backdoor with a timer. Replaced with Access Windows — opened by a talent 2FA ceremony, capped at 90 days, every download notified, instantly closable. Metaphor: a hotel safe with a receipt for everything taken out.

**B3 · Perfect DRM is a lie, so we didn't build it** `[T]`
The Bridge spec's honest non-goal. A determined insider can copy a file before expiry — no vendor can stop that. What you can do: make every access logged, attributable, tamper-reported, and contractually attested. Custody + evidence > copy-proof fantasy.

**B4 · The field we killed: a `vendorId` post-mortem** `[T]`
We shipped a speculative `vendorId` that forced users to invent placeholder values. We deleted it. Lesson on removing vestigial abstractions instead of documenting around them.

**B5 · Why our admin list is hardcoded in the repo** `[T]`
Admin is a whitelist in code — changing it requires a commit and a deploy, on the record. A compromised cloud login can't quietly mint an admin. Sometimes the most secure config store is version control.

**B6 · Boring tech is a security feature** `[T]`
Notifications are DB rows polled every 60 seconds. No WebSockets. SQLite at the edge. The excitement budget is spent where it matters: custody mechanics. Boring everywhere else is how you avoid 3am surprises with someone's biometric data.

**B7 · The 4096-byte false alarm** `[T]`
Bridge #12: 95 tamper alerts, all exactly multiples of 4096 bytes — ext4 vs APFS block alignment, not tampering. Tuning a tamper detector means hunting false positives as hard as true ones, or people stop believing alarms.

**B8 · Six licence types instead of infinite contracts** `[TI · product-features.png]`
Commercial, film double, game character, AI avatar, training data, monitoring reference. A controlled menu turns bespoke negotiation into a product — and makes "training data" a category you must *explicitly* touch, never a rider buried in clause 47.

**B9 · AI training is off by default — structurally** `[T]`
`permitAiTraining` can only be switched on by the talent. There is no request path that creates it. Consent that can't be manufactured by the requesting side is a schema decision, not a policy.

**B10 · Every scene in our demo is fake, deliberately** `[TI · demo-rep-s1.png (caveat)]`
Why the product tour runs on fictional data: you cannot demo a privacy product on real people's biometrics. Meta-post that also inoculates against "is that a real client?" questions.

---

## 4. Series C — "Three Chairs" (same topic; Talent, Rep, Industry views)

The triptych format: three posts on consecutive days, same topic, different chair. Tag them (1/3 Talent · 2/3 Rep · 3/3 Production). Eight topics = 24 posts. Each below lists the three hooks.

**C1 · The scan itself**
- *Talent:* "You were scanned on your last three productions. Do you know where any of those files are right now?" — after wrap the deal ends but the data doesn't; a vault makes it yours. `[explainer-t008.png]`
- *Rep:* "Your client list is also a catalogue of unaccounted-for biometric data." — roster-wide visibility: one desk, every scan, every licence. `[demo-rep-s1.png (caveat)]`
- *Industry:* "Productions don't actually want to hold performer biometrics. It's pure liability." — clean chain of title, sourced from the rights-holder, evidence attached. `[demo-production-s1.png (caveat)]`

**C2 · Dual-custody release**
- *Talent:* "Nothing of yours moves unless *you* (or your chosen rep) press the second key." `[deck-slide-4.png]`
- *Rep:* "Delegated authority without delegated risk — you authorise with your own factor, on the record, under standing instructions your client set."
- *Industry:* "Two-key release protects buyers too: nobody can later claim the file walked out the back door. Your download has a receipt."

**C3 · The strike lock**
- *Talent:* "If your union calls a strike, your digital double doesn't cross the picket line. One switch freezes every covered use." `[deck-slide-5.png]`
- *Rep:* "Strike compliance across your entire roster used to mean phone calls. Now it's scope-level: agency, production, or licence."
- *Industry:* "A strike lock that returns machine-readable refusals means your pipeline fails cleanly and compliantly — not quietly and expensively."

**C4 · The royalty meter**
- *Talent:* "Your likeness can now earn while you sleep — per generation, per render, with your split computed server-side." `[explainer/product royalties crop]`
- *Rep:* "Usage-metered licences change what 'commission' means: recurring flow, live dashboards, automatic agency splits."
- *Industry:* "Per-use pricing lets you license a likeness for exactly what you need — a thousand generations, not a lifetime buyout."

**C5 · The consent document**
- *Talent:* "Employment consent and AI-replica consent are separate signatures. You can say yes to the job and no to the replica." `[explainer-t044.png]`
- *Rep:* "Your client unticking a use category is a counter-offer, and the system treats it as one — versioned, negotiable, on the ledger."
- *Industry:* "Six use categories, plain-English descriptions, and a consent record you can produce in one export when legal asks."

**C6 · Standing instructions**
- *Talent:* "Always via my agent. Case by case, ask me. Never. Three rules, set once, enforced by the system — including the 'never'."
- *Rep:* "Standing instructions turn your inbox from an approval bottleneck into an exceptions queue."
- *Industry:* "Requests route themselves to whoever can actually say yes — fewer weeks lost to 'waiting on talent'."

**C7 · The expired licence**
- *Talent:* "An expired scan can't be quietly reused. When the licence ends, access ends — and deletion is attested in writing." `[explainer-t064.png / t060]`
- *Rep:* "Renewals become one click and expiries become alerts — no more spreadsheet of dates nobody owns."
- *Industry:* "Scrub attestations protect the production: provable deletion is your defence when the rights question resurfaces in three years."

**C8 · The deepfake problem**
- *Talent:* "Someone is generating videos with your face. Monitoring shouldn't require handing a monitoring company production rights." (monitoring-reference licence + likeness monitor; honest about crawler status)
- *Rep:* "Anomaly alerts and misuse triage give you something concrete to do in the worst hour of your client's week."
- *Industry:* "Provenance cuts both ways: proving your production's replica use *was* consented is the mirror image of catching the one that wasn't."

---

## 5. Series D — "Article 39, Decoded" (SAG-AFTRA 2026 series)

The July 2026 news hook — the agreement is now in effect and production offices are scrambling. Expert-source tone (pairs with the press pitch "SAG's AI rules are now live — nobody's ready"). One per week; each post: what the clause says (plain English), what it means for each side, what evidencing it looks like. Caveat every post: *SAG-AFTRA jurisdiction; UK readers see the Equity track.*

- **D1 · Article 39 in five minutes** — the map post: replicas, consent, security, transfers, training data. `[C · deck-slide-5.png + certificate still]`
- **D2 · 39.B — consent to the digital replica** — informed, specific, per-use consent; why a signature in a deal memo isn't enough anymore; California voiding uninformed replica terms. `[explainer-t016.png]`
- **D3 · 39.A — the "no-scan" replica** — producers can build replicas from footage alone. The honest post: this weakens every "we hold the file" security pitch, including ours — which is why consent + audit, not storage, is the durable layer. (High-credibility candour.)
- **D4 · 39.C — every ICDR use is a billable event** — replica minimums and residuals meet the royalty meter; what "metering" means in practice.
- **D5 · 39.D — dubbing consent went per-language** — a consent transaction most productions don't have a system for; per-language, per-territory records.
- **D6 · 39.E — biometric data doesn't belong in producer custody** — isolation obligations; the argument for a neutral third-party archive. `[deck-slide-7.png]`
- **D7 · 39.G — strike protection has a technical shape now** — what a strike lock is; why the freeze itself must be on the record. 
- **D8 · 39.H — "commercially reasonable" security, defined by evidence** — what a producer can actually point to: custody attestations, tamper telemetry, dual-custody logs.
- **D9 · 39.I — when replicas change hands** — transfer approval and escrow; the case for a union-visible transferee of record.
- **D10 · 39.L — the training-data loophole nobody's pricing** — producers may license performances for AI training on union notice; performers see no revenue share by default. The largest untapped pool in the agreement — and why an opt-in registry with talent-set pricing is the counterweight. `[deck-slide-2.png]`

---

## 6. Series E — "The Neutral Party" (positioning essays)

The moat argument, made repeatedly from different doors. One every 10 days.

- **E1 · Someone has to be Switzerland** — a studio can't custody likeness data (it's the counterparty); a single agency can't (it competes with the rest); a hyperscaler builds storage, not trust. The custodian must be neutral — and the first neutral mover sets the standard. `[deck-slide-7.png]`
- **E2 · We don't represent you. That's the point.** — no representation, no commission on your work, no training on your data. What "independent" concretely means, mechanism by mechanism. `[deck-slide-7.png]`
- **E3 · Not a safe. A gate.** — storage is table stakes; the product is the release mechanics: who may pass, under which licence, with what receipt. `[explainer-t024.png]`
- **E4 · Registry → Identity → Licensing → Provenance** — the four-layer infrastructure thesis; the vault was just phase one. `[deck-slide-1.png]`
- **E5 · The platform can't release your files either** — dual custody binds *us* too; plus every admin mutation needs a fresh human TOTP. Neutrality enforced in the mechanics, not the mission statement. `[deck-slide-4.png]`
- **E6 · Why we published our security model's limits** — linking B1/B3: cooperative DRM, server-mediated custody, simulated crawler. A neutral party you can't audit is just another counterparty.

---

## 7. Series F — "New Money" (commercial ideas & opportunity)

For talent, reps, and investors-adjacent readers. One per week.

- **F1 · The licence menu is a rate card** — six standard types with public fee bands (film double £50–300k, game character £100–500k, AI avatar per campaign…). Menus beat bespoke negotiation: faster deals, comparable data. `[product-features.png]`
- **F2 · Pay-per-use likeness is a new asset class** — metered keys, per-generation accrual, 80/10/10 talent/agency/platform splits. The shift from buyout to flow.
- **F3 · What's a fair fee? Now there's data.** — AI fee guidance benchmarked against real approved deals (min. 3 comparables, no names leaked); flagging below-market offers before signature.
- **F4 · Training data: from exposure to product** — the 39.L opportunity as commerce: opt-in registry, talent-set pricing, automatic union notice. £100k–£1M+ deal band.
- **F5 · The Micro-Licence experiment** — £500–£2,000 auto-approved, non-exclusive, 12-month licences for emerging talent: volume + a career ladder into the standard tiers.
- **F6 · Why an agency would buy seats for talent who can't pay** — the Roster Credit flywheel: subsidise emerging talent, auto-promote at revenue thresholds, duty-of-care as a roster-wide selling point.
- **F7 · The insurer wedge** — E&O and completion-bond underwriters grading productions off continuous consent/custody evidence (A–D grades, claims evidence packs). Compliance data as an underwriting signal is a business model, not a feature.
- **F8 · Vignettes only the vault can make** — AI pitch reels synthesised from exclusive scan previews are provably vault-origin; a casting pitch a Google-Images reference can't match — with `training: false` on every request.
- **F9 · The vendor channel** — scanning and VFX vendors carry custody liability today; "we deliver via the Bridge" de-risks them and onboards talent production-by-production. Distribution through liability relief.
- **F10 · What the AI companies get out of it** — the other side of the marketplace: verified consent, one integration, metered billing, no scraping-lawsuit exposure. Consent as a product AI buyers *want* to pay for.

---

## 8. Series G — "Union Desk" (what this means for the unions)

Respectful, never presumptuous — we build tools that make union terms enforceable; endorsement is theirs to give. Fortnightly.

- **G1 · The unions won terms. Enforcement is the sequel.** — 2023 won consent language; 2026 made it detailed; the gap is now operational: who checks, with what evidence? Neutral framing of the enforcement layer.
- **G2 · A watcher role with no keys** — union/regulator watchers get read-only, affiliation-scoped oversight and never touch the data plane. Oversight without custody.
- **G3 · What a strike means for a digital double** — 39.G made strike protection technical; walk through the lock mechanics. `[deck-slide-5.png]`
- **G4 · Two unions, one architecture** — SAG-AFTRA and Equity as pluggable compliance regimes (GDPR Article 9 and BIPA registered alongside); rights frameworks differ, evidencing machinery shouldn't.
- **G5 · The UK is not covered by Article 39** — the Equity/UK-GDPR/EU-AI-Act track; biometric data as special-category data; provenance under Article 50. (UK trade audience.)
- **G6 · Dear negotiating committees: ask for the ledger** — an open letter for the next negotiation cycle: consent as signed events, deletion as attestation, transfers with union visibility. Make evidence a contract term.

---

## 9. Series H — "Inside the Bridge" (VFX & pipeline audience)

Technical series for the vendor/pipeline crowd. Fortnightly; cross-post hooks into VFX communities.

- **H1 · The licence follows the file into Nuke** — DCCs talk only to a localhost bridge; signed manifests, verified hashes, rights info in the artist's panel. `[deck-slide-6.png]`
- **H2 · Signed manifests, verified locally** — P-256 signatures checked on-device against a pinned key: a compromised network path can't inject a forged grant.
- **H3 · The render share that cleans itself** — grant-omission-equals-purge; anything on disk not in the current grant is unlicensed and deleted. One heartbeat from revocation to deletion.
- **H4 · In-flight renders finish; new opens fail** — honest Windows/SMB purge semantics: enforcement lands at the next job, and that's the right trade-off. 
- **H5 · When the bridge tells on itself** — tamper, hash-mismatch, unexpected-copy events flow back to the talent's audit feed. The custody layer is also a sensor.
- **H6 · Org-scoped licences: how a whole facility works one deal** — organisation + production grants: any artist, any enrolled machine, one commercial agreement, revocation still instant.
- **H7 · Swift on Linux ate our heartbeats** — the DispatchQueue/URLSession and ISO8601 SIGTRAP war stories (bridge #2–3). Pure engineering-cred post.
- **H8 · What we tell vendors about liability** — holding performer biometrics is risk; consuming them through custody-aware delivery moves the liability to the mechanism designed for it.

---

## 10. Series I — "Consent for the AI Web" (RSL / machine-readable rights)

The forward-looking track; rides the Human Consent Registry news (launched 23 June 2026). Weekly while the news is warm, then fortnightly.

- **I1 · Red. Amber. Green.** — a performer's public, machine-readable consent posture; red by default; derived from their standing instructions, never hand-edited. `[deck-slide-2.png]`
- **I2 · robots.txt for a human being** — license.xml + .well-known discovery: the moment a person's likeness terms became crawlable. Big-idea post.
- **I3 · The crawler that asked permission** — walk through an amber OLP request becoming a real pending licence in the talent's normal approval queue. Machine-negotiated, human-decided.
- **I4 · Green means paid, not free** — auto-grant at the talent's rate card with a metered key; withdrawal revokes keys live. Consent and billing are the same rail.
- **I5 · Two keys before anything goes public** — talent opt-in AND admin approval; unlisted URLs; noindex. Publishing a consent posture is itself a consent decision.
- **I6 · Declaration needs enforcement** — the Registry (Blanchett et al.) made consent declarable; production-side systems must make it operational. Complement-not-competitor framing.
- **I7 · The AI company's compliance shopping list** — what a responsible likeness pipeline looks like from the buyer side: verified consent, licence scope, usage metering, revocation handling.
- **I8 · What if every rights-holder had a licence server?** — beyond actors: athletes, musicians, authors. The likeness rail as a template for consent infrastructure generally. (Thought-leadership close of the series.)

---

## 11. Long-form LinkedIn articles

One every 2–3 weeks; each synthesises a series arc and becomes the "canonical link" posts point back to.

1. **"Fourteen weeks, 490 pull requests: building likeness infrastructure in the open"** — the full Phase 0→12 story (Series A compressed), with the three inflection points: audit-first, the Article 39 pivot, opening to the AI web.
2. **"Article 39 is live. Here's what productions actually have to evidence."** — the compliance brief the sprint plan calls for; clause-by-clause obligations → evidence artefacts. (Publish first — it's the news hook.)
3. **"The case for a neutral likeness custodian"** — the Switzerland thesis in full: why every incumbent is conflicted, what neutrality means mechanically, who holds the keys.
4. **"Your likeness as an earning asset: buyouts, meters, and the new deal structures"** — Series F in essay form; fee bands, splits, metered licensing, training-data brokerage.
5. **"We deleted 'zero-knowledge' from our spec — and our security got more honest"** — the design-decisions essay (B1/B2/B3): threat models for humans, ceremony over theatre, publishing your limits.
6. **"DRM for a render farm: custody, not copy-protection"** — Series H in essay form for the VFX trade audience.
7. **"The consent stoplight: machine-readable likeness rights, explained"** — RSL/HCR/OLP for a general industry reader.
8. **"What the 2026 agreements mean for the unions' next decade"** — enforcement infrastructure, watcher roles, the training-data question; written as analysis, not pitch.

---

## 12. Image library (`./images/`)

| File | Use for | Note |
|---|---|---|
| `deck-slide-1.png` | Title/positioning posts (E4, A24) | "You negotiate the rights. The Vault enforces them." |
| `deck-slide-2.png` | Consent OS posts (C6, D10, I1) | Pillar 01 |
| `deck-slide-3.png` | Ledger/custody posts (A16) | Pillar 02 |
| `deck-slide-4.png` | Dual-custody posts (A4, C2, E5) | Pillar 03 |
| `deck-slide-5.png` | Article 39 / strike posts (D-series, G3) | Pillar 04 |
| `deck-slide-6.png` | Royalty/Bridge/RSL posts (A10, H1, A23) | Pillar 05 |
| `deck-slide-7.png` | Neutrality posts (E1, E2, C1-industry) | "A neutral custodian for likeness." |
| `deck-slide-8.png` | CTAs, launch posts | "The industry is scanning." |
| `explainer-t004/t008.png` | Origin-problem posts (A1, C1-talent) | "The deal ends. The data doesn't." |
| `explainer-t016/t020.png` | Article 39 consent posts (D2) | California/replica provisions card |
| `explainer-t024.png` | Positioning (E3) | "Not a safe. A gate." |
| `explainer-t032.png` | Vault-per-client posts | "One vault per client." |
| `explainer-t040/t044.png` | Consent-document posts (A22, C5) | separate-signatures deal memo |
| `explainer-t052.png` | Visibility posts (C1-rep) | "Every production, every vendor — visible to you, live." |
| `explainer-t060/t064.png` | Expiry/scrub posts (A9, C7) | "An expired scan can't be quietly reused." |
| `explainer-t080.png` | End card / launch posts | logo + tagline |
| `demo-talent-s1..s4.png` | Talent-view posts | ⚠ fictional data, real names — crop or caption |
| `demo-rep-s1..s5.png` | Rep-view posts | ⚠ same caveat (roster, revenue splits) |
| `demo-production-s1..s5.png` | Production/compliance posts | ⚠ same caveat (Article 39 dashboards) |
| `product-hero/features/how-it-works/security/cta/platform.png` | Product-tour posts | straight from imagevault.ai/product |
| `performers-full.png` | Performer-explainer posts | long scroll; crop sections |
| `deck.html` | Source for the slide images | edit + re-screenshot to iterate |

Regenerate any of these with the capture scripts in this folder's history (explainer frames: load `public/explainer/imagevault-explainer.html` in a browser and screenshot; deck: open `deck.html`; demo/product: run the app and capture `/demo` and `/product`).

---

## 13. A 12-week opening calendar (suggested)

| Week | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| 1 | **Article 2 (Art. 39 brief)** | A1 | D1 | C1-talent | C1-rep |
| 2 | C1-industry | A2 | D2 | F1 | E1 |
| 3 | A3 | G1 | C2 ×3 starts | B1 | A4 |
| 4 | **Article 5 (zero-knowledge)** | D3 | F2 | H1 | A5 |
| 5 | A6 | C3 ×3 starts | D4 | E2 | B2 |
| 6 | A7–A8 | G2 | F3 | I1 | **Article 3 (neutrality)** |
| 7 | A9 | D5 | C4 ×3 starts | H2 | B3 |
| 8 | A10 | I2 | F4 | G3 | A11 |
| 9 | **Article 1 (build story)** | D6 | C5 ×3 starts | H3 | B4 |
| 10 | A12–A13 | I3 | F5 | E3 | G4 |
| 11 | A14 | D7 | C6 ×3 starts | H4 | B5 |
| 12 | A15 | I4 | F6 | **Article 4 (earning asset)** | E4 |

Weeks 13+ continue the rotation; the remaining A/D/C/H/I/F/B/E/G stock covers ~26 weeks at this cadence before anything repeats.
