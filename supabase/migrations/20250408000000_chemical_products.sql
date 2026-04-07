-- Chemical products library for quick-add during service
CREATE TABLE IF NOT EXISTS chemical_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  name text NOT NULL,
  default_unit text DEFAULT 'L',
  use_count integer DEFAULT 0,
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE chemical_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business members can manage chemical products"
  ON chemical_products FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
