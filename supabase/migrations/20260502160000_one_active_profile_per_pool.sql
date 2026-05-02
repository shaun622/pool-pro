-- Enforce single active recurring_job_profile per pool.
--
-- The schedule projection runs profile-based dedupe per profile.id, not
-- per pool_id, so multiple active profiles for the same pool show up as
-- multiple stops in the schedule (the "indo test on Fri AND Sat" bug).
-- AddRecurringModal used to always INSERT regardless of existing actives,
-- which is how the duplicates got there in the first place.
--
-- This migration:
--   1. Backfill: deactivates the older active profile(s) per pool, keeping
--      the most recently created one as the canonical active. The older
--      rows stay around for history with is_active=false / status='cancelled'
--      so the schedule no longer projects them.
--   2. Adds a partial UNIQUE index on (pool_id) WHERE is_active = true.
--      The application now guards against this in AddRecurringModal +
--      StopDetailModal save handlers, but the index is a belt-and-braces
--      so a future code path can't reintroduce the duplication silently.

-- 1. Backfill — for each pool with >1 active profile, keep the newest by
-- created_at and deactivate the rest. NULL pool_id rows are excluded
-- (they're profiles created before pool linkage existed).
with ranked as (
  select
    id,
    row_number() over (
      partition by pool_id
      order by created_at desc, id desc
    ) as rn
  from recurring_job_profiles
  where pool_id is not null
    and is_active = true
)
update recurring_job_profiles p
  set is_active = false,
      status = case when status = 'active' then 'cancelled' else status end
  from ranked r
  where p.id = r.id
    and r.rn > 1;

-- 2. Partial unique index. Enforces invariant going forward; a future
-- code path that forgets the deactivate-then-insert dance will fail
-- loudly at write time rather than silently corrupt the projection.
create unique index if not exists recurring_job_profiles_one_active_per_pool
  on recurring_job_profiles (pool_id)
  where is_active = true;
