-- Add timezone column to businesses table
-- Defaults to Australia/Sydney as the app targets Australian pool businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Australia/Sydney';
