-- Takedown submissions: every platform report we send, one row.
--
-- We do not automate the submission itself yet — Meta accepts email at
-- ip@instagram.com for IP/likeness complaints, so the first cut sends a
-- pre-built letter via Resend and records the send here. A future headless
-- form-poster becomes another row of the same shape.
--
-- enforcement_authorization_on_file gates the send: Meta will reject a
-- takedown filed by anyone other than the impersonated person or their
-- authorised agent. That authorisation is a signed document + ID scan the
-- talent provides during onboarding; admin flips this bit once the paperwork
-- is on file. We refuse to file without it, because a rejected report
-- teaches Meta's classifier that our sender is noise.

ALTER TABLE talent_profiles ADD COLUMN enforcement_authorization_on_file INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS takedown_submissions (
  id TEXT PRIMARY KEY,
  hit_id TEXT NOT NULL REFERENCES likeness_hits(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,             -- instagram | tiktok | youtube | x
  method TEXT NOT NULL,               -- email | form (v1 is email-only)
  recipient TEXT NOT NULL,            -- e.g. ip@instagram.com
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,            -- exact letter that was sent, for audit
  sent_by TEXT NOT NULL REFERENCES users(id),   -- admin who authorised
  sent_at INTEGER NOT NULL,
  -- Reply-tracking. Populated later when we get a case reference from Meta
  -- (either from a reply email or via a manual admin update).
  platform_reference TEXT,
  platform_status TEXT NOT NULL DEFAULT 'submitted',  -- submitted | acknowledged | actioned | rejected
  platform_status_updated_at INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS takedown_submissions_hit_idx
  ON takedown_submissions (hit_id);
CREATE INDEX IF NOT EXISTS takedown_submissions_talent_idx
  ON takedown_submissions (talent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS takedown_submissions_status_idx
  ON takedown_submissions (platform_status, sent_at DESC);

-- The recipient address per platform. Editable from /admin/monitor so a wrong
-- address does not need a code commit, and so we can swap ip@instagram.com for
-- a Meta agent's direct address once we have one.
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('takedown_email_instagram', 'ip@instagram.com', unixepoch());
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('takedown_email_facebook', 'ip@fb.com', unixepoch());
