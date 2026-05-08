-- Allow free-text dose entries on chemicals_added.
--
-- The original schema had `quantity numeric not null` + `unit text
-- not null` — assumed the tech would always log a structured
-- (number, unit) pair, picked from a dropdown. In practice they
-- want to type things like "100g", "1kg", "half a scoop", "splash"
-- — units mid-string, sometimes informal. Forcing them to pick
-- between the two means we either lose information or block the
-- save.
--
-- Add a free-text `dose_text` column for the raw input, and relax
-- the structured columns to nullable. The app writes dose_text on
-- new rows; structured (quantity + unit) stays nullable for legacy
-- rows that pre-date this migration. Display layers prefer
-- dose_text when present and fall back to "{quantity} {unit}".

alter table public.chemicals_added
  add column if not exists dose_text text;

alter table public.chemicals_added
  alter column quantity drop not null;

alter table public.chemicals_added
  alter column unit drop not null;
