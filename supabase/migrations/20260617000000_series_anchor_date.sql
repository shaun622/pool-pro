-- Pattern-only recurring scheduling: immutable series anchor.
--
-- The recurrence pattern is now the single source of truth and occurrences are
-- enumerated from an IMMUTABLE origin date instead of the moving
-- next_generation_at pointer (which drifted/desynced and caused completed jobs
-- to vanish + the weekday to wander). next_generation_at becomes a read-only
-- mirror; pools.next_due_at becomes a derived cache (next unfulfilled
-- occurrence), written only by recomputePoolNextDue().
--
-- Column on an existing table → no GRANTs needed (RLS already covers it).

alter table recurring_job_profiles
  add column if not exists series_anchor_date date;

-- Backfill: the current next_generation_at is a valid ON-PATTERN date (it was
-- only ever reached by whole-interval steps from the original first date, so it
-- shares the same weekday/phase) — so the enumerated occurrence grid is
-- identical. created_at is the safe fallback for rows without one.
update recurring_job_profiles
   set series_anchor_date = coalesce(next_generation_at::date, created_at::date)
 where series_anchor_date is null;
