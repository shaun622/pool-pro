-- admin_delete_business v3 — comprehensive FK-respecting delete order.
--
-- v1 missed pools.assigned_staff_id → staff_members.
-- v2 fixed that, but missed jobs.quote_id → quotes (so deleting quotes
--    before jobs trips a FK).
--
-- Full cross-reference map (children → parents) we have to walk in
-- reverse-dependency order:
--
--   chemical_logs.service_record_id      → service_records
--   chemicals_added.service_record_id    → service_records
--   service_tasks.service_record_id      → service_records
--   service_photos.service_record_id     → service_records
--   automation_logs.job_id               → jobs
--   automation_logs.service_record_id    → service_records
--   automation_logs.automation_rule_id   → automation_rules
--   automation_rules.template_id         → communication_templates
--   documents.client_id / pool_id / job_id
--   surveys.client_id / service_record_id
--   invoices.client_id / service_record_id
--   jobs.client_id / pool_id / quote_id / recurring_profile_id / assigned_staff_id
--   recurring_job_profiles.client_id / pool_id / assigned_staff_id
--   quotes.client_id / pool_id
--   service_records.pool_id / staff_id
--   pools.client_id / assigned_staff_id
--   clients.assigned_staff_id            → staff_members
--
-- The function runs in a single implicit transaction. If any DELETE
-- raises, everything earlier rolls back — no partial state.

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

  -- 1. Children of service_records (deepest leaves)
  delete from chemical_logs   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from chemicals_added where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_tasks   where service_record_id in (select id from service_records where business_id = p_business_id);
  delete from service_photos  where service_record_id in (select id from service_records where business_id = p_business_id);

  -- 2. Tables that reference jobs, service_records, or automation_rules.
  --    automation_logs has the most inbound deps so it goes first; the
  --    rest just need to clear before jobs / service_records.
  delete from automation_logs where business_id = p_business_id;
  delete from documents       where business_id = p_business_id;
  delete from surveys         where business_id = p_business_id;
  delete from invoices        where business_id = p_business_id;

  -- 3. jobs (refs quotes, recurring_job_profiles, clients, pools, staff)
  delete from jobs            where business_id = p_business_id;

  -- 4. recurring_job_profiles (refs clients, pools, staff) — independent of jobs now
  delete from recurring_job_profiles where business_id = p_business_id;

  -- 5. quotes (refs clients, pools) — safe now: jobs.quote_id cleared
  delete from quotes          where business_id = p_business_id;

  -- 6. service_records (refs pools, staff) — safe: children + invoices +
  --    surveys + automation_logs all cleared
  delete from service_records where business_id = p_business_id;

  -- 7. Misc business-scoped tables, deepest-deps first.
  --    automation_rules.template_id → communication_templates so rules
  --    must go before templates.
  delete from automation_rules        where business_id = p_business_id;
  delete from communication_templates where business_id = p_business_id;
  delete from job_type_templates      where business_id = p_business_id;
  delete from pricing_items           where business_id = p_business_id;
  delete from chemical_products       where business_id = p_business_id;

  -- 8. pools (refs clients, staff_members) — safe now: jobs/quotes/
  --    service_records/recurring/documents all cleared
  delete from pools                   where business_id = p_business_id;

  -- 9. clients (refs staff_members via assigned_staff_id)
  delete from clients                 where business_id = p_business_id;

  -- 10. staff_members — by now nothing references it
  delete from staff_members           where business_id = p_business_id;

  -- 11. The business itself. activity_feed cascades on this; the new
  --     plans table is per-app (not per-business) so it's untouched.
  --     operator_actions sets its business_id to NULL so the audit
  --     trail survives.
  delete from businesses where id = p_business_id;

  return query select p_business_id, now();
end;
$$;

revoke all on function admin_delete_business(uuid) from public;
revoke all on function admin_delete_business(uuid) from anon;
revoke all on function admin_delete_business(uuid) from authenticated;
grant  execute on function admin_delete_business(uuid) to service_role;
