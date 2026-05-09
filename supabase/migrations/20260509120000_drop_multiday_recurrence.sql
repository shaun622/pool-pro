-- Remove multi-day-per-week recurrence rules.
--
-- bi_weekly (2/week) and tri_weekly (3/week) caused recurring "ghost
-- day" projection bugs across the schedule view: the chip grid drifted
-- from the operator's anchor day, every delete / move / skip path had
-- to special-case the multi-day rules, and the global meaning of
-- "bi-weekly" (every 2 weeks) clashed with the in-app meaning (twice
-- a week). Recurring services are now single-day-per-occurrence only.
-- Two services per week = two `weekly` profiles anchored on different
-- weekdays.
--
-- This migration flips any existing multi-day profiles to plain
-- weekly and clears their preferred_days_of_week. The anchor weekday
-- (preferred_day_of_week / next_generation_at) is left intact, so
-- those profiles will continue to project on whichever weekday they
-- were originally anchored to. Operators with bi/tri-weekly services
-- pre-migration will lose the secondary days and need to add a
-- second profile if they want them back — flagged at deploy.
--
-- The preferred_days_of_week column itself is left in place
-- (nullable) for back-compat with any historical / external read.
-- A follow-up migration can drop the column once we're sure nothing
-- still reads it.

update public.recurring_job_profiles
set
  recurrence_rule = 'weekly',
  preferred_days_of_week = null
where recurrence_rule in ('bi_weekly', 'tri_weekly');

-- Pools mirror the active profile's recurrence_rule into
-- pools.schedule_frequency for the legacy path-2 projector. Flip any
-- pool still carrying the old strings to weekly so the schedule view
-- stops emitting ghost multi-day stops on the next page load.
update public.pools
set schedule_frequency = 'weekly'
where schedule_frequency in ('bi_weekly', 'tri_weekly');
