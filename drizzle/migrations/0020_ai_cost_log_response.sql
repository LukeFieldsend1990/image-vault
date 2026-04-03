-- Add response column to ai_cost_log for debugging AI outputs
ALTER TABLE ai_cost_log ADD COLUMN response TEXT;
-- Add prompt column so we can see what was sent
ALTER TABLE ai_cost_log ADD COLUMN prompt TEXT;
