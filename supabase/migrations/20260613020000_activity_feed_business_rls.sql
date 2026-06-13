-- Fix activity_feed RLS so the whole business can use it, not just the
-- owner — and so inserts work at all.
--
-- The original table (20250422000000) shipped two owner-only policies:
--   "Users can view own business activity"   FOR SELECT  (owner only)
--   "Users can update own business activity"  FOR UPDATE  (owner only)
-- and NO insert policy. Two problems:
--   1. Staff/technician logins can't read or mark-read the feed
--      (auth.uid() never matches a business owner_id).
--   2. With RLS enabled and no INSERT policy, the client-side inserts
--      in WorkOrders.jsx / WorkOrderDetail.jsx are rejected for every
--      role — including the owner — so the feed never populates. The
--      app doesn't check that insert's error, so it fails silently.
--
-- Replace both with the single business-scoped policy every other
-- PoolPro table uses. FOR ALL with USING (and an implicit WITH CHECK
-- of the same expression) covers SELECT/UPDATE/DELETE and INSERT, so
-- owners and active staff in the same business can read, write, and
-- mark-read their feed. current_business_id() (fixed for staff in
-- 20260412000000) resolves the business for both owners and staff.

drop policy if exists "Users can view own business activity" on activity_feed;
drop policy if exists "Users can update own business activity" on activity_feed;

create policy "Business can manage activity_feed"
  on activity_feed
  for all
  using (business_id = current_business_id());
