-- Secondary actors identified in a hit's media.
--
-- Deepfake concept trailers routinely feature 2-3 actors ("Anti-Venom (2027) —
-- Tom Hardy, Mads Mikkelsen, John Cena | Concept Trailer"). A sweep against one
-- talent surfaces the same media where a second protected talent also appears,
-- so this table lets the pipeline stack additional identifications against a
-- hit without re-processing it for every talent's sweep.
--
-- Two identification sources are supported:
--   * face_embedding — cosine match against an onboarded talent's reference
--     face embedding. Strong signal; produces a talent_id.
--   * vision_caption — a multimodal pass ("who else is in this image?") or
--     an offender's own caption/hashtags naming another public actor. May
--     match an onboarded talent (rare) or a TMDB result (usual case).
--
-- talent_id or tmdb_id is set; both may be set if we resolved an onboarded
-- talent through TMDB. Neither means the row is invalid — a check catches it.

CREATE TABLE IF NOT EXISTS hit_secondary_actors (
  id TEXT PRIMARY KEY,
  hit_id TEXT NOT NULL REFERENCES likeness_hits(id) ON DELETE CASCADE,
  talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tmdb_id INTEGER,
  tmdb_name TEXT,
  tmdb_profile_url TEXT,             -- cached image.tmdb.org URL so the UI avoids TMDB round-trips
  confidence INTEGER NOT NULL,        -- 0-100
  source TEXT NOT NULL,               -- face_embedding | vision_caption | manual
  detected_at INTEGER NOT NULL,
  CHECK (talent_id IS NOT NULL OR tmdb_id IS NOT NULL)
);

-- Look up a hit's secondaries when rendering the hit card.
CREATE INDEX IF NOT EXISTS hit_secondary_actors_hit_idx
  ON hit_secondary_actors (hit_id);

-- Given an onboarded talent, find every hit where they appear as a secondary.
-- Powers cross-monitor propagation ("Mads Mikkelsen appears in 7 hits currently
-- under Tom Hardy's monitor — surface them under his own monitor too").
CREATE INDEX IF NOT EXISTS hit_secondary_actors_talent_idx
  ON hit_secondary_actors (talent_id)
  WHERE talent_id IS NOT NULL;

-- Same, by TMDB id: catches repeat non-onboarded actors so we can flag high-
-- signal targets for outreach ("Ryan Reynolds appears in 40+ AI trailers, worth
-- reaching out to his team").
CREATE INDEX IF NOT EXISTS hit_secondary_actors_tmdb_idx
  ON hit_secondary_actors (tmdb_id)
  WHERE tmdb_id IS NOT NULL;
