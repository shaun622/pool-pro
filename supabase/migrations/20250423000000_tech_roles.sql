-- Tech Role Support: link staff_members to auth.users for tech login

-- Add user_id to link staff members to Supabase auth accounts
alter table staff_members add column if not exists user_id uuid references auth.users;

-- Add invite flow columns
alter table staff_members add column if not exists invite_token uuid default gen_random_uuid();
alter table staff_members add column if not exists invite_status text default 'pending' check (invite_status in ('pending', 'accepted'));

-- Update role column to support admin/tech distinction
-- (column already exists with default 'technician', but we want 'admin'|'tech' semantics)
-- Keep backwards compat: 'technician' maps to 'tech' in the app

-- Index for fast user_id lookups (used on every page load for tech users)
create index if not exists idx_staff_user_id on staff_members(user_id) where user_id is not null;

-- Index for invite token lookups
create unique index if not exists idx_staff_invite_token on staff_members(invite_token) where invite_token is not null;

-- Allow staff members to read their own business data
-- The existing RLS policy on businesses only allows owner_id = auth.uid()
-- We need staff to also be able to read their business row
create policy "Staff can read their business" on businesses for select
  using (
    id in (
      select business_id from staff_members where user_id = auth.uid()
    )
  );
