# Training-Data Attribution — proving a model learned an actor's likeness

> **Status: Phase 1 shipped (Model Probe Protocol).** Phases 2–3 are roadmap.
> This document is the source of truth for what a probe run does, what its
> evidence proves, and — just as important — what it does **not** prove. Keep it
> current when you extend `lib/probe/`. It is the counterpart of
> `docs/deepfake-detection.md`: that one is about *finding* misuse in the wild;
> this one is about *interrogating a model* to build a payment claim.

## The prize

The platform already proves **release** (who received which vault bytes, when,
under what consent — sealed custody records, per-file SHA-256, per-licensee
geometry watermarks) and **derivation of imagery** (the pHash index catches a
repost or leak of a vault still). The missing piece is the model itself: showing
that a generative model has absorbed a talent's likeness and is generating value
from it — so the talent should be **paid accordingly**.

## Two claims, in ascending difficulty

Everything here hangs on keeping these apart. Conflating them is the single
easiest way to overclaim.

1. **"This model encodes the actor's identity."** Tractable today. Prompt the
   model with the actor's name / the model's own trigger words, generate a set
   of images, score their faces against the vault reference set, and compare
   against a control cohort generated under identical conditions. A target match
   rate well above the controls, with the difference unlikely to be chance, is
   evidence the identity was trained in. This is what Phase 1 builds.

2. **"It was trained on *the vault scans specifically*."** Hard, and only
   honestly claimable when the model reproduces content **unique to the vault** —
   a generated image that perceptually matches a never-published vault still or
   turntable render (regurgitation), or an unpublished look whose custody date
   predates the model version. Name→likeness fidelity alone never supports this,
   because it is fully explained by training on public photographs. Phase 1
   surfaces the regurgitation signal opportunistically; Phase 2 builds the rest.

## Phase 1 — the Model Probe Protocol (shipped)

### What a run does

An admin starts a run against a **Civitai LoRA** (from a monitor hit or an
explicit model id/URL) or a **hosted model** (a named endpoint). The run:

1. Resolves the target and locks its identity — for a Civitai model, the version
   id, the primary file's published **SHA-256**, and its trigger words
   (`lib/probe/civitai.ts`). The report can then name the exact file tested.
2. Freezes a **pre-registered protocol** (`lib/probe/protocol.ts`) — prompts,
   fixed seeds, the control cohort, and the match thresholds — *before* any image
   is generated, and stores it in the run manifest. Pure and deterministic, so
   the run is replayable.
3. Checks the estimated spend against a **dedicated probe budget**
   (`lib/probe/budget.ts`, `probe_budget_usd` in `ai_settings`) — separate from
   `callAi`'s $1/14-day ceiling — and refuses to start without explicit admin
   cost confirmation.
4. Generates and scores samples in the **pipeline worker** as a resumable
   `probe_batch` job (`pipeline-worker/src/probe.ts`): ≤8 samples per queue
   message, checkpointed in `probe_runs`, re-enqueuing itself until done. A
   mid-run failure loses at most one batch of paid generations.
5. Scores every sample two ways: **identity** via AWS Rekognition CompareFaces
   against the talent's *probe-grade* references, and **derivation** via dHash
   against the talent's pHash index (`lib/probe/score.ts`). Null always means
   "not measured", never "no match".
6. Hands off to the app-side **finalizer** (`lib/probe/finalize.ts`), which
   computes the verdict (`lib/probe/stats.ts`), writes a canonical manifest to
   R2, records **ledger events**, and **seals** a Likeness Encoding Report.

### The control cohort — why the number means anything

A raw face-similarity score is a vendor black box. The verdict is built on the
*difference* between conditions generated identically:

- **target** — the actor's name / trigger words.
- **control_distractor** — matched fictitious names, same prompts and seeds.
  Measures the scorer's false-positive rate under identical conditions.
- **control_baseline** — descriptors only, no name. Catches a LoRA that collapses
  *every* face to the actor, which would make the distractor control read falsely
  high.

The report shows the per-condition match rates, a two-tailed **Fisher's exact**
p-value (target vs pooled controls), the rate difference as the effect size, and
the seeds and thresholds — so a reader sees the comparison, not just a headline.

### Evidence integrity

- **Ledger events carry their own hashed timestamps.** The general ledger
  (`lib/compliance/ledger.ts`) hashes only `{chainKey, seq, eventType, payload}`;
  `createdAt`/`actorId` sit *outside* the hash. Because a probe claim turns on
  *when* the model was tested, `appendProbeEvent` (`lib/probe/ledger.ts`) folds
  the timestamp, actor, target hash and manifest hash **into the payload**, so
  `verifyChain()` protects them. The report cites the payload `at` field as the
  tamper-evident time — never the DB column.
- **Public verification.** The report is sealed as `probe_report` /
  `probe_run` and links to the unauthenticated `/verify/{ref}` page, so a
  licensing manager or opposing counsel can check the ledger hash without an
  account.

### What a Phase-1 report establishes — and what it does not

**Establishes:** that the tested model (named by file SHA-256 where published),
prompted with this identity, reproduces the talent's likeness above a control
baseline, under a fixed, reproducible protocol, with every artifact hashed and
chain-anchored.

