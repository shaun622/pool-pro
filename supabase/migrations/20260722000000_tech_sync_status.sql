-- Per-technician (per-device) offline-outbox heartbeat.
--
-- The tech's phone is the only place that knows how many completed visits are still
-- queued in its IndexedDB outbox. Each device reports its pending count here so the
-- operator dashboard can show "who is still uploading" live, instead of the operator
-- having to message the crew.
--
-- Rows are per (staff_id, device_id): one staff login can be open on more than one
-- device, and unique(staff_id) alone would let an idle second device (e.g. an office
-- tablet, empty outbox) overwrite the field phone's real pending count with 0 — the
-- exact false-negative this card exists to prevent. The reader aggregates per staff.

-- 1. Table
create table if not exists public.tech_sync_status (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  staff_id uuid not null references staff_members(id) on delete cascade,
  device_id uuid not null,          -- random UUID persisted in the device's localStorage
  staff_name text,
  staff_phone text,                 -- denormalised for tap-to-Call (realtime payloads don't join)
  pending_count int not null default 0,
  outbox_status text,               -- idle|sending|retrying|stuck|failed|auth|wrong-org
  oldest_pending_at timestamptz,    -- createdAt of the oldest queued draft
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (staff_id, device_id)      -- upsert conflict target
);
create index if not exists idx_tech_sync_status_business on public.tech_sync_status(business_id);

-- 2. Grants (required for new tables from 2026-10-30). anon does not read this.
grant select, insert, update, delete on public.tech_sync_status to authenticated;
grant select, insert, update, delete on public.tech_sync_status to service_role;

-- 3. RLS
alter table public.tech_sync_status enable row level security;

-- 4. Policy — business-scoped, mirrors branches
drop policy if exists "Business can manage tech_sync_status" on public.tech_sync_status;
create policy "Business can manage tech_sync_status" on public.tech_sync_status
  for all
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- 5. Touch trigger. A column default fires on INSERT only, so the upsert's conflict-
-- UPDATE would leave updated_at frozen at first-insert time forever — and the card's
-- "last seen / no signal" logic reads updated_at, so it would falsely mark every
-- actively-beating tech offline. A server-side now() is also immune to field-phone
-- clock skew. Mirrors plans_touch_updated_at (20260501021324_plans.sql).
create or replace function touch_tech_sync_status_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists tech_sync_status_touch on public.tech_sync_status;
create trigger tech_sync_status_touch
  before update on public.tech_sync_status
  for each row execute function touch_tech_sync_status_updated_at();

-- 6. Realtime — so the operator dashboard updates live as counts tick down. Guarded so
-- re-pasting the whole (otherwise idempotent) script doesn't abort on 42710 "already
-- member of publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tech_sync_status'
  ) then
    execute 'alter publication supabase_realtime add table public.tech_sync_status';
  end if;
end $$;
