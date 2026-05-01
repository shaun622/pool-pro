-- Dedupe clients on the new "real" keys: email + phone. Two passes:
--   1. Group by (business_id, lower(trim(email))) for clients with a
--      non-empty email. Keep oldest, merge inbound FKs, delete rest.
--   2. Group by (business_id, normalized phone) where phone strips
--      everything that isn't a digit. Same merge pattern.
--
-- Email and phone are now the unique keys per the operator rule. Name
-- alone is no longer a dedup signal — two legitimate "John Smith"s
-- can coexist as long as their email/phone differ.
--
-- Idempotent: empty groups skip naturally. Re-runs are no-ops.

do $$
declare
  rec record;
  v_keeper_id uuid;
  v_dup_ids   uuid[];
  v_by_email  int := 0;
  v_by_phone  int := 0;
begin
  -- ── Pass 1: by email ───────────────────────────────────────────
  for rec in
    select business_id,
           lower(trim(email)) as nemail,
           array_agg(id order by created_at, id) as ids
    from clients
    where email is not null and trim(email) <> ''
    group by business_id, lower(trim(email))
    having count(*) > 1
  loop
    v_keeper_id := rec.ids[1];
    v_dup_ids   := rec.ids[2:];

    update pools                  set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update jobs                   set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update quotes                 set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update invoices               set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update recurring_job_profiles set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update surveys                set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update documents              set client_id = v_keeper_id where client_id = any(v_dup_ids);

    delete from clients where id = any(v_dup_ids);
    v_by_email := v_by_email + array_length(v_dup_ids, 1);
  end loop;

  -- ── Pass 2: by phone (digits-only) ─────────────────────────────
  -- Strips everything except 0-9 so "0400 123 456" collapses to
  -- "0400123456" and matches "0400123456". Skips short fragments
  -- (≥ 6 digits required) so a single-digit "5" doesn't snowball
  -- everyone with "5" anywhere in their phone.
  for rec in
    select business_id,
           regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as nphone,
           array_agg(id order by created_at, id) as ids
    from clients
    where phone is not null and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
    group by business_id, regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
    having count(*) > 1
  loop
    v_keeper_id := rec.ids[1];
    v_dup_ids   := rec.ids[2:];

    update pools                  set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update jobs                   set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update quotes                 set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update invoices               set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update recurring_job_profiles set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update surveys                set client_id = v_keeper_id where client_id = any(v_dup_ids);
    update documents              set client_id = v_keeper_id where client_id = any(v_dup_ids);

    delete from clients where id = any(v_dup_ids);
    v_by_phone := v_by_phone + array_length(v_dup_ids, 1);
  end loop;

  raise notice 'dedupe_clients_by_email_phone: % merged by email, % by phone',
    v_by_email, v_by_phone;
end $$;