**Does not establish:**

- **Training on the vault scans, from name-fidelity alone.** High
  name→likeness fidelity is fully consistent with training on public photos. Only
  a scan-membership signal (a pHash regurgitation, or a Phase-2 unpublished-look
  match) speaks to the scans themselves — and dHash detects reproduction, not all
  memorisation.
- **A forensic identification.** Rekognition similarity is a third-party score,
  meaningful here only *relative to* the control cohort.
- **A legal determination.** The output is a sealed, reproducible technical
  record suitable for supporting a licensing discussion or handing to counsel —
  not a verdict.

These honesty rules are encoded in the report copy itself (`lib/probe/report.ts`)
and mirror the platform's "not zero-knowledge / not zero-trust" discipline: the
claim is only ever as strong as the evidence on the page.

### Known limitations & open questions (Phase 1)

1. **Rekognition consent.** Sending vault biometric bytes to AWS is third-party
   biometric processing (GDPR special category / BIPA). Talent consented to
   storage and licensed downloads, **not** explicitly to face-API processing.
   Phase 1 ships with Rekognition enabled for probes and this review **deferred**
   (an accepted, documented decision) — a per-talent opt-in belongs here before
   broad rollout, tracked as a `consent`-family event on the talent chain.
2. **Reference vetting is heuristic.** `probe_grade` on
   `monitor_reference_images` gates which references score a run, but nothing
   auto-populates it yet — an admin (or a future sync-time face-presence pass)
   must set it. An unvetted gallery inflates the false-positive baseline.
3. **dHash is brittle.** JPEG/PNG only; defeated by crops, flips, heavy recolour.
   It under-detects memorisation, so absence of a regurgitation signal is **not**
   evidence the scans were not used. A second embedding-distance channel is a
   Phase-2 candidate.
4. **The provider is a black box.** The control cohort contextualises but does
   not cure vendor opacity. A self-hosted embedding model would remove the third
   party at the cost of infrastructure.
5. **LoRA provenance is unknown.** A Civitai LoRA titled with the actor's name is
   the misuse artifact, but the report cannot say what it was trained on. It says
   what the file *does*, by SHA-256.

## Phase 2 — scan-specific / memorisation evidence (roadmap)

- **Extraction protocol.** A protocol variant whose prompts are built from
  vault-unique context (turntable angles matching `derived-stills`, unpublished-
  look descriptors), scored primarily via pHash regurgitation. A generated image
  matching a *never-published* vault still is the strongest scan-membership
  evidence this system can produce.
- **Custody-date differential.** Report timeline of vault capture/seal dates vs
  the model version's `publishedAt`, with matches bucketed published vs
  unpublished. Only unpublished-look matches support the scan-specific claim.
- **Consent-posture section.** Fold in what already exists: §39G training
  withheld (`PERMISSION_DEFAULTS.training_data = "blocked"`), refused scopes in
  `licence_negotiations`, contract Clause 4.4, and the absence of any
  `training.notice_filed` event — the full shape of a payment claim.
- **Video models.** Exploratory, behind a protocol flag.

## Phase 3 — canaries + the "paid accordingly" product path (roadmap)

- **Watermark delivered imagery.** Extend past the `.obj`-only gate
  (`app/api/download/[token]/route.ts`) to JPEG stills/textures, reusing the
  per-licensee HMAC payload design (`lib/geo-fingerprint/payload.ts`). Two honesty
  tiers, kept separate: **provenance** (real — recipient attribution for leaked
  *files*, ships) vs **training-canary** (research only — current image
  watermarks do not reliably survive train→generate laundering, and the geometry
  watermark demonstrably does not survive render→train; log ground truth, make no
  product claims).
- **Claims pack v2.** Add a `probeRuns` section to
  `lib/compliance/evidence-pack.ts`; a positive verdict raises the linked
  `monitor_accounts` severity.
- **Evidence → outreach → retroactive licence.** A probe-aware outreach template
  (`lib/monitor/outreach-templates.ts`, `account_outreach` `purpose:
  "licence_offer"`) cites the public `/verify/{ref}` report link and offers a
  retroactive training licence; on conversion, hand off to the existing licence
  flow with a Clause 9.2 training addendum, metered via `usage_events` →
  `use.metered` (§39.C).

## Operational notes

- **Secrets** (pipeline worker): `REPLICATE_API_TOKEN`, `REPLICATE_MODEL_VERSION`
  (base/hosted), `REPLICATE_LORA_MODEL_VERSION` (a LoRA-runner accepting a `lora`
  url), `REPLICATE_PER_IMAGE_USD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`. Absent Replicate creds, the executor marks samples failed;
  absent AWS creds, the run measures derivation (pHash) only.
- **Budget**: `probe_budget_usd` in `ai_settings` (default $25 / 14-day window).
  Every billed call is a `probe_usage` row — real spend, not an estimate.
- **Cost**: ≈ $1–3 per run (~64 generations + ~$0.20 Rekognition), itemised and
  confirmed before spending.
- **Console**: `/admin/probe`.
