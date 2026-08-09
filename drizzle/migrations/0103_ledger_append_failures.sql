-- Ledger append failures — a dead-letter record for the fire-and-forget emitter.
--
-- `appendEventBg` deliberately never throws into its caller: an audit append must
-- not fail a download or a revocation. But until now it also caught and discarded
-- the error, so a lost event left no trace anywhere. And a lost event is
-- undetectable after the fact: `appendEvent` assigns `seq` from the current tip at
-- write time, so an append that never happened produces a chain that is shorter
-- than it should be yet still verifies cleanly — no gap, no hash break.
--
-- The only place that knowledge exists is the moment of failure. This table keeps
-- it: the full spec, the error, and enough state to replay the append once the
-- underlying problem is fixed.

CREATE TABLE ledger_append_failures (
  id            TEXT    PRIMARY KEY,
  chain_key     TEXT    NOT NULL,
  event_type    TEXT    NOT NULL,
  spec_json     TEXT    NOT NULL,   -- the full AppendEventSpec, for replay
  error_message TEXT,
  attempts      INTEGER NOT NULL DEFAULT 1,
  status        TEXT    NOT NULL DEFAULT 'unresolved', -- unresolved | replayed | dismissed
  replayed_at   INTEGER,
  replayed_seq  INTEGER,            -- the seq it eventually landed at
  resolved_by   TEXT    REFERENCES users(id),
  note          TEXT,               -- why it was dismissed, when it was
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_ledger_failures_status ON ledger_append_failures(status, created_at);
CREATE INDEX idx_ledger_failures_chain ON ledger_append_failures(chain_key);
