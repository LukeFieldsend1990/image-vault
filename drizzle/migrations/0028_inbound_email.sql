-- Inbound Email Intake: per-user/entity aliases that can be CC'd into
-- external conversations. Resend receives inbound mail and webhooks us;
-- we fetch full body + attachments, store them, and run AI triage.

-- ── Aliases ─────────────────────────────────────────────────────────────────

CREATE TABLE inbound_aliases (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,                -- opaque local-part, e.g. "u_7f3k2"
  alias_type TEXT NOT NULL DEFAULT 'user'
    CHECK(alias_type IN ('user', 'licence', 'package', 'talent')),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_entity_id TEXT,                      -- optional FK to licence/package/etc
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'revoked', 'expired')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  last_used_at INTEGER
);

CREATE UNIQUE INDEX idx_inbound_aliases_alias ON inbound_aliases(alias);
CREATE INDEX idx_inbound_aliases_owner ON inbound_aliases(owner_user_id, status);
CREATE INDEX idx_inbound_aliases_entity ON inbound_aliases(owner_entity_id) WHERE owner_entity_id IS NOT NULL;

-- ── Received emails ─────────────────────────────────────────────────────────

CREATE TABLE received_emails (
  id TEXT PRIMARY KEY,
  resend_email_id TEXT UNIQUE,               -- Resend's ID for fetching full body
  message_id TEXT,                           -- RFC Message-ID header
  in_reply_to TEXT,                          -- threading
  "references" TEXT,                         -- threading (JSON array of Message-IDs)
  alias_id TEXT REFERENCES inbound_aliases(id) ON DELETE SET NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  owner_entity_id TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  subject TEXT,
  sent_at INTEGER,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  text_body TEXT,
  html_body TEXT,
  normalized_text TEXT,                      -- HTML stripped to plain text
  raw_headers_json TEXT,
  spam_score REAL,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(processing_status IN ('pending', 'fetching', 'processing', 'triaged', 'failed')),
  routing_status TEXT NOT NULL DEFAULT 'matched'
    CHECK(routing_status IN ('matched', 'unmatched', 'quarantine')),
  dedupe_key TEXT,
  thread_key TEXT,                           -- derived from References/In-Reply-To
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_received_emails_owner ON received_emails(owner_user_id);
CREATE INDEX idx_received_emails_alias ON received_emails(alias_id);
CREATE INDEX idx_received_emails_entity ON received_emails(owner_entity_id) WHERE owner_entity_id IS NOT NULL;
CREATE INDEX idx_received_emails_thread ON received_emails(thread_key) WHERE thread_key IS NOT NULL;
CREATE INDEX idx_received_emails_status ON received_emails(processing_status);
CREATE UNIQUE INDEX idx_received_emails_dedupe ON received_emails(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── Recipients (to/cc/bcc on the inbound email) ────────────────────────────

CREATE TABLE received_email_recipients (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES received_emails(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('to', 'cc', 'bcc')),
  display_name TEXT,
  address TEXT NOT NULL
);

CREATE INDEX idx_email_recipients_email ON received_email_recipients(email_id);

-- ── Attachments ─────────────────────────────────────────────────────────────

CREATE TABLE received_email_attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES received_emails(id) ON DELETE CASCADE,
  filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  storage_key TEXT,                          -- R2 key for stored attachment
  checksum TEXT,                             -- SHA-256
  scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(scan_status IN ('pending', 'clean', 'suspicious', 'blocked')),
  text_extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(text_extraction_status IN ('pending', 'done', 'failed', 'skipped')),
  extracted_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_email_attachments_email ON received_email_attachments(email_id);

-- ── AI triage results ───────────────────────────────────────────────────────

CREATE TABLE ai_triage_results (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES received_emails(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  summary TEXT,
  category TEXT,                             -- new_case | document | clarification | complaint | licence_request | onboarding | spam | other
  urgency TEXT CHECK(urgency IN ('low', 'medium', 'high', 'critical')),
  confidence REAL,
  structured_data_json TEXT,                 -- extracted fields as JSON
  recommended_action TEXT,
  risk_flags_json TEXT,                      -- JSON array of flags
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(review_status IN ('pending', 'approved', 'rejected', 'auto_applied')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_triage_email ON ai_triage_results(email_id);
CREATE INDEX idx_triage_review ON ai_triage_results(review_status);

-- ── Thread links (correlate emails into conversations) ──────────────────────

CREATE TABLE email_thread_links (
  id TEXT PRIMARY KEY,
  owner_entity_id TEXT,
  thread_key TEXT NOT NULL,
  latest_email_id TEXT REFERENCES received_emails(id) ON DELETE SET NULL,
  email_count INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_thread_links_key ON email_thread_links(thread_key);
CREATE INDEX idx_thread_links_entity ON email_thread_links(owner_entity_id) WHERE owner_entity_id IS NOT NULL;
