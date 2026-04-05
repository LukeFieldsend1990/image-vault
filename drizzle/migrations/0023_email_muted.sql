-- Add email_muted flag so admins can disable email notifications per user
ALTER TABLE users ADD COLUMN email_muted INTEGER NOT NULL DEFAULT 0;
