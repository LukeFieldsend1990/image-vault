-- Add checkpoint column for resumable geo-fingerprint pass 2
ALTER TABLE geometry_fingerprint_jobs ADD COLUMN file_checkpoint_json TEXT;
