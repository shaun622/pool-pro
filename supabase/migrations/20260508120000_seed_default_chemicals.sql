-- Seed seven standard pool chemicals into chemical_products for every
-- business + auto-seed for any new business going forward.
--
-- Why: ops + accounting want a single canonical chemical list across
-- the fleet of techs. Letting techs free-add chemicals during a service
-- meant the library drifted by typo + per-business ad-hoc names — same
-- product saved as "HCL", "HCl", "Hydrochloric Acid", "Acid (HCl)",
-- etc. — and the on-site stock the office buys never matched what the
-- tech logged. Lock the staff-facing list to this canonical seven; the
-- admin can add more from /settings/chemicals if anything genuinely
-- new shows up in the future. (See NewService.jsx step 3 for the
-- companion change that strips the "+ Add Chemical Manually" button.)
--
-- Idempotent: the chemical_products table has UNIQUE (business_id,
-- name) so the inserts use ON CONFLICT DO NOTHING and re-running the
-- migration is a no-op once the seven rows are present.

-- 1. Backfill: insert the seven canonical chemicals for every existing
--    business. Per-business uniqueness prevents duplicates if a name
--    already exists (e.g. an admin already added "Salt" by hand).
insert into public.chemical_products (business_id, name, default_unit)
select b.id, c.name, c.unit
from public.businesses b
cross join (values
  ('TCCA Granular',                          'g'),
  ('Salt',                                   'kg'),
  ('Sodium Hypochlorite (Liquid Chlorine)',  'L'),
  ('Hydrochloric Acid (HCl)',                'mL'),
  ('Soda Ash',                               'g'),
  ('Clarifier',                              'mL'),
  ('PAC',                                    'g')
) as c(name, unit)
on conflict (business_id, name) do nothing;

-- 2. Trigger: same seven chemicals auto-seed when a new business is
--    created, so a fresh pool company onboarding through the signup
--    flow gets the canonical library on day 1 with zero manual setup.
create or replace function public.seed_default_chemicals_for_business()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.chemical_products (business_id, name, default_unit) values
    (new.id, 'TCCA Granular',                          'g'),
    (new.id, 'Salt',                                   'kg'),
    (new.id, 'Sodium Hypochlorite (Liquid Chlorine)',  'L'),
    (new.id, 'Hydrochloric Acid (HCl)',                'mL'),
    (new.id, 'Soda Ash',                               'g'),
    (new.id, 'Clarifier',                              'mL'),
    (new.id, 'PAC',                                    'g')
  on conflict (business_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_default_chemicals_on_business_insert on public.businesses;
create trigger seed_default_chemicals_on_business_insert
  after insert on public.businesses
  for each row execute function public.seed_default_chemicals_for_business();
