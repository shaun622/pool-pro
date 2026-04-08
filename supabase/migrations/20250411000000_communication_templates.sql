-- Communication templates for automated messaging
CREATE TABLE IF NOT EXISTS communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'email' CHECK (type IN ('email', 'sms')),
  trigger_type text CHECK (trigger_type IN (
    'service_reminder', 'running_late', 'service_complete', 'follow_up',
    'survey', 'quote_sent', 'quote_accepted', 'job_update', 'invoice', 'custom'
  )),
  subject text,
  body text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name, type)
);

ALTER TABLE communication_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business owners can manage templates"
  ON communication_templates FOR ALL
  USING (business_id = current_business_id());
