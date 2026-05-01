-- One-shot cleanup of duplicate client rows produced before the
-- duplicate-name guards landed in NewClientModal /
-- WorkOrders.handleCreateClientInline / RecurringJobs.handleQuickCreateClient.
--
-- Strategy: for each (business_id, normalised name) group, keep the
-- OLDEST row and delete the rest. Only deletes a duplicate if it has
-- NO inbound references in pools, jobs, quotes, invoices,
-- recurring_job_profiles, surveys, or documents. Duplicates that DO
-- have data attached survive and can be merged manually if needed —
-- this migration won't blow them away.
--
-- Idempotent: re-running on a clean database is a no-op (the WHERE
-- clause matches zero rows).

do $$
declare
  v_deleted int;
begin
  with dups as (
    select id,
           business_id,
           lower(trim(name)) as nname,
           row_number() over (
             partition by business_id, lower(trim(name))
             order by created_at, id
           ) as rn
    from clients
  ),
  deletable_dups as (
    select d.id
    from dups d
    where d.rn > 1
      -- Only delete dups that aren't referenced anywhere downstream
      and not exists (select 1 from pools                 p where p.client_id = d.id)
      and not exists (select 1 from jobs                  j where j.client_id = d.id)
      and not exists (select 1 from quotes                q where q.client_id = d.id)
      and not exists (select 1 from invoices              i where i.client_id = d.id)
      and not exists (select 1 from recurring_job_profiles r where r.client_id = d.id)
      and not exists (select 1 from surveys               s where s.client_id = d.id)
      and not exists (select 1 from documents             doc where doc.client_id = d.id)
  )
  delete from clients where id in (select id from deletable_dups);

  get diagnostics v_deleted = row_count;
  raise notice 'cleanup_duplicate_clients: deleted % empty duplicate client(s)', v_deleted;
end $$;
