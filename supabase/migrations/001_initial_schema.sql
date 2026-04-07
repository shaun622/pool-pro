-- PoolPro Initial Schema
-- Run this in your Supabase SQL editor

-- Businesses (created first so helper function can reference it)
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  name text not null,
  logo_url text,
  brand_colour text default '#0EA5E9',
  abn text,
  phone text,
  email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text default 'trial',
  trial_ends_at timestamptz default now() + interval '14 days',
  created_at timestamptz default now()
);

alter table businesses enable row level security;
create policy "Users can view own business" on businesses for select using (owner_id = auth.uid());
create policy "Users can insert own business" on businesses for insert with check (owner_id = auth.uid());
create policy "Users can update own business" on businesses for update using (owner_id = auth.uid());

-- Helper function for RLS (must be after businesses table)
create or replace function current_business_id()
returns uuid as $$
  select id from businesses where owner_id = auth.uid() limit 1;
$$ language sql security definer;

-- Clients
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz default now()
);

alter table clients enable row level security;
create policy "Business can manage clients" on clients for all using (business_id = current_business_id());

-- Pools
create table if not exists pools (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  client_id uuid references clients not null,
  address text not null,
  type text not null,
  volume_litres numeric,
  shape text,
  schedule_frequency text default 'weekly',
  access_notes text,
  equipment jsonb default '{}',
  target_ranges jsonb default '{"ph":[7.2,7.6],"free_cl":[1,3],"alk":[80,120],"stabiliser":[30,50],"calcium":[200,400]}',
  last_serviced_at timestamptz,
  next_due_at timestamptz,
  route_order integer default 0,
  portal_token uuid default gen_random_uuid(),
  created_at timestamptz default now()
);

alter table pools enable row level security;
create policy "Business can manage pools" on pools for all using (business_id = current_business_id());
-- Public portal access
create policy "Public portal access" on pools for select using (true);

-- Service Records
create table if not exists service_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  pool_id uuid references pools not null,
  technician_name text,
  serviced_at timestamptz default now(),
  status text default 'completed',
  notes text,
  report_sent_at timestamptz,
  created_at timestamptz default now()
);

alter table service_records enable row level security;
create policy "Business can manage service_records" on service_records for all using (business_id = current_business_id());
create policy "Public service records via pool" on service_records for select using (true);

-- Chemical Logs
create table if not exists chemical_logs (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid references service_records not null,
  ph numeric,
  free_chlorine numeric,
  total_chlorine numeric,
  alkalinity numeric,
  stabiliser numeric,
  calcium_hardness numeric,
  salt numeric,
  water_temp numeric,
  created_at timestamptz default now()
);

alter table chemical_logs enable row level security;
create policy "Access via service_record" on chemical_logs for all using (true);

-- Chemicals Added
create table if not exists chemicals_added (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid references service_records not null,
  product_name text not null,
  quantity numeric not null,
  unit text not null,
  cost numeric,
  created_at timestamptz default now()
);

alter table chemicals_added enable row level security;
create policy "Access via service_record" on chemicals_added for all using (true);

-- Service Tasks
create table if not exists service_tasks (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid references service_records not null,
  task_name text not null,
  completed boolean default false,
  created_at timestamptz default now()
);

alter table service_tasks enable row level security;
create policy "Access via service_record" on service_tasks for all using (true);

-- Service Photos
create table if not exists service_photos (
  id uuid primary key default gen_random_uuid(),
  service_record_id uuid references service_records not null,
  storage_path text not null,
  signed_url text,
  tag text,
  created_at timestamptz default now()
);

alter table service_photos enable row level security;
create policy "Access via service_record" on service_photos for all using (true);

-- Quotes
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  client_id uuid references clients not null,
  pool_id uuid references pools,
  status text default 'draft',
  line_items jsonb default '[]',
  scope text,
  terms text,
  subtotal numeric default 0,
  gst numeric default 0,
  total numeric default 0,
  public_token uuid default gen_random_uuid(),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz default now()
);

alter table quotes enable row level security;
create policy "Business can manage quotes" on quotes for all using (business_id = current_business_id());
create policy "Public quote access" on quotes for select using (true);
create policy "Public quote respond" on quotes for update using (true);

-- Jobs
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  client_id uuid references clients not null,
  pool_id uuid references pools,
  quote_id uuid references quotes,
  title text not null,
  status text default 'scheduled',
  scheduled_date date,
  notes text,
  created_at timestamptz default now()
);

alter table jobs enable row level security;
create policy "Business can manage jobs" on jobs for all using (business_id = current_business_id());

-- Pricing Items
create table if not exists pricing_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  name text not null,
  category text,
  unit text,
  default_price numeric,
  created_at timestamptz default now()
);

alter table pricing_items enable row level security;
create policy "Business can manage pricing_items" on pricing_items for all using (business_id = current_business_id());

-- Storage bucket for logos and photos
insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('service-photos', 'service-photos', true) on conflict do nothing;

-- Storage policies
create policy "Anyone can view logos" on storage.objects for select using (bucket_id = 'logos');
create policy "Authenticated users can upload logos" on storage.objects for insert with check (bucket_id = 'logos' and auth.role() = 'authenticated');
create policy "Anyone can view service photos" on storage.objects for select using (bucket_id = 'service-photos');
create policy "Authenticated users can upload photos" on storage.objects for insert with check (bucket_id = 'service-photos' and auth.role() = 'authenticated');

-- Indexes
create index if not exists idx_clients_business on clients(business_id);
create index if not exists idx_pools_business on pools(business_id);
create index if not exists idx_pools_client on pools(client_id);
create index if not exists idx_pools_next_due on pools(next_due_at);
create index if not exists idx_pools_portal_token on pools(portal_token);
create index if not exists idx_service_records_pool on service_records(pool_id);
create index if not exists idx_service_records_business on service_records(business_id);
create index if not exists idx_chemical_logs_service on chemical_logs(service_record_id);
create index if not exists idx_quotes_business on quotes(business_id);
create index if not exists idx_quotes_public_token on quotes(public_token);
create index if not exists idx_jobs_business on jobs(business_id);
