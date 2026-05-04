-- Per-business GST rate. PoolPro is Australian (10% GST today) but the
-- rate could change at any time, and the hardcoded 0.10 in
-- src/lib/utils.js calculateGST + the literal "GST (10%)" labels
-- across QuoteBuilder/InvoiceBuilder/PublicQuote made an across-
-- the-board rate change a code-deploy task instead of a settings
-- change.
--
-- Per-doc gst_rate is also added to quotes + invoices so historical
-- documents keep whatever rate they were issued under. Today
-- quotes.gst / invoices.gst store only the *amount* — without the
-- rate column, an operator changing their default rate would render
-- old draft docs with the new rate label even though their gst
-- amount was computed at the old rate. The rate column closes that
-- gap.
--
-- numeric(5,4) → up to 9.9999 (we won't see four-digit GST rates),
-- four decimal places handles 0.1234 cases like split rates without
-- floating-point drift.

alter table public.businesses
  add column if not exists gst_rate numeric(5,4) not null default 0.10;

alter table public.quotes
  add column if not exists gst_rate numeric(5,4);

alter table public.invoices
  add column if not exists gst_rate numeric(5,4);

comment on column public.businesses.gst_rate is
  'Per-business GST rate (decimal, e.g. 0.10 = 10%). Default rate for new quotes / invoices. Historical docs keep their own gst_rate column.';

comment on column public.quotes.gst_rate is
  'GST rate (decimal) at the time this quote was issued. Null for legacy quotes that predate this column — render those at business.gst_rate.';

comment on column public.invoices.gst_rate is
  'GST rate (decimal) at the time this invoice was issued. Null for legacy invoices that predate this column — render those at business.gst_rate.';
