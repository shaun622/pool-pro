-- Add geocoding columns for map view
ALTER TABLE pools ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
