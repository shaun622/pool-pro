-- Per-business GST opt-in. Until a business hits the AU GST
-- registration threshold ($75k turnover), they're not allowed to
-- charge GST on quotes / invoices. The previous migration (gst_rate)
-- assumed GST was always charged and only let the operator pick
-- the rate, so an unregistered tradie still saw "GST 10%" on every
-- doc with no way to remove it (typing "0" silently snapped back
-- to the default).
--
-- Default true preserves current behaviour for any existing rows
-- that were already issuing GST docs. New tradies (or existing
-- ones who flip this off) get rate=0 written onto new docs, the
-- GST line is hidden in totals / PDFs / portal pages, and the
-- "incl. GST" caption disappears from totals.
--
-- Per-doc gst_rate stays as the source of truth for an issued doc,
-- so toggling this off at the business level doesn't retroactively
-- rewrite history.

alter table public.businesses
  add column if not exists gst_enabled boolean not null default true;

comment on column public.businesses.gst_enabled is
  'Whether this business currently charges GST. False = unregistered (or temporarily not charging); new quotes / invoices write gst_rate=0 and the GST line is hidden in totals.';
