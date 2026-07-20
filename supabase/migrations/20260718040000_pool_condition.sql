-- Pool condition on arrival (Good / Cloudy / Dirty / Green). A required tech input
-- on the arrival step, surfaced as a colour-coded banner in the ADMIN report only.
-- Stored on service_records; written by complete_service_tx from p_payload.poolCondition.

alter table service_records add column if not exists pool_condition text;

-- Recreate complete_service_tx to persist pool_condition. Body is IDENTICAL to
-- 20260714000000 except the two marked lines in the service_records insert.
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
      serviced_at, recurring_profile_id, occurrence_date, is_one_off,
      pool_condition                                                    -- NEW
    ) values (
      p_id, v_biz, v_pool, nullif(p_payload->>'staffId', '')::uuid,
      p_payload->>'technicianName', 'completed', p_payload->>'notes',
      v_serviced, v_prof,
      case when v_prof is not null then v_occ end,
      coalesce((p_payload->>'isOneOff')::boolean, false),
      nullif(p_payload->>'poolCondition', '')                           -- NEW
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
