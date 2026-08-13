-- Outreach log for accounts we contact.
--
-- The eventual product is a licensing bridge: an account posting AI
-- content of a talent gets offered a revenue-splitting licence path
-- rather than a takedown. That negotiation happens on the platform's
-- DM surface (Instagram, TikTok) not through us — we cannot send DMs
-- programmatically. What we can do is compose the message, deep-link
-- the sender to the platform's compose window, and log that the
-- outreach happened so we know not to spam the same account twice.
--
-- purpose captures the pitch so we can measure conversion by pitch
-- shape: licence_offer converts higher on fan_fluff-classified
-- accounts than on takedown_request-classified ones, etc.
--
-- status is the free-text-ish state machine. Populated from
-- "Mark sent" and any subsequent admin notes. No PATCH endpoint for
-- responded/converted yet — the operator updates via the same
-- outreach row when the account replies.

CREATE TABLE IF NOT EXISTS account_outreach (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES monitor_accounts(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL REFERENCES users(id),
  method TEXT NOT NULL, -- dm | email | manual
  purpose TEXT NOT NULL, -- licence_offer | consent_request | takedown_request | other
  message_body TEXT NOT NULL, -- exactly what the operator sent (or noted)
  status TEXT NOT NULL DEFAULT 'sent', -- sent | responded | converted | declined | ignored
  first_contact_at INTEGER NOT NULL,
  last_status_at INTEGER NOT NULL,
  notes TEXT
);

-- Show the most recent outreach on an account card, and support the
-- "have we contacted this account already?" check before opening the
-- compose modal.
CREATE INDEX IF NOT EXISTS account_outreach_account_idx
  ON account_outreach (account_id, first_contact_at DESC);

-- Talent-scoped funnel: for a given talent, which conversations are
-- awaiting a response? which converted? Powers the licence-pipeline
-- dashboard we'll build later.
CREATE INDEX IF NOT EXISTS account_outreach_talent_status_idx
  ON account_outreach (talent_id, status);
