-- Hard-delete a business and every row that references it. Used by the
-- FieldSuite HQ admin "Delete business" action. Service-role only —
-- regular auth users cannot call this (REVOKE from public/authenticated
-- below; service_role bypasses).
--
-- Most child tables lack ON DELETE CASCADE on their business_id FK, so
-- we walk the dependency tree explicitly. Deeper-than-business children
-- (chemical_logs, chemicals_added, service_tasks, service_photos) hang
-- off service_records, so we clear those first.
--
-- activity_feed already has ON DELETE CASCADE; operator_actions has
-- ON DELETE SET NULL (we keep the audit trail with a null business_id
-- after deletion). The owner's auth.users row is intentionally left
-- alone — that's a separate concern handled outside this function.

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

  -- 1. Children of service_records (no direct business_id, traverse via FK)
  delete from chemical_logs   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from chemicals_added where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_tasks   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_photos  where service_record_id in (select id from service_records where business_id = p_business_id);

  -- 2. Direct business_id children (order: leaf-ish first to respect any
  --    cross-table FKs we might have missed — invoices reference jobs in
  --    some flows, so do invoices before jobs etc.)
  delete from invoices                where business_id = p_business_id;
  delete from quotes                  where business_id = p_business_id;
  delete from jobs                    where business_id = p_business_id;
  delete from recurring_job_profiles  where business_id = p_business_id;
  delete from service_records         where business_id = p_business_id;
  delete from pricing_items           where business_id = p_business_id;
  delete from documents               where business_id = p_business_id;
  delete from surveys                 where business_id = p_business_id;
  delete from automation_logs         where business_id = p_business_id;
  delete from automation_rules        where business_id = p_business_id;
  delete from job_type_templates      where business_id = p_business_id;
  delete from communication_templates where business_id = p_business_id;
  delete from chemical_products       where business_id = p_business_id;
  delete from staff_members           where business_id = p_business_id;
  delete from pools                   where business_id = p_business_id;
  delete from clients                 where business_id = p_business_id;

  -- 3. The business itself. activity_feed cascades on this; operator_actions
  --    sets its business_id to null (audit trail survives).
  delete from businesses where id = p_business_id;

  return query select p_business_id, now();
end;
$$;

-- Lock the function down: only the service_role (and postgres superuser)
-- may call it. Anon/authenticated users — including business owners —
-- cannot use it to nuke their own or anyone else's tenant.
revoke all on function admin_delete_business(uuid) from public;
revoke all on function admin_delete_business(uuid) from anon;
revoke all on function admin_delete_business(uuid) from authenticated;
grant  execute on function admin_delete_business(uuid) to service_role;
