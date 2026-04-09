-- Activity feed / notifications
CREATE TABLE IF NOT EXISTS activity_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('quote_sent', 'quote_accepted', 'quote_declined', 'quote_viewed', 'job_created', 'job_completed', 'service_completed', 'client_created', 'payment_received', 'recurring_generated')),
  title text NOT NULL,
  description text,
  link_to text, -- e.g. /jobs/123, /clients/456
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_activity_feed_business ON activity_feed(business_id, created_at DESC);
CREATE INDEX idx_activity_feed_unread ON activity_feed(business_id, is_read) WHERE is_read = false;

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own business activity"
  ON activity_feed FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

CREATE POLICY "Users can update own business activity"
  ON activity_feed FOR UPDATE
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Enable realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE activity_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
