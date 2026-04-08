-- Add recurring_settings jsonb column to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS recurring_settings jsonb;
