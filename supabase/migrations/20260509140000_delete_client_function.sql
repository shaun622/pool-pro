-- delete_client(p_client_id uuid)
--
-- Hard-delete a single client and every row in every table that
-- references it, in FK-respecting order, inside a single implicit
-- transaction. Mirrors admin_delete_business (see
-- 20260501030052_admin_delete_business_full_order.sql) but scoped to
-- one client instead of an entire business.
--
-- The /clients detail card and /clients/<id> profile both call this
-- via supabase.rpc('delete_client'). The bare
--   delete from clients where id = $1
-- previously used by useClients.deleteClient FK-violates as soon as
-- the client has pools / recurring profiles / jobs / quotes /
-- invoices / surveys / documents / service history — i.e. almost any
-- real client.
--
-- Inbound FK map (children → parents) we walk in reverse-dependency
-- order. Keep this comment in sync with admin_delete_business when
-- adding new tables.
--
--   chemical_logs.service_record_id      → service_records
--   chemicals_added.service_record_id    → service_records
--   service_tasks.service_record_id      → service_records
--   service_photos.service_record_id     → service_records
--   automation_logs.job_id               → jobs
--   automation_logs.service_record_id    → service_records
--   documents.client_id / pool_id / job_id
--   surveys.client_id / service_record_id
--   invoices.client_id / service_record_id
--   jobs.client_id / pool_id / quote_id / recurring_profile_id
--   recurring_job_profiles.client_id / pool_id
--   quotes.client_id / pool_id
--   service_records.pool_id
--   pools.client_id
--
-- Authorisation: only the owning business can call this. The function
-- runs with security definer to bypass RLS during the cascading deletes
-- (the operator may not have direct delete privileges on every child
-- table), but explicitly compares the target client's business_id
-- against current_business_id() before doing anything.

create or replace function delete_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
begin
  if p_client_id is null then
    raise exception 'client_id is required';
  end if;

  select business_id into v_business_id from clients where id = p_client_id;
  if v_business_id is null then
    raise exception 'Client not found';
  end if;
  if v_business_id is distinct from current_business_id() then
    raise exception 'Not authorised to delete this client';
  end if;

  -- 1. Deepest leaves — children of service_records belonging to any
  --    pool owned by this client.
  delete from chemical_logs   where service_record_id in (
    select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
  );
  delete from chemicals_added where service_record_id in (
    select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
  );
  delete from service_tasks   where service_record_id in (
    select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
  );
  delete from service_photos  where service_record_id in (
    select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
  );

  -- 2. automation_logs — references both jobs and service_records.
  delete from automation_logs
   where job_id in (select id from jobs where client_id = p_client_id)
      or service_record_id in (
        select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
      );

  -- 3. Mid-level tables that reference jobs / service_records / client.
  delete from documents
   where client_id = p_client_id
      or pool_id in (select id from pools where client_id = p_client_id)
      or job_id  in (select id from jobs  where client_id = p_client_id);
  delete from surveys
   where client_id = p_client_id
      or service_record_id in (
        select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
      );
  delete from invoices
   where client_id = p_client_id
      or service_record_id in (
        select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
      );

  -- 4. jobs (refs quotes, recurring_job_profiles, clients, pools).
  delete from jobs                   where client_id = p_client_id;

  -- 5. recurring_job_profiles (refs clients, pools).
  delete from recurring_job_profiles where client_id = p_client_id;

  -- 6. quotes (refs clients, pools) — safe now: jobs.quote_id cleared.
  delete from quotes                 where client_id = p_client_id;

  -- 7. service_records (refs pools) — safe: children + invoices +
  --    surveys + automation_logs all cleared.
  delete from service_records        where pool_id in (select id from pools where client_id = p_client_id);

  -- 8. pools (refs clients) — safe now: jobs/quotes/service_records/
  --    recurring/documents all cleared.
  delete from pools                  where client_id = p_client_id;

  -- 9. The client itself.
  delete from clients                where id = p_client_id;
end;
$$;

revoke all on function delete_client(uuid) from public;
revoke all on function delete_client(uuid) from anon;
grant  execute on function delete_client(uuid) to authenticated;
