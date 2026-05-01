-- Full cleanup of duplicate clients + pools created during testing.
--
-- For every (business_id, lower(trim(name))) group of clients with
-- more than one row, pick the oldest as the keeper, re-point every
-- inbound FK to the keeper, and delete the rest. Same pattern for
-- (client_id, lower(trim(address))) pool duplicates that surface
-- after the client merge.
--
-- Idempotent — re-runs are no-ops once each group is collapsed.

do $$
declare
  rec record;
  v_keeper_id uuid;
  v_dup_ids   uuid[];
  v_clients_deleted int := 0;
  v_pools_deleted   int := 0;
begin
  -- ── 1. Clients ──────────────────────────────────────────────
  for rec in
    select business_id,
           lower(trim(name)) as nname,
           array_agg(id order by created_at, id) as ids
    from clients
    where name is not null and trim(name) <> ''
    group by business_id, lower(trim(name))
    having count(*) > 1
  loop
    v_keeper_id := rec.ids[1];
    v_dup_ids   := rec.ids[2:];

    update pools                  set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update jobs                   set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update quotes                 set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update invoices               set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update recurring_job_profiles set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update surveys                set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update documents              set client_id = v_keeper_id where client_id = any(v_dup_ids);

    delete from clients where id = any(v_dup_ids);
    v_clients_deleted := v_clients_deleted + array_length(v_dup_ids, 1);
  end loop;

  -- ── 2. Pools (after the client merge — duplicate addresses on the
  --        same surviving client become visible) ─────────────────
  for rec in
    select client_id,
           lower(trim(address)) as naddr,
           array_agg(id order by created_at, id) as ids
    from pools
    where address is not null and trim(address) <> ''
    group by client_id, lower(trim(address))
    having count(*) > 1
  loop
    v_keeper_id := rec.ids[1];
    v_dup_ids   := rec.ids[2:];

    update jobs                   set pool_id = v_keeper_id where pool_id = any(v_dup_ids);
    update quotes                 set pool_id = v_keeper_id where pool_id = any(v_dup_ids);
    update service_records        set pool_id = v_keeper_id where pool_id = any(v_dup_ids);
    update recurring_job_profiles set pool_id = v_keeper_id where pool_id = any(v_dup_ids);
    update documents              set pool_id = v_keeper_id where pool_id = any(v_dup_ids);

    delete from pools where id = any(v_dup_ids);
    v_pools_deleted := v_pools_deleted + array_length(v_dup_ids, 1);
  end loop;

  raise notice 'full_cleanup: merged % duplicate clients and % duplicate pools',
    v_clients_deleted, v_pools_deleted;
end $$;
