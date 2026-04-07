-- Allow customers to read their own client record via auth_user_id
CREATE POLICY "Customers can view own client record"
  ON clients FOR SELECT
  USING (auth_user_id = auth.uid());

-- Allow customers to read the business that services them
CREATE POLICY "Customers can view their business"
  ON businesses FOR SELECT
  USING (
    id IN (SELECT business_id FROM clients WHERE auth_user_id = auth.uid())
  );
