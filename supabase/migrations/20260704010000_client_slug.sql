-- Human-readable client URLs: /clients/<name-slug> instead of /clients/<uuid>.
-- A per-business-unique `slug` on clients, auto-maintained by a trigger.

alter table clients add column if not exists slug text;

-- Backfill existing rows deterministically, BEFORE the trigger exists so it
-- doesn't reprocess them. Per business: slugify lower(name); empty -> 'client';
-- disambiguate duplicates with -2, -3, … by created order.
with base as (
  select id, business_id, created_at,
         nullif(trim(both '-' from regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g')), '') as b
  from clients
), numbered as (
  select id,
         coalesce(b, 'client') as b,
         row_number() over (partition by business_id, coalesce(b, 'client') order by created_at, id) as rn
  from base
)
update clients c
   set slug = case when n.rn = 1 then n.b else n.b || '-' || n.rn end
  from numbered n
 where c.id = n.id and c.slug is null;

create unique index if not exists clients_business_slug_uniq on clients(business_id, slug);

-- Auto-assign a unique slug on insert, and regenerate when the name changes. If
-- the name is unchanged and a slug already exists, keep it (stable bookmarks).
-- security definer so the uniqueness scan sees every client of the business
-- regardless of the caller's RLS view. Covers ALL insert paths (app, import).
create or replace function public.set_client_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  n int := 1;
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.slug is not null then
    return new;
  end if;
  base_slug := nullif(trim(both '-' from regexp_replace(lower(coalesce(new.name, '')), '[^a-z0-9]+', '-', 'g')), '');
  if base_slug is null then base_slug := 'client'; end if;
  candidate := base_slug;
  while exists (
    select 1 from public.clients
    where business_id = new.business_id and slug = candidate and id is distinct from new.id
  ) loop
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

drop trigger if exists trg_set_client_slug on clients;
create trigger trg_set_client_slug
  before insert or update on clients
  for each row execute function public.set_client_slug();
