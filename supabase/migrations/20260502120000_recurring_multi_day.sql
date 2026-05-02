-- Multi-day-per-week + Nth-weekday-of-month recurring schedules.
--
-- Until now a recurring profile had ONE preferred day of week and a
-- single cadence interval (weekly / fortnightly / monthly / 6_weekly /
-- quarterly / custom). For a pool service business that runs services
-- 2 or 3 times a week on the same days (e.g. Mon/Wed/Fri), there was no
-- way to model that. And monthly was a coarse "every ~30 days from the
-- anchor", with no concept of "first Monday of every month".
--
-- This migration adds:
--   * preferred_days_of_week int[]   -- the days for bi_weekly / tri_weekly
--   * monthly_week_of_month  int     -- 1..4 for "Nth weekday of month",
--                                       5 means "last weekday of month"
--   * Two new recurrence_rule values:
--       'bi_weekly'  - 2 visits/week, requires preferred_days_of_week[2]
--       'tri_weekly' - 3 visits/week, requires preferred_days_of_week[3]
--
-- Existing recurrence_rule values stay valid so legacy profiles keep
-- generating jobs at their old cadence; they're just no longer offered
-- in the create UI. Existing single-day rows get backfilled into the
-- new array column for consistency.

alter table recurring_job_profiles
  add column if not exists preferred_days_of_week integer[];

alter table recurring_job_profiles
  add column if not exists monthly_week_of_month integer
  check (monthly_week_of_month is null or monthly_week_of_month between 1 and 5);

-- Replace the recurrence_rule CHECK so it accepts the two new values.
alter table recurring_job_profiles
  drop constraint if exists recurring_job_profiles_recurrence_rule_check;

alter table recurring_job_profiles
  add constraint recurring_job_profiles_recurrence_rule_check
  check (recurrence_rule in (
    'weekly', 'fortnightly', 'bi_weekly', 'tri_weekly',
    'monthly', '6_weekly', 'quarterly', 'custom'
  ));

-- Validate that bi/tri weekly profiles always carry the right day count.
-- NOT VALID so existing rows aren't retroactively rejected — they'd
-- have to be repaired before the constraint is validated, which we
-- don't need yet (no existing profile uses bi_weekly / tri_weekly).
alter table recurring_job_profiles
  drop constraint if exists recurring_job_profiles_bi_tri_days_check;

alter table recurring_job_profiles
  add constraint recurring_job_profiles_bi_tri_days_check
  check (
    (recurrence_rule <> 'bi_weekly'
       or (preferred_days_of_week is not null
           and array_length(preferred_days_of_week, 1) = 2))
    and
    (recurrence_rule <> 'tri_weekly'
       or (preferred_days_of_week is not null
           and array_length(preferred_days_of_week, 1) = 3))
    and
    (preferred_days_of_week is null
       or (preferred_days_of_week <@ array[0,1,2,3,4,5,6]))
  ) not valid;

-- Backfill: copy single preferred_day_of_week into the array column so
-- later code can read days uniformly from the array.
update recurring_job_profiles
  set preferred_days_of_week = array[preferred_day_of_week]
  where preferred_day_of_week is not null
    and preferred_days_of_week is null;
