# Deepfake Detection — Architecture, Limitations, Roadmap

The likeness monitor (`lib/monitor/`) discovers candidate content on public
platforms, scores it with detector signals, and adjudicates with the AI layer.
This document records how the detection stack is layered, what each layer can
and cannot claim, and the known downsides we have accepted or deferred — so
decisions get revisited deliberately, not rediscovered.

## Detection layers

Each candidate carries four nullable signals (`lib/monitor/types.ts`); null
always means "not measured", never "low".

| Signal | What it proves | Source |
|---|---|---|
| `faceEmbeddingSimilarity` | The person shown is the talent | LLaVA verdict (default) or Rekognition vs the vault reference set |
| `syntheticMediaScore` | The media is AI-generated/modified | Embedded provenance markers + LLaVA artifact check (`lib/monitor/synthetic-check.ts`) |
| `perceptualHashDistance` | The media was derived from vault imagery | pHash index — **not yet built** |
| `geometryFingerprintCorrelation` | Licensed scan data was the source | Fingerprint bits watermarked into deliveries |

A flag requires likeness **and** synthesis/derivation evidence together. The
layers are deliberately independent: identity matching decays never, artifact
detection decays as generators improve, provenance markers depend on platform
behaviour, and fingerprint correlation is unforgeable but only covers licensed
deliveries.

## Vault-anchored reference set

`lib/monitor/reference-set.ts` indexes photographic stills from the talent's
scan packages as the face-match reference gallery (table
`monitor_reference_images`). Bytes stay in R2 and are presigned per sweep.
Coverage is scored into a talent-facing tier
(unanchored → baseline → anchored → fortified) with next-upload suggestions —
the incentive loop: more scans, measurably stronger detection.

### Known limitations and open questions

Recorded 2026-08 when the reference set shipped; revisit before scaling.

1. **The default configuration doesn't use the gallery.** The identity
   provider defaults to LLaVA, which is prompted with the talent's *name* and
   never sees reference images. Vault references only feed the Rekognition
   path (`identity_check_provider` in `aiSettings` + AWS credentials). Until
   that's flipped, the reference set changes the adjudicator prompt and the
   coverage card, not the matcher. Either surface the live provider on the
   card or close the gap before selling the tier.
2. **Unvetted gallery = false-positive risk.** References are picked by
   filename heuristics. A capture still with a technician or stand-in in
   frame can make the matcher "confirm" the wrong face at high confidence,
   feeding takedown workflows. The `rejected` status exists in the schema but
   nothing populates it yet — a sync-time face-presence/identity vetting pass
   is the missing piece.
3. **Mesh-only packages score "unanchored".** Packages with no photographic
   stills (mesh + texture + HDR only) contribute nothing, so a talent with
   premium scans can see the worst tier. Fixing this properly means rendering
   turntable stills from meshes in the pipeline worker — real compute, not
   yet scheduled.
4. **Cost is up on the paid path only.** Rekognition denials now cost up to 3
   compares (~$0.006/candidate vs $0.002); confirms early-exit at 1. A
   60-candidate sweep: ~$0.12 → ~$0.35 worst case. LLaVA path is free and
   unchanged.
5. **Biometric bytes leave the vault boundary.** Rekognition sweeps send scan
   stills to AWS. Talent consented to storage and licensed downloads, not
   explicitly to third-party face-API processing (GDPR special category /
   BIPA surface). Needs consent-language review in `lib/consent/` before the
   provider is enabled for real users.
6. **Scan stills aren't always the best references.** Neutral expression,
   studio lighting, and scan age can underperform a recent styled photo for
   matching heavily styled content. The TMDB photo stays in the gallery as a
   fallback source for this reason.
7. **Better "who", not "whether it's fake".** Reference anchoring sharpens
   identity, but synthesis evidence comes from the synthetic-check layer and
   text intent. The derivation claim (content built *from* vault files) needs
   the pHash index.
