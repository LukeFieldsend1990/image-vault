-- Backfill any licences missing a delivery_mode to the default 'standard'.
-- The column was added with a default, but rows inserted before the migration
-- may have NULL values.
UPDATE licences SET delivery_mode = 'standard' WHERE delivery_mode IS NULL OR delivery_mode = '';
