-- Platform-declared adult flag on likeness hits (Reddit's over18 today).
--
-- Carried from discovery so the UI can badge the hit before the talent taps
-- through to the content. It is the platform's own labelling, not a detector
-- reading — it never feeds confidence, risk level, or match signals.

ALTER TABLE likeness_hits ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
