-- Pre-launch critical security fixes (Phase 1 — DB only, no app change).
--
-- Four independent fixes, safe to apply as one transaction in the SQL editor:
--   1. Close the invoices cross-tenant read leak (a "using (true)" policy that
--      the July tenant-scope cleanup missed).
--   2. Require admin/owner to delete a client (delete_client had a tenant check
--      but no role check — any technician could hard-delete any client).
--   3. Close two staff-table privilege-escalation paths: INSERT of a privileged
--      seat by a non-admin, and repointing an already-linked seat's user_id.
--   4. Make the offline completion RPCs verify pool/profile ownership, not just
--      businessId (a caller could otherwise mutate another org's pool/profile).
--
-- All four preserve existing legitimate flows (admin staff management, invite
-- acceptance, normal service completion). Multi-tenant DB — nothing here is
-- unscoped.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. invoices: drop the world-readable policy + remove anon's direct grant.
--    "Business can manage invoices" (business_id = current_business_id()) stays
--    and remains the only way to read invoices. No public invoice-by-token page
--    exists (all reads are authenticated), so a straight drop is safe.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Public invoice access" on public.invoices;
revoke select on public.invoices from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. delete_client: add an admin/owner check. Recreated verbatim from
--    20260509140000 with the single added guard (marked below).
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- NEW: deleting a client (and its entire history) is an admin/owner action.
  if not current_user_is_admin() then
    raise exception 'Not authorised to delete this client';
  end if;

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

  delete from automation_logs
   where job_id in (select id from jobs where client_id = p_client_id)
      or service_record_id in (
        select id from service_records where pool_id in (select id from pools where client_id = p_client_id)
      );

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

  delete from jobs                   where client_id = p_client_id;
  delete from recurring_job_profiles where client_id = p_client_id;
  delete from quotes                 where client_id = p_client_id;
  delete from service_records        where pool_id in (select id from pools where client_id = p_client_id);
  delete from pools                  where client_id = p_client_id;
  delete from clients                where id = p_client_id;
end;
$$;

revoke all on function delete_client(uuid) from public;
revoke all on function delete_client(uuid) from anon;
grant  execute on function delete_client(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. staff_members privilege escalation.
--
--    (a) The manage policy had no WITH CHECK — make the tenant constraint on
--        INSERT/UPDATE explicit (defense-in-depth; the USING fallback already
--        scoped it, but be explicit).
--    (b) The role guard only fired BEFORE UPDATE, so a technician could INSERT a
--        fresh row with role='owner' + their own user_id and become admin. Guard
--        INSERT too, and block repointing an already-linked seat's user_id.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Business can manage staff" on staff_members;
create policy "Business can manage staff" on staff_members
  for all
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

create or replace function guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  -- Service role (edge functions, e.g. set-staff-password) and business
  -- admins/owners may do anything their RLS scope allows.
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A non-admin must not create a privileged seat. This is the INSERT-side
    -- twin of the UPDATE guard below (a tech could otherwise self-insert
    -- role='owner' and current_user_is_admin() would then match them).
    -- Invite acceptance is an UPDATE of an existing pending row, never an INSERT,
    -- so legitimate self-service never reaches here.
    if lower(coalesce(new.role, 'technician')) in ('admin', 'manager', 'owner') then
      raise exception 'Not authorised to create an admin or owner staff member';
    end if;
    return new;
  end if;

  -- UPDATE: block changes to the privileged columns. Name / phone / photo_url /
  -- preferred_language stay freely self-editable.
  if new.role is distinct from old.role
     or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true)
     or new.business_id is distinct from old.business_id then
    raise exception 'Not authorised to change staff role or status';
  end if;

  -- Block repointing an ALREADY-LINKED seat to a different auth user (seizing an
  -- admin seat by moving its user_id to yourself). A pending invite
  -- (old.user_id is null) stays freely linkable by the invite-accept flow.
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'Not authorised to reassign a linked staff account';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_staff_privileged on staff_members;
create trigger trg_guard_staff_privileged
  before insert or update on staff_members
  for each row execute function guard_staff_privileged_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Completion RPCs: verify the pool / recurring profile belong to the caller's
--    business, not just the payload's businessId. Recreated from 20260626000000
--    with the added ownership checks (marked NEW); bodies otherwise identical.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function complete_service_tx(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_biz  uuid := current_business_id();
  v_pool uuid := (p_payload->>'poolId')::uuid;
  v_prof uuid := nullif(p_payload->>'recurringProfileId', '')::uuid;
  v_occ  date := nullif(p_payload->>'occurrenceDate', '')::date;
  v_serviced timestamptz := coalesce((p_payload->>'servicedAt')::timestamptz, now());
begin
  if v_biz is null or (p_payload->>'businessId')::uuid is distinct from v_biz then
    raise exception 'Not authorised';
  end if;

  -- NEW: the pool and (if given) the recurring profile must also belong to this
  -- business. security definer bypasses RLS, so check explicitly — otherwise a
  -- caller could complete/mutate another org's pool or profile by id.
  if v_pool is not null and not exists (
    select 1 from pools where id = v_pool and business_id = v_biz
  ) then
    raise exception 'Not authorised';
  end if;
  if v_prof is not null and not exists (
    select 1 from recurring_job_profiles where id = v_prof and business_id = v_biz
  ) then
    raise exception 'Not authorised';
  end if;

  begin
    insert into service_records (
      id, business_id, pool_id, staff_id, technician_name, status, notes,
      serviced_at, recurring_profile_id, occurrence_date, is_one_off
    ) values (
      p_id, v_biz, v_pool, nullif(p_payload->>'staffId', '')::uuid,
      p_payload->>'technicianName', 'completed', p_payload->>'notes',
      v_serviced, v_prof,
      case when v_prof is not null then v_occ end,
      coalesce((p_payload->>'isOneOff')::boolean, false)
    );
  exception when unique_violation then
    return jsonb_build_object('applied', false, 'conflict', true);
  end;

  insert into chemical_logs (
    service_record_id, ph, free_chlorine, total_chlorine, alkalinity,
    stabiliser, calcium_hardness, salt
  ) values (
    p_id,
    (p_payload->'readings'->>'ph')::numeric,
    (p_payload->'readings'->>'free_chlorine')::numeric,
    (p_payload->'readings'->>'total_chlorine')::numeric,
    (p_payload->'readings'->>'alkalinity')::numeric,
    (p_payload->'readings'->>'stabiliser')::numeric,
    (p_payload->'readings'->>'calcium_hardness')::numeric,
    (p_payload->'readings'->>'salt')::numeric
  );

  insert into service_tasks (service_record_id, task_name, completed)
  select p_id, x->>'name', coalesce((x->>'completed')::boolean, false)
  from jsonb_array_elements(coalesce(p_payload->'tasks', '[]'::jsonb)) as x
  where coalesce(x->>'name', '') <> '';

  insert into chemicals_added (
    service_record_id, product_name, dose_text, stock_remaining, quantity, unit, cost
  )
  select p_id, x->>'product_name', nullif(x->>'dose_text', ''), nullif(x->>'stock_remaining', ''),
         nullif(x->>'quantity', '')::numeric, nullif(x->>'unit', ''), nullif(x->>'cost', '')::numeric
  from jsonb_array_elements(coalesce(p_payload->'chemicals', '[]'::jsonb)) as x
  where coalesce(x->>'product_name', '') <> '';

  insert into service_photos (
    service_record_id, storage_path, signed_url, tag, latitude, longitude, captured_at, client_photo_id
  )
  select p_id, x->>'storagePath', x->>'signedUrl', x->>'tag',
         nullif(x->>'lat', '')::numeric, nullif(x->>'lng', '')::numeric,
         nullif(x->>'capturedAt', '')::timestamptz, nullif(x->>'clientPhotoId', '')::uuid
  from jsonb_array_elements(coalesce(p_payload->'photos', '[]'::jsonb)) as x
  where coalesce(x->>'storagePath', '') <> ''
  on conflict (client_photo_id) where client_photo_id is not null do nothing;

  update pools set last_serviced_at = v_serviced where id = v_pool;

  if v_occ is not null then
    update jobs set status = 'completed'
    where pool_id = v_pool and scheduled_date = v_occ and status in ('scheduled', 'in_progress');
  end if;

  if v_prof is not null then
    update recurring_job_profiles
    set completed_visits = coalesce(completed_visits, 0) + 1
    where id = v_prof;
  end if;

  return jsonb_build_object('applied', true, 'conflict', false);
end;
$$;

revoke all on function complete_service_tx(uuid, jsonb) from public;
revoke all on function complete_service_tx(uuid, jsonb) from anon;
grant execute on function complete_service_tx(uuid, jsonb) to authenticated;

create or replace function mark_unable_to_service_tx(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_biz  uuid := current_business_id();
  v_pool uuid := (p_payload->>'poolId')::uuid;
  v_prof uuid := nullif(p_payload->>'recurringProfileId', '')::uuid;
  v_occ  date := nullif(p_payload->>'occurrenceDate', '')::date;
  v_serviced timestamptz := coalesce((p_payload->>'servicedAt')::timestamptz, now());
begin
  if v_biz is null or (p_payload->>'businessId')::uuid is distinct from v_biz then
    raise exception 'Not authorised';
  end if;

  -- NEW: same ownership checks as complete_service_tx.
  if v_pool is not null and not exists (
    select 1 from pools where id = v_pool and business_id = v_biz
  ) then
    raise exception 'Not authorised';
  end if;
  if v_prof is not null and not exists (
    select 1 from recurring_job_profiles where id = v_prof and business_id = v_biz
  ) then
    raise exception 'Not authorised';
  end if;

  begin
    insert into service_records (
      id, business_id, pool_id, staff_id, technician_name, status, unable_reason, notes,
      serviced_at, recurring_profile_id, occurrence_date, is_one_off
    ) values (
      p_id, v_biz, v_pool, nullif(p_payload->>'staffId', '')::uuid,
      p_payload->>'technicianName', 'unable_to_service',
      nullif(p_payload->>'reason', ''), nullif(p_payload->>'note', ''),
      v_serviced, v_prof,
      case when v_prof is not null then v_occ end,
      coalesce((p_payload->>'isOneOff')::boolean, false)
    );
  exception when unique_violation then
    return jsonb_build_object('applied', false, 'conflict', true);
  end;

  insert into service_photos (
    service_record_id, storage_path, signed_url, tag, latitude, longitude, captured_at, client_photo_id
  )
  select p_id, x->>'storagePath', x->>'signedUrl', x->>'tag',
         nullif(x->>'lat', '')::numeric, nullif(x->>'lng', '')::numeric,
         nullif(x->>'capturedAt', '')::timestamptz, nullif(x->>'clientPhotoId', '')::uuid
  from jsonb_array_elements(coalesce(p_payload->'photos', '[]'::jsonb)) as x
  where coalesce(x->>'storagePath', '') <> ''
  on conflict (client_photo_id) where client_photo_id is not null do nothing;

  if v_occ is not null then
    update jobs set status = 'unable_to_service'
    where pool_id = v_pool and scheduled_date = v_occ and status in ('scheduled', 'in_progress');
  end if;

  begin
    insert into activity_feed (business_id, type, title, description, link_to)
    values (
      v_biz,
      coalesce(nullif(p_payload->'activity'->>'type', ''), 'service_unable'),
      coalesce(nullif(p_payload->'activity'->>'title', ''), 'Unable to service'),
      p_payload->'activity'->>'description',
      p_payload->'activity'->>'linkTo'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('applied', true, 'conflict', false);
end;
$$;

revoke all on function mark_unable_to_service_tx(uuid, jsonb) from public;
revoke all on function mark_unable_to_service_tx(uuid, jsonb) from anon;
grant execute on function mark_unable_to_service_tx(uuid, jsonb) to authenticated;
