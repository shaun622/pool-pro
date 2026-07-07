-- Enforce at the DB that only admins/owners can EDIT or DELETE services,
-- schedules, and jobs — role was previously a UI-only gate (the RLS on these
-- tables is business-scoped with no role check, so a technician's account could
-- UPDATE/DELETE them via direct API calls).
--
-- We keep the legitimate NON-admin writes working:
--   * completions go through the security-definer complete_service_tx /
--     mark_unable_to_service_tx RPCs — they INSERT service_records (not guarded)
--     and UPDATE only jobs.status + recurring_job_profiles.completed_visits;
--   * recomputePoolNextDue (client-side, after every completion) updates only
--     recurring_job_profiles.next_generation_at / status='completed';
--   * the tech "reopen an unable visit" flow DELETEs the unable service_record
--     and sets jobs.status='scheduled'.
-- Security-definer bypasses RLS but NOT triggers, so we use column-aware BEFORE
-- UPDATE/DELETE triggers (same pattern as the staff_members role guard). Reuses
-- current_user_is_admin() from 20260703002000_staff_role_enforcement.sql.

-- ── service_records: no tech UPDATE; tech DELETE only of an unable record ─────
create or replace function guard_service_records_role()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- allow the "reopen" flow (delete of an unable record); block deleting history
    if old.status is distinct from 'unable_to_service' then
      raise exception 'Not authorised to delete this service';
    end if;
    return old;
  end if;
  -- UPDATE by a non-admin: techs never legitimately edit a service_record
  -- (completions are INSERTs via the RPC).
  raise exception 'Not authorised to edit services';
end;
$$;

drop trigger if exists trg_guard_service_records_role on service_records;
create trigger trg_guard_service_records_role
  before update or delete on service_records
  for each row execute function guard_service_records_role();

-- ── jobs: non-admin may only change `status` (completion / unable / reopen) ───
create or replace function guard_jobs_role()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Not authorised to delete jobs';
  end if;
  -- Only a status change is allowed, and only to the completion/reopen values.
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
     or coalesce(new.status, '') not in ('completed', 'unable_to_service', 'scheduled') then
    raise exception 'Not authorised to edit jobs';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_jobs_role on jobs;
create trigger trg_guard_jobs_role
  before update or delete on jobs
  for each row execute function guard_jobs_role();

-- ── recurring_job_profiles: non-admin may only touch the derived/system cols ──
create or replace function guard_recurring_profiles_role()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Not authorised to delete recurring schedules';
  end if;
  -- Block any change to the schedule DEFINITION. Non-admins may only change the
  -- system-maintained columns the completion RPC + recompute write.
  if (to_jsonb(new) - 'completed_visits' - 'next_generation_at' - 'last_generated_at' - 'status')
       is distinct from
     (to_jsonb(old) - 'completed_visits' - 'next_generation_at' - 'last_generated_at' - 'status') then
    raise exception 'Not authorised to edit recurring schedules';
  end if;
  -- If status changed, only recompute's "ended -> completed" transition is allowed
  -- (no tech pause/cancel/reactivate).
  if new.status is distinct from old.status and new.status is distinct from 'completed' then
    raise exception 'Not authorised to change a recurring schedule''s status';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_recurring_profiles_role on recurring_job_profiles;
create trigger trg_guard_recurring_profiles_role
  before update or delete on recurring_job_profiles
  for each row execute function guard_recurring_profiles_role();
