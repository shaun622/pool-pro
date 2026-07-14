-- In-app security audit log (Phase 3c).
--
-- Until now nothing recorded security-relevant actions, so a compromised admin's
-- client deletions, staff role changes and password resets were invisible. This
-- adds an admin-readable, append-only event log written from the DB (triggers +
-- security-definer functions) so it can't be bypassed by calling PostgREST
-- directly, plus from the set-staff-password edge function.

-- 1. Table. business_id cascades so a business wipe (admin_delete_business) and
--    delete_client don't FK-block on their own audit rows.
create table if not exists public.security_events (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  target_type   text,
  target_id     uuid,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_security_events_business on public.security_events (business_id, created_at desc);

-- 2. Grants. Clients may only READ (via the admin policy). All writes come from
--    security-definer functions / triggers / the service role, never a client.
grant select on public.security_events to authenticated;
grant select, insert on public.security_events to service_role;

-- 3. RLS
alter table public.security_events enable row level security;

-- 4. Policy — admins/owners read their own business's events; nobody reads others'.
drop policy if exists "Admins read security_events" on public.security_events;
create policy "Admins read security_events" on public.security_events
  for select using (business_id = current_business_id() and current_user_is_admin());

-- ── Logging helpers (security definer so they can insert regardless of the
--    caller's grants; each swallows its own errors so logging never breaks the
--    underlying operation). ─────────────────────────────────────────────────

-- Client deletions (via delete_client, admin_delete_business, or any path).
create or replace function log_client_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  begin
    select email into v_email from auth.users where id = v_actor;
    insert into public.security_events (business_id, actor_user_id, actor_email, action, target_type, target_id, metadata)
    values (old.business_id, v_actor, v_email, 'client.delete', 'client', old.id,
            jsonb_build_object('name', old.name));
  exception when others then
    null;
  end;
  return old;
end;
$$;

drop trigger if exists trg_log_client_deletion on clients;
create trigger trg_log_client_deletion
  after delete on clients
  for each row execute function log_client_deletion();

-- Staff seat creation / role change / (de)activation / deletion.
create or replace function log_staff_security_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  begin
    select email into v_email from auth.users where id = v_actor;
    if tg_op = 'INSERT' then
      insert into public.security_events (business_id, actor_user_id, actor_email, action, target_type, target_id, metadata)
      values (new.business_id, v_actor, v_email, 'staff.create', 'staff_member', new.id,
              jsonb_build_object('name', new.name, 'role', new.role));
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role then
        insert into public.security_events (business_id, actor_user_id, actor_email, action, target_type, target_id, metadata)
        values (new.business_id, v_actor, v_email, 'staff.role_change', 'staff_member', new.id,
                jsonb_build_object('from', old.role, 'to', new.role));
      end if;
      if coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true) then
        insert into public.security_events (business_id, actor_user_id, actor_email, action, target_type, target_id, metadata)
        values (new.business_id, v_actor, v_email,
                case when new.is_active then 'staff.activate' else 'staff.deactivate' end,
                'staff_member', new.id, jsonb_build_object('name', new.name));
      end if;
    elsif tg_op = 'DELETE' then
      insert into public.security_events (business_id, actor_user_id, actor_email, action, target_type, target_id, metadata)
      values (old.business_id, v_actor, v_email, 'staff.delete', 'staff_member', old.id,
              jsonb_build_object('name', old.name));
    end if;
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_staff_security on staff_members;
create trigger trg_log_staff_security
  after insert or update or delete on staff_members
  for each row execute function log_staff_security_event();
