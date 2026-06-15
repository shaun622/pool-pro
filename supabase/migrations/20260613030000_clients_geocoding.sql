-- Give clients the same geocoding columns pools already have
-- (20250418000000_geocoding.sql), so a client address can store a
-- pinned location and render a map — full parity with pools. The app
-- writes these from the shared LocationField (autocomplete + map pin)
-- used by both client and pool address forms.
--
-- Nullable, no backfill: existing clients keep a null location until
-- their address is re-saved through a form that captures coordinates.

alter table public.clients add column if not exists latitude numeric;
alter table public.clients add column if not exists longitude numeric;
alter table public.clients add column if not exists geocoded_at timestamptz;
