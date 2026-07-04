-- Per-record dismissal for the dashboard "Unable to service — needs follow-up"
-- banner. Setting this hides the item from that admin reminder ONLY — the record
-- is untouched (still openable + reopenable) and every other surface (technician
-- report, schedule, client fulfilment) keeps counting it as unable. A new
-- unable-to-service record has this null, so it still surfaces.
--
-- Existing table: no new grants/RLS needed. The "Business can manage
-- service_records" for-all policy already permits the UPDATE that sets this.
alter table service_records add column if not exists followup_dismissed_at timestamptz;
