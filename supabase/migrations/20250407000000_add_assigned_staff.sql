-- Add assigned_staff_id to clients and pools
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_members;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_members;
