-- Per-occurrence skip list for recurring_job_profiles.
--
-- For single-day cadence rules (weekly, fortnightly, monthly cadence)
-- the schedule projector uses next_generation_at as the anchor, so
-- "skip just this Friday" is achievable by advancing next_generation_at
-- past it. For multi-day-per-week rules (bi_weekly, tri_weekly) the
-- projector enumerates every preferred_days_of_week match in the visible
-- range — next_generation_at is ignored, so advancing it doesn't hide
-- the moved occurrence. Result: moving a Friday occurrence to Tuesday
-- creates the real job on Tuesday but Friday's projection keeps firing,
-- and the schedule shows the same pool on both days.
--
-- skipped_dates is the missing piece. It's a date[] of "operator
-- explicitly moved or skipped this occurrence" markers. The projection
-- excludes any matching date from its enumeration.

alter table recurring_job_profiles
  add column if not exists skipped_dates date[] not null default '{}';
