-- Document seals — the bridge between a printed evidence document and a live
-- integrity check.
--
-- When a chain-of-custody record or consent receipt is issued we snapshot the
-- ledger state it was built from: the set of chains covered, their tip hashes,
-- and a single SHA-256 over all of them (the seal hash). `ref` is an opaque
-- high-entropy token that goes into the printed QR code — anyone holding the
-- document can recompute the chains at /verify/{ref} without an account.
--
-- The ref is deliberately NOT the human document reference (IMG-20260808-A3F1C2):
-- that one is guessable and exists to be quoted in correspondence. This one is a
-- capability, so it must not be.

CREATE TABLE document_seals (
  id                  TEXT    PRIMARY KEY,
  ref                 TEXT    NOT NULL UNIQUE,     -- opaque URL-safe token, 22 chars
  kind                TEXT    NOT NULL,            -- custody_record | consent_receipt | certificate
  subject_type        TEXT    NOT NULL,            -- package | licence | cast | talent
  subject_id          TEXT    NOT NULL,
  subject_label       TEXT,                        -- initials + short code ONLY; never a name or email
  chain_keys_json     TEXT    NOT NULL DEFAULT '[]',
  chain_summary_json  TEXT    NOT NULL DEFAULT '[]', -- [{chainKey, seq, tipHash, eventCount}]
  seal_hash           TEXT    NOT NULL,            -- SHA-256 over the sorted chain tips
  event_count         INTEGER NOT NULL DEFAULT 0,
  issued_by           TEXT    REFERENCES users(id),
  issued_at           INTEGER NOT NULL,
  revoked_at          INTEGER
);

CREATE INDEX idx_document_seals_subject ON document_seals(subject_type, subject_id);
CREATE INDEX idx_document_seals_kind ON document_seals(kind, issued_at);
