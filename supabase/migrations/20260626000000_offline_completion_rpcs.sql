-- Offline mode keystone: atomic, replay-safe completion RPCs.
--
-- The tech app records a service as a multi-step sequence (service_records +
-- chemical_logs + service_tasks + chemicals_added + service_photos, plus
-- last_serviced_at, the job clear, and the completed_visits bump). Offline that
-- sequence is captured as a durable DRAFT and submitted later; a submit can be
-- retried (lost response, flaky link), so the whole thing must be ONE
-- transaction that is an exact no-op on replay.
--
-- These functions mirror useService.completeService / markUnableToService
-- exactly, keyed by a client-generated service_records.id (= the idempotency
-- key). They DO NOT write pools.next_due_at — recomputePoolNextDue stays the
-- single client-side writer (build guard), called after a successful submit.
--
-- Conflict-as-success: a duplicate id (replay) OR a duplicate occurrence
-- identity (the office already recorded that visit) both raise unique_violation,
-- which is caught and returned as { conflict: true }. The client treats conflict
-- exactly like success and clears the draft. The functions NEVER abort on 23505.
--
-- Columns on existing tables only (+ service_photos.client_photo_id) → the sole
-- new grants needed are EXECUTE on the two functions (per CLAUDE.md template).

-- ── Idempotent photo replay ──────────────────────────────────────────────
alter table service_photos
  add column if not exists client_photo_id uuid;

-- Partial unique so legacy rows (null) are exempt and never collide. Lets the
-- photo insert below dedupe a re-submitted photo by its stable client id.
create unique index if not exists service_photos_client_photo_id_uidx
  on service_photos (client_photo_id)
  where client_photo_id is not null;

-- ── complete_service_tx ──────────────────────────────────────────────────
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
  -- AuthZ FIRST (security definer bypasses RLS): the draft's business must be
  -- the caller's current business, or the visit could land in the wrong org.
  if v_biz is null or (p_payload->>'businessId')::uuid is distinct from v_biz then
    raise exception 'Not authorised';
  end if;

  -- Idempotent identity insert. Side effects below run ONLY because this insert
  -- succeeded, so a replay (PK conflict) or an office-won occurrence (identity
  -- uidx conflict) is an exact no-op returned as { conflict: true }.
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

  -- Chemical readings — always one row per completion (mirrors handleComplete).
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

  -- Tasks.
  insert into service_tasks (service_record_id, task_name, completed)
  select p_id, x->>'name', coalesce((x->>'completed')::boolean, false)
  from jsonb_array_elements(coalesce(p_payload->'tasks', '[]'::jsonb)) as x
  where coalesce(x->>'name', '') <> '';

  -- Chemicals added.
  insert into chemicals_added (
    service_record_id, product_name, dose_text, stock_remaining, quantity, unit, cost
  )
  select p_id, x->>'product_name', nullif(x->>'dose_text', ''), nullif(x->>'stock_remaining', ''),
         nullif(x->>'quantity', '')::numeric, nullif(x->>'unit', ''), nullif(x->>'cost', '')::numeric
  from jsonb_array_elements(coalesce(p_payload->'chemicals', '[]'::jsonb)) as x
  where coalesce(x->>'product_name', '') <> '';

  -- Photos (blobs already uploaded to their deterministic paths client-side).
  insert into service_photos (
    service_record_id, storage_path, signed_url, tag, latitude, longitude, captured_at, client_photo_id
  )
  select p_id, x->>'storagePath', x->>'signedUrl', x->>'tag',
         nullif(x->>'lat', '')::numeric, nullif(x->>'lng', '')::numeric,
         nullif(x->>'capturedAt', '')::timestamptz, nullif(x->>'clientPhotoId', '')::uuid
  from jsonb_array_elements(coalesce(p_payload->'photos', '[]'::jsonb)) as x
  where coalesce(x->>'storagePath', '') <> ''
  on conflict (client_photo_id) where client_photo_id is not null do nothing;

  -- last_serviced_at (display-only freshness).
  update pools set last_serviced_at = v_serviced where id = v_pool;

  -- Clear the occurrence's auto-job off the active route.
  if v_occ is not null then
    update jobs set status = 'completed'
    where pool_id = v_pool and scheduled_date = v_occ and status in ('scheduled', 'in_progress');
  end if;

  -- completed_visits bump — only for a real recurring occurrence.
  if v_prof is not null then
    update recurring_job_profiles
    set completed_visits = coalesce(completed_visits, 0) + 1
    where id = v_prof;
  end if;

  -- next_due_at intentionally NOT written here (single-writer guard; recompute
  -- runs client-side after the submit).

  return jsonb_build_object('applied', true, 'conflict', false);
end;
$$;

revoke all on function complete_service_tx(uuid, jsonb) from public;
revoke all on function complete_service_tx(uuid, jsonb) from anon;
grant execute on function complete_service_tx(uuid, jsonb) to authenticated;

-- ── mark_unable_to_service_tx ────────────────────────────────────────────
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

  -- Photos (tag = 'unable_access').
  insert into service_photos (
    service_record_id, storage_path, signed_url, tag, latitude, longitude, captured_at, client_photo_id
  )
  select p_id, x->>'storagePath', x->>'signedUrl', x->>'tag',
         nullif(x->>'lat', '')::numeric, nullif(x->>'lng', '')::numeric,
         nullif(x->>'capturedAt', '')::timestamptz, nullif(x->>'clientPhotoId', '')::uuid
  from jsonb_array_elements(coalesce(p_payload->'photos', '[]'::jsonb)) as x
  where coalesce(x->>'storagePath', '') <> ''
  on conflict (client_photo_id) where client_photo_id is not null do nothing;

  -- Drop the occurrence's job off the active route (without counting completed).
  if v_occ is not null then
    update jobs set status = 'unable_to_service'
    where pool_id = v_pool and scheduled_date = v_occ and status in ('scheduled', 'in_progress');
  end if;

  -- In-app bell for the office. Best-effort (nested) so a feed hiccup never
  -- fails the unable submission — mirrors the client's non-critical insert.
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
    -- swallow — the unable record is already committed
    null;
  end;

  -- No last_serviced_at, no completed_visits bump (nothing was serviced).
  -- next_due_at recomputed client-side after the submit.

  return jsonb_build_object('applied', true, 'conflict', false);
end;
$$;

revoke all on function mark_unable_to_service_tx(uuid, jsonb) from public;
revoke all on function mark_unable_to_service_tx(uuid, jsonb) from anon;
grant execute on function mark_unable_to_service_tx(uuid, jsonb) to authenticated;
