-- Branches: a lightweight, per-business grouping (a label + its own email), NOT
-- a separate tenant. A branch is used to (a) filter the schedule/calendar and
-- (b) route the office copy of service reports to the branch's email in addition
-- to head office. It changes nothing about tenant isolation — every branch lives
-- under one business and is scoped by current_business_id() like every other
-- table. New-table template per CLAUDE.md (table + grants + RLS + policy).

-- 1. Table
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  name text not null,
  email text,
  notify_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_branches_business on public.branches(business_id);

-- 2. Grants — branches are internal only (no anon/portal access needed).
grant select, insert, update, delete on public.branches to authenticated;
grant select, insert, update, delete on public.branches to service_role;

-- 3. RLS
alter table public.branches enable row level security;

-- 4. Policy — standard business-scoped single policy.
create policy "Business can manage branches" on public.branches
  for all
  using (business_id = current_business_id())
  with check (business_id = current_business_id());
