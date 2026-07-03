-- Tier-1 security, Part 1: replace blanket `using (true)` policies with
-- business-scoped + customer-scoped policies.
--
-- WHY: these tables had a permissive `using (true)` policy sitting alongside the
-- business-scoped one. Because RLS is permissive (policies OR together),
-- `using (true)` won and the public anon key (shipped in the JS bundle) could
-- read every tenant's pools / service history / staff, and read+write the four
-- service child tables. There were no GRANT statements, so these pre-2026 tables
-- rely on Supabase's default anon+authenticated exposure — i.e. the blanket
-- policies were live cross-tenant exposure.
--
-- These tables are legitimately read by TWO authenticated audiences:
--   1. the business app  -> scoped by `business_id = current_business_id()`
--   2. the logged-in customer portal -> a customer is an authed user whose
--      auth.uid() matches clients.auth_user_id (portal login). There were already
--      customer-scoped policies for clients/businesses/chemical_products; this
--      adds the missing ones for pools/service_records/child tables/staff.
-- Writes to the child tables go through the security-definer complete_service_tx
-- / mark_unable_to_service_tx RPCs (which bypass RLS), EXCEPT service_photos,
-- which also has direct client INSERT/DELETE — so its business policy is `for all`.
--
-- No application query changes are needed: the business/portal queries are
-- unchanged; RLS simply narrows which rows return.

-- ── pools ────────────────────────────────────────────────────────────────────
drop policy if exists "Public portal access" on pools;
-- (business access remains via "Business can manage pools")
create policy "Customers view own pools" on pools
  for select to authenticated
  using (exists (
    select 1 from clients c
    where c.id = pools.client_id and c.auth_user_id = auth.uid()
  ));

-- ── service_records ──────────────────────────────────────────────────────────
drop policy if exists "Public service records via pool" on service_records;
-- (business access remains via "Business can manage service_records")
create policy "Customers view own service_records" on service_records
  for select to authenticated
  using (exists (
    select 1 from pools p
    join clients c on c.id = p.client_id
    where p.id = service_records.pool_id and c.auth_user_id = auth.uid()
  ));

-- ── chemical_logs ────────────────────────────────────────────────────────────
drop policy if exists "Access via service_record" on chemical_logs;
create policy "Business manage chemical_logs" on chemical_logs
  for all to authenticated
  using (exists (
    select 1 from service_records sr
    where sr.id = chemical_logs.service_record_id and sr.business_id = current_business_id()
  ))
  with check (exists (
    select 1 from service_records sr
    where sr.id = chemical_logs.service_record_id and sr.business_id = current_business_id()
  ));
create policy "Customers view chemical_logs" on chemical_logs
  for select to authenticated
  using (exists (
    select 1 from service_records sr
    join pools p on p.id = sr.pool_id
    join clients c on c.id = p.client_id
    where sr.id = chemical_logs.service_record_id and c.auth_user_id = auth.uid()
  ));

-- ── chemicals_added ──────────────────────────────────────────────────────────
drop policy if exists "Access via service_record" on chemicals_added;
create policy "Business manage chemicals_added" on chemicals_added
  for all to authenticated
  using (exists (
    select 1 from service_records sr
    where sr.id = chemicals_added.service_record_id and sr.business_id = current_business_id()
  ))
  with check (exists (
    select 1 from service_records sr
    where sr.id = chemicals_added.service_record_id and sr.business_id = current_business_id()
  ));
create policy "Customers view chemicals_added" on chemicals_added
  for select to authenticated
  using (exists (
    select 1 from service_records sr
    join pools p on p.id = sr.pool_id
    join clients c on c.id = p.client_id
    where sr.id = chemicals_added.service_record_id and c.auth_user_id = auth.uid()
  ));

-- ── service_tasks ────────────────────────────────────────────────────────────
drop policy if exists "Access via service_record" on service_tasks;
create policy "Business manage service_tasks" on service_tasks
  for all to authenticated
  using (exists (
    select 1 from service_records sr
    where sr.id = service_tasks.service_record_id and sr.business_id = current_business_id()
  ))
  with check (exists (
    select 1 from service_records sr
    where sr.id = service_tasks.service_record_id and sr.business_id = current_business_id()
  ));
create policy "Customers view service_tasks" on service_tasks
  for select to authenticated
  using (exists (
    select 1 from service_records sr
    join pools p on p.id = sr.pool_id
    join clients c on c.id = p.client_id
    where sr.id = service_tasks.service_record_id and c.auth_user_id = auth.uid()
  ));

-- ── service_photos (direct client INSERT/DELETE -> business policy is `for all`) ─
drop policy if exists "Access via service_record" on service_photos;
create policy "Business manage service_photos" on service_photos
  for all to authenticated
  using (exists (
    select 1 from service_records sr
    where sr.id = service_photos.service_record_id and sr.business_id = current_business_id()
  ))
  with check (exists (
    select 1 from service_records sr
    where sr.id = service_photos.service_record_id and sr.business_id = current_business_id()
  ));
create policy "Customers view service_photos" on service_photos
  for select to authenticated
  using (exists (
    select 1 from service_records sr
    join pools p on p.id = sr.pool_id
    join clients c on c.id = p.client_id
    where sr.id = service_photos.service_record_id and c.auth_user_id = auth.uid()
  ));

-- ── staff_members ────────────────────────────────────────────────────────────
-- (business access remains via "Business can manage staff"; role-based write
--  enforcement is added separately in the staff-role migration.)
-- The old "Public staff read" (using true) leaked the whole active roster
-- (name/email/phone/role) of EVERY business to anon. It only genuinely needs to
-- serve the invite-acceptance page, which looks a row up by invite_token before
-- the invitee can authenticate. Narrow anon read to PENDING INVITE rows only, so
-- the active roster is no longer anon-readable. The customer portal + business
-- app get their own scoped policies.
drop policy if exists "Public staff read" on staff_members;
create policy "Anon read pending invites" on staff_members
  for select to anon
  using (invite_status = 'pending' and invite_token is not null);
create policy "Customers view business staff" on staff_members
  for select to authenticated
  using (exists (
    select 1 from clients c
    where c.business_id = staff_members.business_id and c.auth_user_id = auth.uid()
  ));

-- ── Indexes supporting the new scoped policies ───────────────────────────────
-- (chemical_logs already has idx_chemical_logs_service)
create index if not exists idx_chemicals_added_service on chemicals_added(service_record_id);
create index if not exists idx_service_tasks_service   on service_tasks(service_record_id);
create index if not exists idx_service_photos_service  on service_photos(service_record_id);

-- ── Defense-in-depth: remove anon's direct table grants ──────────────────────
-- Anon never reads these tables directly (portal login + quote/survey flows go
-- through security-definer RPCs / edge functions, which run as definer, not as
-- anon). With the blanket policies gone, anon already gets zero rows; revoking
-- the grant removes the reachability entirely. Safe to run.
revoke select on pools           from anon;
revoke select on service_records from anon;
revoke select on chemical_logs   from anon;
revoke select on chemicals_added from anon;
revoke select on service_tasks   from anon;
revoke select on service_photos  from anon;
-- NOTE: staff_members keeps its anon SELECT grant — the "Anon read pending
-- invites" policy above still needs it for invite-link lookups. The policy (not
-- the grant) is what now limits anon to pending-invite rows.
