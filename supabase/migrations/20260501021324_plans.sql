-- DB-backed plan catalog. Each app's customer-facing Subscription page
-- and the FieldSuite HQ Plans panel both read/write here. Per-business
-- plan field (businesses.plan) references plans.slug informally —
-- there's intentionally NO foreign key so that deactivating a plan
-- via is_active=false doesn't break legacy assignments.
--
-- service_role writes; anon read everything (Subscription page is
-- pre-auth on the trial flow). The table holds NO secrets — Stripe
-- price IDs land in a separate non-public column when integrated.

create table if not exists plans (
  slug         text primary key,
  name         text not null,
  price_cents  int  not null default 0,
  period       text not null default 'month',  -- month | year | once
  max_staff    int  not null default 1,
  features     jsonb not null default '{}',
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table plans enable row level security;

-- Public read so the customer's Subscription page (anon key) can fetch
-- the available plans on visit. No insert/update/delete policies →
-- service-role-only writes.
create policy plans_public_read on plans for select using (true);

-- Auto-bump updated_at on every PATCH from HQ admin so we have a
-- recency signal for cache busting later.
create or replace function plans_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists plans_set_updated_at on plans;
create trigger plans_set_updated_at
  before update on plans
  for each row execute function plans_touch_updated_at();

-- Seed: copy the PoolPro Subscription.jsx PLANS array verbatim so the
-- existing customer experience is byte-identical after this migration.
-- features JSONB matches the shape the FeatureCheck component already
-- expects (boolean | display-string per key).
insert into plans (slug, name, price_cents, period, max_staff, features, sort_order, is_active) values
  (
    'trial',
    'Trial',
    0,
    '14 days',
    1,
    jsonb_build_object(
      'pools',              '5 pools',
      'staff',              '1 staff member',
      'serviceHistory',     '30 days',
      'chemistryLog',       true,
      'routeSheet',         true,
      'clientPortal',       true,
      'quotesPdf',          false,
      'photoAttachments',   false,
      'inventoryTracking',  false,
      'customBranding',     false,
      'prioritySupport',    false
    ),
    0,
    true
  ),
  (
    'starter',
    'Starter',
    900,
    'month',
    2,
    jsonb_build_object(
      'pools',              'Unlimited',
      'staff',              '2 staff members',
      'serviceHistory',     'Unlimited',
      'chemistryLog',       true,
      'routeSheet',         true,
      'clientPortal',       true,
      'quotesPdf',          true,
      'photoAttachments',   true,
      'inventoryTracking',  false,
      'customBranding',     false,
      'prioritySupport',    false
    ),
    1,
    true
  ),
  (
    'pro',
    'Pro',
    1900,
    'month',
    10,
    jsonb_build_object(
      'pools',              'Unlimited',
      'staff',              '10 staff members',
      'serviceHistory',     'Unlimited',
      'chemistryLog',       true,
      'routeSheet',         true,
      'clientPortal',       true,
      'quotesPdf',          true,
      'photoAttachments',   true,
      'inventoryTracking',  true,
      'customBranding',     true,
      'prioritySupport',    true
    ),
    2,
    true
  )
on conflict (slug) do nothing;
