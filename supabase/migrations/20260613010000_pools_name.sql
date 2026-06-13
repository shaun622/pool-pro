-- Give pools an optional display name (e.g. "Main pool", "Spa",
-- "Rooftop lap pool"). Shown between the client name and the address
-- everywhere a pool stop is rendered, so an operator with two pools at
-- one client can tell them apart at a glance.
--
-- Nullable + no backfill: existing pools keep showing their address
-- only until the operator names them. The app renders the name line
-- conditionally, so a null name simply collapses to the prior
-- client → address layout.

alter table public.pools add column if not exists name text;
