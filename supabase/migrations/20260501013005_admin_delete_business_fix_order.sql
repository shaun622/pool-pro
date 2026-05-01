-- Fix admin_delete_business() delete order. The previous version
-- deleted staff_members BEFORE pools and clients, but those tables
-- have assigned_staff_id (and clients also) referencing staff_members.
-- That tripped the FK constraint and the function aborted (the whole
-- transaction rolled back, no rows were actually removed).
--
-- New order: pools and clients go BEFORE staff_members so the staff
-- delete sees no inbound FKs left.

create or replace function admin_delete_business(p_business_id uuid)
returns table(deleted_business_id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_business_id is null then
    raise exception 'business_id is required';
  end if;

  -- 1. Children of service_records (FK by service_record_id, not business_id)
  delete from chemical_logs   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from chemicals_added where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_tasks   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_photos  where service_record_id in (select id from service_records where business_id = p_business_id);

  -- 2. Tables that hold FKs to clients/pools/staff_members. Clearing them
  --    first removes inbound references on clients/pools/staff so step 4-6
  --    can delete those without FK violations.
  delete from invoices                where business_id = p_business_id;
  delete from quotes                  where business_id = p_business_id;
  delete from jobs                    where business_id = p_business_id;
  delete from recurring_job_profiles  where business_id = p_business_id;
  delete from service_records         where business_id = p_business_id;

  -- 3. Misc business-scoped tables that don't reference clients/pools/staff
  delete from pricing_items           where business_id = p_business_id;
  delete from documents               where business_id = p_business_id;
  delete from surveys                 where business_id = p_business_id;
  delete from automation_logs         where business_id = p_business_id;
  delete from automation_rules        where business_id = p_business_id;
  delete from job_type_templates      where business_id = p_business_id;
  delete from communication_templates where business_id = p_business_id;
  delete from chemical_products       where business_id = p_business_id;

  -- 4. pools — references clients (client_id) and staff_members
  --    (assigned_staff_id). Must go before both.
  delete from pools                   where business_id = p_business_id;

  -- 5. clients — references staff_members (assigned_staff_id). Must go
  --    before staff_members.
  delete from clients                 where business_id = p_business_id;

  -- 6. staff_members — by now nothing references it, safe to drop.
  delete from staff_members           where business_id = p_business_id;

  -- 7. The business row itself. activity_feed cascades on this;
  --    operator_actions sets its business_id to null so the audit
  --    trail survives.
  delete from businesses where id = p_business_id;

  return query select p_business_id, now();
end;
$$;

-- Re-apply lockdown (the CREATE OR REPLACE above doesn't reset grants
-- but leaves them as-is; this is just being explicit/idempotent).
revoke all on function admin_delete_business(uuid) from public;
revoke all on function admin_delete_business(uuid) from anon;
revoke all on function admin_delete_business(uuid) from authenticated;
grant  execute on function admin_delete_business(uuid) to service_role;
