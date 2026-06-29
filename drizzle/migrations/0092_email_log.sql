CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
  error_code INTEGER,
  error_body TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON email_log(sent_at);
