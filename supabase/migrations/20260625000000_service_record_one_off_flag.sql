-- One-off ("extra") visits: a tech (or admin) can service ANY pool off-route,
-- on top of (or independent of) its recurring schedule, without that visit
-- fulfilling, advancing, suppressing or relabelling any recurring occurrence.
--
-- These records already carry NULL occurrence identity (recurring_profile_id +
-- occurrence_date), but null-identity is NOT a clean one-off signal: legacy
-- pre-identity rows and direct-open ad-hoc completions are also null-identity.
-- This explicit flag is the unambiguous signal used for UI labelling and for the
-- completion email's one-off branch (suppress the "Next Service" block).
--
-- Additive nullable-default column on an EXISTING table → no GRANTs needed
-- (existing tables keep their grants; only brand-new tables need the 2026-10-30
-- grant block per CLAUDE.md).

alter table service_records
  add column if not exists is_one_off boolean not null default false;
