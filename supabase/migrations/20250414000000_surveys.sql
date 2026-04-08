-- Surveys table for post-job feedback
CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  service_record_id uuid REFERENCES service_records,
  client_id uuid REFERENCES clients NOT NULL,
  token uuid DEFAULT gen_random_uuid() UNIQUE,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  comment text,
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- Business owners can manage their surveys
CREATE POLICY "Business can manage surveys"
  ON surveys FOR ALL
  USING (business_id = current_business_id());

-- Public access for submitting via token (select to load, update to submit)
CREATE POLICY "Public can view survey by token"
  ON surveys FOR SELECT
  USING (token IS NOT NULL);

CREATE POLICY "Public can submit survey by token"
  ON surveys FOR UPDATE
  USING (token IS NOT NULL)
  WITH CHECK (token IS NOT NULL);

CREATE INDEX idx_surveys_token ON surveys(token);
CREATE INDEX idx_surveys_business ON surveys(business_id);
CREATE INDEX idx_surveys_submitted ON surveys(submitted_at DESC);
