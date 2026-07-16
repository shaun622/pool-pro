-- Customisable wording for the service-report emails (Settings → Notifications).
-- One JSON blob per business holding subject/intro/signoff for the CUSTOMER
-- report and the ADMIN summary, e.g.:
--   { "customer": { "subject": "...", "intro": "...", "signoff": "..." },
--     "admin":    { "subject": "...", "intro": "...", "signoff": "..." } }
-- Any empty/missing field falls back to the built-in default in the
-- complete-service edge function. `businesses` is an existing table with RLS +
-- grants already in place, so no new grants are needed.
alter table businesses
  add column if not exists report_email_config jsonb not null default '{}'::jsonb;
