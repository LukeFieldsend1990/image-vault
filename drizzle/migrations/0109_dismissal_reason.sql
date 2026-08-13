-- Structured dismissal reasons on likeness hits.
--
-- Before this, "Dismiss" was one button and every dropped hit looked the same
-- to admin. That flattens three different tuning signals into one:
--
--   * not_me    — pre-filter matched a lookalike / wrong person entirely.
--                 Signal: face embedding false positive when Phase 2 lands,
--                 or overly greedy hashtag matching before then.
--   * not_misuse — that IS them, but it's genuine content the scope was
--                  supposed to clear (press clip, archival, self-post).
--                  Signal: adjudicator's scope=ai_only floor is leaking.
--   * not_ai    — that IS them, being used without permission, but not AI-
--                 generated. Not what this monitor is scoped to catch, but
--                 the talent may still want to know about it — a future
--                 all_likeness scope will surface these separately.
--   * other     — free-text; the notes column captures the reason.
--
-- Persisted alongside the hit itself rather than in a separate table because
-- there is exactly one dismissal per hit and the join is always to the hit.

ALTER TABLE likeness_hits ADD COLUMN dismissal_reason TEXT;
  -- not_me | not_misuse | not_ai | other

ALTER TABLE likeness_hits ADD COLUMN dismissal_notes TEXT;
  -- populated when reason = "other"; may be null otherwise

-- Admin panel aggregates by reason to tune the pre-filter; the join is on
-- (status, dismissal_reason) and both are indexed already through the row
-- lookup, but the composite makes the group-by cheap enough to reload live.
CREATE INDEX IF NOT EXISTS likeness_hits_dismissal_idx
  ON likeness_hits (dismissal_reason)
  WHERE dismissal_reason IS NOT NULL;
