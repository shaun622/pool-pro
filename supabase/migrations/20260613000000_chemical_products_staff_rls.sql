-- Fix: chemical library not syncing to technician accounts.
--
-- chemical_products was created on 2025-04-08 with an owner-only RLS
-- policy:
--   USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()))
-- Staff/technician logins (added later in 20250423000000_tech_roles.sql)
-- are not business owners, so auth.uid() never matches owner_id and the
-- SELECT returns zero rows. The technician's NewService chemical picker
-- queries `.eq('business_id', business.id)` correctly, but RLS hides
-- every row before the filter runs — the library shows up empty.
--
-- current_business_id() (fixed for staff in 20260412000000) already
-- resolves a staff member's business via their staff_members row, and
-- it's the pattern every other business-scoped table uses. Swap the
-- owner-only policy for the standard one so owners AND active staff in
-- the same business share the library.
--
-- The separate customer-portal policy ("Customers can view chemical
-- products" from 20250410000000) is left untouched — portal users are
-- neither owner nor staff, so current_business_id() returns null for
-- them and they still need their own policy.

drop policy if exists "Business members can manage chemical products" on chemical_products;

create policy "Business can manage chemical products"
  on chemical_products
  for all
  using (business_id = current_business_id());
