-- Portal business over-exposure (audit #9): the customer-portal SELECT policy on
-- businesses ("Customers can view their business") returned the WHOLE row to any
-- logged-in portal customer — Stripe customer/subscription ids, bank_details,
-- report_email_config, staff_seat_override, next_invoice_number. RLS is row-level,
-- not column-level, so restrict via a definer RPC that returns ONLY the
-- branding/contact fields the portal renders, and drop the whole-row customer
-- policy. The owner ("Users can view own business") and staff ("Staff can read
-- their business") SELECT policies are untouched. Mirrors get_quote_by_token.

create or replace function get_portal_business(p_business_id uuid)
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'logo_url', b.logo_url,
    'brand_colour', b.brand_colour,
    'phone', b.phone,
    'email', b.email
  )
  from businesses b
  where b.id = p_business_id
    and exists (
      select 1 from clients c
      where c.business_id = b.id and c.auth_user_id = auth.uid()
    );
$$;

revoke all on function get_portal_business(uuid) from public, anon;
grant execute on function get_portal_business(uuid) to authenticated;

-- Remove the whole-row customer read. Owner + staff SELECT policies remain.
drop policy if exists "Customers can view their business" on businesses;
