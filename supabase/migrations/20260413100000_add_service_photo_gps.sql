-- Add GPS and capture timestamp to service_photos
ALTER TABLE service_photos ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE service_photos ADD COLUMN IF NOT EXISTS longitude numeric;
ALTER TABLE service_photos ADD COLUMN IF NOT EXISTS captured_at timestamptz;
