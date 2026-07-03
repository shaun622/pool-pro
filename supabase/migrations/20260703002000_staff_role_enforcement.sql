-- Tier-1 security, Part 3: enforce staff role at the database.
--
-- WHY: the "Business can manage staff" policy is `for all using (business_id =
-- current_business_id())` with no role check. Since current_business_id() now
-- resolves for any logged-in staff member, a technician could
--   update staff_members set role = 'admin' where id = <self>
-- and the app (useBusiness) would then grant them admin UI. More generally a
-- tech could reactivate a disabled seat or move a seat to another business.
--
-- We fix this WITHOUT touching the read/write policies (which the invite-accept
-- and tech self-service flows depend on) by adding a BEFORE UPDATE trigger that
-- blocks changes to the privileged columns (role / is_active / business_id) by
-- anyone who is not a business admin/owner or the service role. Non-privileged
-- self-edits (name, phone, photo_url, preferred_language) and the invite-accept
-- linking (user_id / invite_status / invite_token) are unaffected, so no client
-- code changes are required.

-- Is the current caller a business owner or an admin/manager staff member?
create or replace function current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (select 1 from businesses where owner_id = auth.uid())
      or exists (
        select 1 from staff_members
        where user_id = auth.uid()
          and is_active
          and lower(role) in ('admin', 'manager', 'owner')
      );
$$;
revoke all on function current_user_is_admin() from public, anon;
grant execute on function current_user_is_admin() to authenticated;

-- Guard the privileged columns. Invoker-rights (not security definer) so
-- auth.role() reflects the real caller.
create or replace function guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  -- Service role (edge functions, e.g. set-staff-password) and business
  -- admins/owners may change anything their RLS scope allows.
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return new;
  end if;

  -- Everyone else (a technician editing their own row) must not touch the
  -- privileged columns. This blocks self-promotion to admin, self-reactivation,
  -- and moving a seat to another business. Name / phone / photo_url /
  -- preferred_language stay freely self-editable; user_id / invite_status /
  -- invite_token (invite acceptance) are not guarded.
  if new.role is distinct from old.role
     or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true)
     or new.business_id is distinct from old.business_id then
    raise exception 'Not authorised to change staff role or status';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_staff_privileged on staff_members;
create trigger trg_guard_staff_privileged
  before update on staff_members
  for each row execute function guard_staff_privileged_columns();
