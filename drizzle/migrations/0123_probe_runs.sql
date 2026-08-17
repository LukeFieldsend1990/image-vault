-- Model Probe Protocol — the first slice of training-data attribution.
--
-- The likeness monitor finds distributable likeness models (Civitai LoRAs,
-- named hosted checkpoints). These tables let an admin *interrogate* one:
-- generate a pre-registered set of images from it, score each against the
-- talent's vault reference set (Rekognition face similarity) and derivation
-- index (pHash), run the same generation against control identities, and
-- produce a sealed, reproducible "Likeness Encoding Report".
--
-- What this proves and does NOT prove is documented in
-- docs/training-attribution.md — read it before extending the scoring.

-- One probe run: a single interrogation of one target model.
CREATE TABLE IF NOT EXISTS probe_runs (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The monitor hit that prompted this run, when it started from one. Null for
  -- an explicit target typed by an admin. No cascade: losing the run history
  -- when a hit is cleaned up would be worse than a dangling id.
  hit_id TEXT REFERENCES likeness_hits(id) ON DELETE SET NULL,
  -- civitai_lora — a downloadable community model run by weights URL;
  -- hosted_model — a named foundation/hosted endpoint probed by name only.
  target_kind TEXT NOT NULL,
  -- Civitai "modelId@versionId", or a hosted model slug.
  target_ref TEXT NOT NULL,
  -- The probed artifact's own SHA-256 where the provider publishes one
  -- (Civitai exposes files[].hashes.SHA256). Locks *which* file was tested.
  target_file_sha256 TEXT,
  target_meta_json TEXT NOT NULL DEFAULT '{}', -- trainedWords, baseModel, publishedAt, downloadCount
  -- The full pre-registered design (prompts, seeds, control cohort, thresholds)
  -- captured at creation so the run is reproducible and the manifest is honest.
  protocol_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued', -- queued|generating|scoring|summarising|complete|failed
  -- Resumable-batch checkpoint: how many samples have been generated / scored.
  samples_total INTEGER NOT NULL DEFAULT 0,
  samples_generated INTEGER NOT NULL DEFAULT 0,
  samples_scored INTEGER NOT NULL DEFAULT 0,
  cost_estimate_usd REAL NOT NULL DEFAULT 0,
  cost_actual_usd REAL NOT NULL DEFAULT 0,
  manifest_r2_key TEXT,
  manifest_sha256 TEXT,
  verdict_json TEXT, -- the statistical summary once summarising completes
  seal_ref TEXT,     -- document_seals.ref for the sealed report
  error TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_probe_runs_talent ON probe_runs (talent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_probe_runs_status ON probe_runs (status, created_at);

-- One generated image and its scores. Every sample carries its exact
-- generation conditions so the report can show its work.
CREATE TABLE IF NOT EXISTS probe_samples (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES probe_runs(id) ON DELETE CASCADE,
  -- target             — actor name / trigger words (the condition under test)
  -- control_distractor — a matched fictitious name (scorer false-positive rate)
  -- control_baseline   — descriptors only, no name (model's default face)
  condition TEXT NOT NULL,
  condition_label TEXT,       -- e.g. the distractor name used
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  seed INTEGER NOT NULL,
  provider_prediction_id TEXT,
  r2_key TEXT,                -- probes/{runId}/samples/{sampleId}.png
  image_sha256 TEXT,
  rekognition_similarity REAL, -- 0-1, null = not measured (no face / error)
  rekognition_matches INTEGER,
  rekognition_unmatched INTEGER,
  phash_hex TEXT,
  phash_min_distance INTEGER, -- vs the talent's derivation index; <=16 = regurgitation
  status TEXT NOT NULL DEFAULT 'pending', -- pending|generated|scored|failed
  error TEXT,
  created_at INTEGER NOT NULL,
  scored_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_probe_samples_run ON probe_samples (run_id, condition);

-- Every billed generation/scoring call, one row — the same "real spend, not an
-- estimate" discipline as apify_usage, so the probe budget ceiling in
-- lib/probe/budget.ts is an actual limit rather than a guess.
CREATE TABLE IF NOT EXISTS probe_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES probe_runs(id) ON DELETE SET NULL,
  talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,          -- replicate | rekognition
  kind TEXT NOT NULL,              -- generation | face_compare
  units INTEGER NOT NULL DEFAULT 0, -- images generated / faces compared
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_estimated INTEGER NOT NULL DEFAULT 0, -- 1 when derived from unit counts
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_probe_usage_created ON probe_usage (created_at);

-- Probe scoring must run against clean, single-face references. `probe_grade`
-- marks a reference vetted for that use (frontal, one face, well-lit). 0 =
-- unvetted (default; a heuristic can promote face/vault_still rows), 1 = graded.
ALTER TABLE monitor_reference_images ADD COLUMN probe_grade INTEGER NOT NULL DEFAULT 0;
