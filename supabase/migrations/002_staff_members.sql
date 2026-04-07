-- Staff Members
create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  name text not null,
  role text default 'technician',
  phone text,
  email text,
  photo_url text,
  bio text,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table staff_members enable row level security;
create policy "Business can manage staff" on staff_members for all using (business_id = current_business_id());
-- Public read access for portal/email display
create policy "Public staff read" on staff_members for select using (true);

-- Add staff_id to service_records so we know which tech did the service
alter table service_records add column if not exists staff_id uuid references staff_members;

-- Add assigned_staff_id to clients so each client has a regular technician
alter table clients add column if not exists assigned_staff_id uuid references staff_members;

-- Add assigned_staff_id to pools so each pool can have its own assigned tech
alter table pools add column if not exists assigned_staff_id uuid references staff_members;

-- Storage bucket for staff photos
insert into storage.buckets (id, name, public) values ('staff-photos', 'staff-photos', true) on conflict do nothing;
create policy "Anyone can view staff photos" on storage.objects for select using (bucket_id = 'staff-photos');
create policy "Authenticated users can upload staff photos" on storage.objects for insert with check (bucket_id = 'staff-photos' and auth.role() = 'authenticated');
create policy "Authenticated users can update staff photos" on storage.objects for update using (bucket_id = 'staff-photos' and auth.role() = 'authenticated');

-- Index
create index if not exists idx_staff_business on staff_members(business_id);
create index if not exists idx_service_records_staff on service_records(staff_id);
