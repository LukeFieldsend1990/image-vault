-- Admin MCP integration: API tokens + audit log
CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_mcp_tokens_user ON mcp_tokens(user_id);

CREATE TABLE mcp_audit_log (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES mcp_tokens(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  tool TEXT NOT NULL,
  params_json TEXT,
  success INTEGER NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_mcp_audit_created ON mcp_audit_log(created_at);
