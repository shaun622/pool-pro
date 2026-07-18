-- Staff-invite token: move the /invite/:token flow behind SECURITY DEFINER RPCs
-- and STOP exposing staff_members to anon (audit #1 — HARD LAUNCH GATE).
--
-- WHY: 20260703000000 narrowed anon's staff_members read to pending invites but
-- kept a blanket anon SELECT grant + a row-only policy. RLS can't filter columns
-- and the requester controls the WHERE, so anyone with the public anon key could
--   select name,email,phone,role,business_id,invite_token from staff_members
--   where invite_status='pending'
-- and harvest every business's invitee PII AND the secret invite_token (the sole
-- capability gating /invite/:token → cross-tenant PII disclosure + pending-seat
-- account-takeover). Fix: funnel the flow through definer RPCs that touch only the
-- token's own row and return the minimum, then drop anon's access entirely.
-- Mirrors get_quote_by_token / respond_to_quote (20260703001000).

-- ── Read one invite by token (anon, for the accept page). Returns ONLY the fields
--    the page renders — never invite_token, phone, role, or other invitees. ──────
create or replace function get_invite_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'name', s.name,
    'email', s.email,
    'business_name', b.name
  )
  from staff_members s
  join businesses b on b.id = s.business_id
  where s.invite_token = p_token
    and s.invite_status = 'pending'
  limit 1;
$$;

-- ── Claim the invite AFTER the invitee has signed up. Self-links the caller
--    (auth.uid()) to the matched pending row — never trusts a client-supplied
--    user_id. Requires the caller's authenticated email to match the invite, so a
--    leaked token alone can't bind an unrelated account to the seat. ────────────
create or replace function claim_staff_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id           uuid;
  v_email        text;
  v_caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to accept an invite';
  end if;

  select id, lower(email) into v_id, v_email
  from staff_members
  where invite_token = p_token
    and invite_status = 'pending'
    and user_id is null
  limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  -- The invite must be for the caller's own email (the signup used the invited
  -- email). Blocks a signed-in user from claiming an invite meant for someone else.
  if v_email is distinct from v_caller_email then
    raise exception 'This invite is for a different email address';
  end if;

  update staff_members
     set user_id       = auth.uid(),
         invite_status = 'accepted',
         invite_token  = null
   where id = v_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Grants: the RPCs are the ONLY way the invite flow touches staff_members now ─
revoke all on function get_invite_by_token(uuid) from public, anon;
revoke all on function claim_staff_invite(uuid)  from public, anon;
grant execute on function get_invite_by_token(uuid) to anon, authenticated;
grant execute on function claim_staff_invite(uuid)  to authenticated;

-- ── Remove anon's direct access to staff_members entirely ──────────────────────
drop policy if exists "Anon read pending invites" on staff_members;
revoke select on staff_members from anon;
