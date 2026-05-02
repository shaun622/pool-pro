-- Track which recurring occurrence a job replaces.
--
-- Previous attempt used recurring_job_profiles.skipped_dates to suppress
-- the original projection date when an operator moved an occurrence to
-- a new date. Worked for the suppress, but it didn't unwind: moving the
-- job BACK to the original date, or deleting the moved job, didn't
-- restore the projection because skipped_dates is on the profile and
-- has no link to the moving job.
--
-- Better: stash the link on the JOB. The job carries
--   replaces_recurring_date = the projection date this job replaced
-- and the schedule projector consults `jobs.replaces_recurring_date`
-- (per profile_id) to know which projection dates to skip. Then:
--   * Delete the moved job → the date is no longer "replaced" → the
--     projection naturally fires again. No manual unwind needed.
--   * Move the job back to the original date → real job is at the
--     original date AND replaces_recurring_date still points at it →
--     takenByProfile dedupes the projection (same effect either way).
--   * Move the job to yet another date → replaces_recurring_date stays
--     pointing at the original; the original stays suppressed.
--
-- skipped_dates stays on the profile but is now used ONLY for the
-- explicit "Delete this service only" action (no real job is created
-- there, so we have nowhere else to attach the marker).

alter table jobs
  add column if not exists replaces_recurring_date date;

-- Most schedule reads filter by recurring_profile_id; pair the index
-- so building the per-profile "replaced dates" set in projection is
-- a quick scan rather than a full table read.
create index if not exists jobs_replaces_recurring_idx
  on jobs (recurring_profile_id, replaces_recurring_date)
  where replaces_recurring_date is not null;
