-- Automation rules for sending notifications
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  name text NOT NULL,
  trigger_event text NOT NULL CHECK (trigger_event IN (
    'job_scheduled', 'job_started', 'job_running_late',
    'job_completed', 'service_completed', 'quote_sent', 'quote_accepted'
  )),
  condition jsonb DEFAULT '{}',
  action_type text NOT NULL DEFAULT 'send_email' CHECK (action_type IN ('send_email', 'send_sms', 'both')),
  template_id uuid REFERENCES communication_templates,
  delay_minutes integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business can manage automations"
  ON automation_rules FOR ALL
  USING (business_id = current_business_id());

-- Log of all automated messages sent
CREATE TABLE IF NOT EXISTS automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_rule_id uuid REFERENCES automation_rules,
  business_id uuid REFERENCES businesses NOT NULL,
  job_id uuid REFERENCES jobs,
  service_record_id uuid REFERENCES service_records,
  recipient_email text,
  recipient_phone text,
  channel text CHECK (channel IN ('email', 'sms')),
  status text DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'failed')),
  template_name text,
  rendered_body text,
  sent_at timestamptz DEFAULT now(),
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business can view automation logs"
  ON automation_logs FOR ALL
  USING (business_id = current_business_id());

CREATE INDEX idx_automation_rules_business ON automation_rules(business_id);
CREATE INDEX idx_automation_logs_business ON automation_logs(business_id);
CREATE INDEX idx_automation_logs_date ON automation_logs(sent_at DESC);
