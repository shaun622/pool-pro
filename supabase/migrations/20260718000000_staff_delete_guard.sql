-- Staff DELETE guard (audit finding #6).
--
-- The prelaunch privilege guard (20260714000000) only fired BEFORE INSERT OR
-- UPDATE, so a plain technician could still `delete from staff_members` and remove
-- admin/owner (or any) seats in their own business — an admin-only destructive
-- action performed by a non-admin (the "Business can manage staff" policy is
-- `for all`, so DELETE passed with no role check). This recreates the guard
-- function to also cover DELETE and recreates the trigger with the DELETE event.
--
-- Two subtleties handled below:
--   * A BEFORE DELETE trigger must return OLD (returning NULL cancels the delete),
--     so the admin/service-role early return uses coalesce(new, old).
--   * admin_delete_business (the platform cascade that deletes staff rows) is
--     service_role-only, so auth.role() = 'service_role' lets its deletes through.

create or replace function guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  -- Service role (edge functions, e.g. set-staff-password, admin_delete_business)
  -- and business admins/owners may do anything their RLS scope allows. On DELETE,
  -- NEW is null → return OLD so the delete proceeds (returning null from a BEFORE
  -- DELETE trigger would CANCEL it).
  if auth.role() = 'service_role' or public.current_user_is_admin() then
    return coalesce(new, old);
  end if;

  -- DELETE: removing a staff member (and freeing/altering the seat count) is an
  -- admin/owner action — a plain technician must not delete seats. Mirrors the
  -- admin-only guard added to delete_client in 20260714000000.
  if tg_op = 'DELETE' then
    raise exception 'Not authorised to delete a staff member';
  end if;

  if tg_op = 'INSERT' then
    -- A non-admin must not create a privileged seat. This is the INSERT-side twin
    -- of the UPDATE guard below (a tech could otherwise self-insert role='owner'
    -- and current_user_is_admin() would then match them). Invite acceptance is an
    -- UPDATE of an existing pending row, never an INSERT, so legitimate
    -- self-service never reaches here.
    if lower(coalesce(new.role, 'technician')) in ('admin', 'manager', 'owner') then
      raise exception 'Not authorised to create an admin or owner staff member';
    end if;
    return new;
  end if;

  -- UPDATE: block changes to the privileged columns. Name / phone / photo_url /
  -- preferred_language stay freely self-editable.
  if new.role is distinct from old.role
     or coalesce(new.is_active, true) is distinct from coalesce(old.is_active, true)
     or new.business_id is distinct from old.business_id then
    raise exception 'Not authorised to change staff role or status';
  end if;

  -- Block repointing an ALREADY-LINKED seat to a different auth user (seizing an
  -- admin seat by moving its user_id to yourself). A pending invite (old.user_id is
  -- null) stays freely linkable by the invite-accept flow.
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'Not authorised to reassign a linked staff account';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_staff_privileged on staff_members;
create trigger trg_guard_staff_privileged
  before insert or update or delete on staff_members
  for each row execute function guard_staff_privileged_columns();
