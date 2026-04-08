-- Allow customers to read chemical products for their business
CREATE POLICY "Customers can view chemical products"
  ON chemical_products FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM clients WHERE auth_user_id = auth.uid()
    )
  );
