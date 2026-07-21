-- Dedicated head-office report recipient, separate from the public/customer-facing
-- email (businesses.email). Until now the office copy of every service report went
-- to businesses.email — the same address shown to customers on quotes/invoices —
-- so there was no way to point the internal copy somewhere else.
--
-- report_email OVERRIDES the office recipient when set; when NULL/blank the edge
-- functions fall back to businesses.email, so every existing business keeps its
-- current behaviour with no data change.
--
-- businesses is an existing table with grants already in place — a new column
-- inherits them, so no GRANT block is needed (see CLAUDE.md "What NOT to touch").

alter table businesses add column if not exists report_email text;
