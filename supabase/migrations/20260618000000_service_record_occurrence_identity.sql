-- Occurrence identity on service records.
--
-- Recurring fulfillment is now matched by the IDENTITY of the scheduled visit a
-- record fulfils — (recurring_profile_id, occurrence_date) — instead of
-- inferring it from serviced_at date-bucketing. This mirrors how skip
-- (recurring_job_profiles.skipped_dates) and move (jobs.replaces_recurring_date)
-- already record occurrence dates.
--
--   * recurring_profile_id — which profile's series this record fulfils.
--   * occurrence_date       — WHICH scheduled visit (the pattern date). The
--                             canonical identity. serviced_at stays "when it was
--                             actually performed" and may differ (early / late).
--
-- Both nullable: ad-hoc / non-recurring services leave them null, fulfil no
-- occurrence, and render on serviced_at. Columns on an existing table → no
-- GRANTs needed (RLS already covers service_records). service_records.status has
-- no CHECK constraint, so no enum change is required.

alter table service_records
  add column if not exists recurring_profile_id uuid references recurring_job_profiles;

alter table service_records
  add column if not exists occurrence_date date;

-- DB guardrail: at most one fulfillment per (profile, occurrence). Partial so
-- the many null-identity rows (ad-hoc) are exempt and never collide. This is the
-- constraint that prevents phantom-duplicate regressions at the database level.
create unique index if not exists service_records_occurrence_identity_uidx
  on service_records (recurring_profile_id, occurrence_date)
  where recurring_profile_id is not null;
