-- Captured copy of a flagged post's preview image.
--
-- likeness_hits.thumbnail_url points at a platform CDN with a signed, expiring
-- URL: the preview loads for a day or two and then 403s, leaving the accounts
-- view full of broken images while the hit is still open. The sweep now copies
-- the bytes into R2 at discovery and this column holds the key.
ALTER TABLE likeness_hits ADD COLUMN thumbnail_key TEXT;
