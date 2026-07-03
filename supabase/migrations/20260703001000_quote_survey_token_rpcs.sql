-- Tier-1 security, Part 2: move the anonymous quote/survey flows behind
-- token-scoped security-definer RPCs and drop the permissive table policies.
--
-- WHY: the public quote/survey pages did direct `.from().update()` under
-- `using (true)` (quotes) / `token is not null` (surveys), so anyone with the
-- anon key could read every quote (pricing, client, scope/terms) and set ANY
-- quote's status without the token, and read/overwrite any survey. RLS can't see
-- a query's WHERE token, so the fix is to funnel these flows through
-- security-definer functions that take the token and touch only the matched row.
-- These RPCs also fold in the client + business branding, which the anon pages
-- previously tried (and failed) to read directly (clients/businesses have no
-- anon policy), so branding + client name now actually render.

-- ── Quote: read by token ─────────────────────────────────────────────────────
create or replace function get_quote_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'quote',  to_jsonb(q),
    'client', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone, 'address', c.address),
    'business', jsonb_build_object(
      'id', b.id, 'name', b.name, 'logo_url', b.logo_url, 'brand_colour', b.brand_colour,
      'phone', b.phone, 'email', b.email, 'abn', b.abn, 'gst_rate', b.gst_rate, 'gst_enabled', b.gst_enabled
    )
  )
  from quotes q
  join clients c    on c.id = q.client_id
  join businesses b on b.id = q.business_id
  where q.public_token = p_token;
$$;

-- ── Quote: respond by token (accept/decline), only from a non-final state ─────
create or replace function respond_to_quote(p_token uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_status text;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'Invalid response';
  end if;

  update quotes
     set status = p_status,
         responded_at = now()
   where public_token = p_token
     and status not in ('accepted', 'declined')   -- idempotent: no re-responding / no TOCTOU double-accept
  returning status into v_status;

  if v_status is null then
    -- token not found, or already responded
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- ── Survey: read by token ────────────────────────────────────────────────────
create or replace function get_survey_by_token(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'survey', to_jsonb(s),
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'logo_url', b.logo_url, 'brand_colour', b.brand_colour)
  )
  from surveys s
  join businesses b on b.id = s.business_id
  where s.token = p_token;
$$;

-- ── Survey: submit by token, only if not already submitted ───────────────────
create or replace function submit_survey(p_token uuid, p_rating int, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Invalid rating';
  end if;

  update surveys
     set rating = p_rating,
         comment = nullif(btrim(coalesce(p_comment, '')), ''),
         submitted_at = now()
   where token = p_token
     and submitted_at is null
  returning id into v_id;

  return jsonb_build_object('ok', v_id is not null);
end;
$$;

-- Grants: these are the ONLY way the public pages touch quotes/surveys now.
revoke all on function get_quote_by_token(uuid)          from public, anon;
revoke all on function respond_to_quote(uuid, text)      from public, anon;
revoke all on function get_survey_by_token(uuid)         from public, anon;
revoke all on function submit_survey(uuid, int, text)    from public, anon;
grant execute on function get_quote_by_token(uuid)       to anon, authenticated;
grant execute on function respond_to_quote(uuid, text)   to anon, authenticated;
grant execute on function get_survey_by_token(uuid)      to anon, authenticated;
grant execute on function submit_survey(uuid, int, text) to anon, authenticated;

-- ── Drop the permissive direct-table policies (business policies remain) ──────
drop policy if exists "Public quote access"  on quotes;
drop policy if exists "Public quote respond" on quotes;
drop policy if exists "Public can view survey by token"   on surveys;
drop policy if exists "Public can submit survey by token" on surveys;

-- Anon no longer needs direct access (RPCs run as definer).
revoke select, update on quotes  from anon;
revoke select, update on surveys from anon;
