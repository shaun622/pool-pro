-- Add pipeline stage to clients for CRM kanban
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'active'
  CHECK (pipeline_stage IN ('lead', 'quoted', 'active', 'on_hold', 'lost'));
