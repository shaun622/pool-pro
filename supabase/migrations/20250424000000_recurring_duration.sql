-- Recurring Service Duration: add duration/end options to recurring_job_profiles

-- Duration type: ongoing (default), until_date, num_visits
alter table recurring_job_profiles add column if not exists duration_type text default 'ongoing'
  check (duration_type in ('ongoing', 'until_date', 'num_visits'));

-- End date for until_date duration type
alter table recurring_job_profiles add column if not exists end_date date;

-- Total visits for num_visits duration type
alter table recurring_job_profiles add column if not exists total_visits integer;

-- Counter incremented on each service completion
alter table recurring_job_profiles add column if not exists completed_visits integer default 0;

-- Status: active, paused, completed, cancelled
alter table recurring_job_profiles add column if not exists status text default 'active'
  check (status in ('active', 'paused', 'completed', 'cancelled'));

-- Migrate existing rows: all current profiles are ongoing + active
update recurring_job_profiles
  set duration_type = 'ongoing', status = 'active'
  where duration_type is null or status is null;
