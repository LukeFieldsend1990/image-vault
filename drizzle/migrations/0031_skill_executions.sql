-- Tracks every skill execution for usage analytics
CREATE TABLE skill_executions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email_id TEXT REFERENCES received_emails(id) ON DELETE SET NULL,
  success INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_skill_exec_skill ON skill_executions(skill_id);
CREATE INDEX idx_skill_exec_created ON skill_executions(created_at);