8. **The coverage score can overpromise.** "Fortified 100/100" is a statement
   about reference quality, not a detection guarantee — discovery is bounded
   by Apify budget, platform list and query vocabulary. Keep the card copy
   modest.

## Synthetic-media detection (`lib/monitor/synthetic-check.ts`)

Two-stage scoring of `syntheticMediaScore`, cheapest evidence first:

1. **Embedded provenance markers** — a byte-scan of the media for declared-AI
   metadata: the IPTC `trainedAlgorithmicMedia` digital-source type (what
   C2PA-compliant generators embed) and generator signatures (Midjourney,
   Stable Diffusion, Firefly, DALL·E, …). Deterministic and free. A hit is
   near-conclusive (score 0.95): the file itself declares it was generated.
   A C2PA/JUMBF manifest *without* an AI source type is recorded but not
   scored — content credentials also ship on authentic camera captures
   (Leica, Sony), so "has provenance" must never be read as "is AI".
2. **Vision artifact check** — analyst chosen per sweep:
   - **Claude Haiku vision** (primary when `ANTHROPIC_API_KEY` is set, the AI
     switch is on, and the $1/14-day budget has headroom; every call is
     cost-logged under feature `synthetic_check`). Returns a structured
     analysis: verdict + confidence, **generator-family attribution**
     (midjourney / stable-diffusion / flux / dalle / video-model /
     **face-swap** / other), and up to four specific observations
     ("blending seam at jawline") that flow into the adjudicator prompt and
     hit match signals — enforcement-grade rationale for takedown letters.
     Synthetic verdicts scale with confidence inside [0.6, 0.9]; a verdict
     the model itself flags as "plausibly genuine-but-filtered" is **not
     scored** — beauty-filtered real photos share the waxy-skin tell, and
     that false positive is the one this layer must never produce.
   - **LLaVA** (free fallback — no key, budget exhausted, or a Claude call
     failed). One-word verdict: synthetic → 0.8, authentic → 0.15,
     unsure → null (no reading; adjudicator falls back to text-intent
     evidence).
   Both are reasoning, not trained forensic classifiers — the caps (0.9 /
   0.8, always below the 0.95 a metadata hit earns) reflect that.

### Honest limits of this layer

- **Platforms strip metadata.** Instagram/TikTok/YouTube re-encode thumbnails,
  which usually removes XMP/EXIF/JUMBF. The marker scan pays off on
  direct-source files and less-aggressive CDNs; expect most social thumbnails
  to fall through to the artifact check. Do not read "no markers" as
  "authentic" — the code never does.
- **Artifact detection decays.** Every generator release closes tells. The
  uncanny-valley signal is a 2024-era edge that trends to zero as generation
  becomes imperceptible. That is why it is one layer, not the strategy.
- **Invisible watermarks are out of reach.** SynthID and similar are
  decodable only by their vendors' tooling; we cannot read them. If vendor
  detection APIs open up, they slot in as another marker source.
- **When artifacts go imperceptible**, the durable moats are the ones
  generic detectors can't copy: identity anchored to ground-truth vault
  captures, pHash derivation against source imagery nobody else holds, and
  geometry fingerprints in licensed deliveries. Artifact detection buys
  coverage today; provenance-by-possession is the endgame.

### Third-party classifiers (deferred)

A dedicated forensic model (Hive, Reality Defender, AWS detection APIs) would
outperform LLaVA on borderline content at per-call cost. The
`synthetic_check_enabled` setting and the provider pattern from
`identity-check.ts` leave room to add one as a paid tier without reshaping the
pipeline.

## Roadmap order

1. Vet the reference gallery at sync time (fixes limitation 2, uses `rejected`).
2. Surface the live identity provider on the coverage card (limitation 1).
3. pHash index over reference imagery → `perceptualHashDistance` (limitation 7;
   requires pixel decoding — the first real image-processing cost in a worker).
4. Turntable renders for mesh-only packages (limitation 3).
5. Consent-language review before enabling Rekognition broadly (limitation 5).
