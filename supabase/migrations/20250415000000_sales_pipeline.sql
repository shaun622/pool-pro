-- Add pipeline columns to quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'draft';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS follow_up_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_reason text;
