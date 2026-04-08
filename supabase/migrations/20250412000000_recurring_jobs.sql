-- Recurring job profiles
CREATE TABLE IF NOT EXISTS recurring_job_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  client_id uuid REFERENCES clients NOT NULL,
  pool_id uuid REFERENCES pools,
  job_type_template_id uuid REFERENCES job_type_templates,
  title text NOT NULL,
  recurrence_rule text NOT NULL DEFAULT 'weekly'
    CHECK (recurrence_rule IN ('weekly', 'fortnightly', 'monthly', '6_weekly', 'quarterly', 'custom')),
  custom_interval_days integer,
  preferred_day_of_week integer CHECK (preferred_day_of_week BETWEEN 0 AND 6),
  preferred_time time,
  assigned_staff_id uuid REFERENCES staff_members,
  price numeric,
  notes text,
  is_active boolean DEFAULT true,
  last_generated_at timestamptz,
  next_generation_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recurring_job_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business can manage recurring profiles"
  ON recurring_job_profiles FOR ALL
  USING (business_id = current_business_id());

CREATE INDEX idx_recurring_profiles_business ON recurring_job_profiles(business_id);
CREATE INDEX idx_recurring_profiles_next ON recurring_job_profiles(next_generation_at) WHERE is_active = true;

-- Enhance existing jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurring_profile_id uuid REFERENCES recurring_job_profiles;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type_template_id uuid REFERENCES job_type_templates;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_members;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_time time;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- scheduled_at already exists on jobs table
