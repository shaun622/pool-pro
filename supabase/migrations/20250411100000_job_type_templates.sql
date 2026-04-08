-- Job type templates for pre-configured service types
CREATE TABLE IF NOT EXISTS job_type_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  name text NOT NULL,
  description text,
  default_tasks jsonb DEFAULT '[]',
  estimated_duration_minutes integer,
  default_price numeric,
  checklist jsonb DEFAULT '[]',
  color text DEFAULT '#0EA5E9',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE job_type_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business owners can manage job type templates"
  ON job_type_templates FOR ALL
  USING (business_id = current_business_id());
