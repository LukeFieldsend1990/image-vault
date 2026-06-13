-- Upfront fee model (provisional, under test).
--
-- Talent tier fees + production banded access fees, tracked as obligations.
-- Talent-facing visibility is gated behind users.financial_visibility_enabled,
-- which defaults OFF.
ALTER TABLE users ADD COLUMN financial_visibility_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE talent_settings ADD COLUMN tier TEXT;

CREATE TABLE fee_obligations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  production_id TEXT REFERENCES productions(id) ON DELETE SET NULL,
  licence_id TEXT REFERENCES licences(id) ON DELETE SET NULL,
  tier TEXT,
  band TEXT,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  grace_deadline INTEGER,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE INDEX idx_fee_obligations_talent ON fee_obligations(talent_id, status);
CREATE INDEX idx_fee_obligations_payer ON fee_obligations(payer_user_id, status);
CREATE INDEX idx_fee_obligations_status ON fee_obligations(status, type);
