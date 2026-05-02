-- Profile-level duration so a recurring service can carry a default
-- "60 min" / "90 min" estimate that propagates to every materialised
-- job. Without this column, the StopDetailModal "Apply to all future
-- Mondays" scope can't propagate a duration change — it only has
-- per-job columns to write to.
--
-- Existing per-job estimated_duration_minutes stays — the profile
-- value is just the default that a generated/materialised job picks
-- up. A per-occurrence override (scope=this_stop) writes only the
-- job's column and leaves the profile alone.

alter table recurring_job_profiles
  add column if not exists estimated_duration_minutes integer
  check (estimated_duration_minutes is null or estimated_duration_minutes > 0);
