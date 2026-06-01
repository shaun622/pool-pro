# PoolPro

React 18 + Vite SPA, Supabase Postgres (Auth + RLS) backend, Cloudflare Pages auto-deploys from `main` on push.

## Migrations

Files live under `supabase/migrations/` and follow the `YYYYMMDDHHMMSS_short_description.sql` naming convention. There is **no CLI runner on this repo** — every migration is applied manually in the Supabase SQL editor by the operator. When you ship a migration, drop the SQL into the final message so they can copy-paste it.

### New-table migration template

From **October 30, 2026** onwards, the Supabase Data API no longer auto-exposes new tables in the `public` schema — any new table without explicit `GRANT` statements returns `42501 permission denied for table X` to `supabase-js`. Existing tables are unaffected; this only matters for new ones.

Every new-table migration should include all four blocks below in this order:

```sql
-- 1. Table
create table public.your_table (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  -- ...columns...
  created_at timestamptz not null default now()
);

-- 2. Grants — required from 2026-10-30. Without these, supabase-js
-- queries fail with: { code: '42501', message: 'permission denied for table ...' }
grant select on public.your_table to anon;
grant select, insert, update, delete on public.your_table to authenticated;
grant select, insert, update, delete on public.your_table to service_role;

-- 3. RLS
alter table public.your_table enable row level security;

-- 4. Policy — most PoolPro tables use this single-policy pattern
create policy "Business can manage your_table" on public.your_table
  for all using (business_id = current_business_id());
```

The `current_business_id()` helper lives in `20250101000000_initial_schema.sql` line 27 and resolves the caller's business via their staff_member record. Use it for every business-scoped table.

If a table is read-only for clients (e.g. a public quote token lookup), grant only the privileges that role actually needs — don't blanket-grant `insert/update/delete` to `anon`.

### New-function migration template

Postgres functions exposed via `supabase.rpc('fn_name', ...)` need their own explicit grants. The pattern already used by `delete_client` (in `20260509140000_delete_client_function.sql`) and `admin_delete_business` (in `20260501030052_admin_delete_business_full_order.sql`):

```sql
create or replace function your_fn(p_arg uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
begin
  -- Authorisation check FIRST. security definer bypasses RLS during the
  -- function body, so verify the caller has rights to whatever the
  -- function touches before touching it.
  select business_id into v_business_id from <some_table> where id = p_arg;
  if v_business_id is distinct from current_business_id() then
    raise exception 'Not authorised';
  end if;

  -- ...function body...
end;
$$;

revoke all on function your_fn(uuid) from public;
revoke all on function your_fn(uuid) from anon;
grant  execute on function your_fn(uuid) to authenticated;
-- Use `to service_role` instead for admin-only functions that should
-- only be callable from edge functions / server-side code.
```

### Reference: Supabase changelog

The grants change is tracked at https://github.com/orgs/supabase/discussions/45329. Key dates:

- **2026-05-30** — new behaviour becomes default for newly-created Supabase projects.
- **2026-10-30** — enforced on all existing projects (PoolPro's deadline).

## What NOT to touch

- **Existing tables keep their grants forever.** Don't retrofit `GRANT` statements into the 13 existing table-creation migrations — they ran once, against an empty DB, in an order that worked. Touching them risks breaking fresh-clone bootstrap for no live benefit (the running project's grants are persisted server-side).
- **Don't run the changelog's project-wide `alter default privileges ... revoke ...` block** unless we deliberately opt in early. The 2026-10-30 enforcement gives us a fail-fast safety net without needing to flip the switch ourselves.
- **`auth`, `storage`, `realtime` schemas** are outside this change — keep them alone.

## Build / deploy

- `npm run build` — Vite production build. Cloudflare Pages picks up `dist/` after `git push origin main`.
- No tests configured; verification is manual (the operator runs through the affected flows on the deployed preview / live URL).
- Logs in the Cloudflare Pages dashboard; runtime errors in supabase-js bubble up to the in-app toast via `useToast`.

## Recurring services model (post-cleanup)

Recurring is **single-day-per-occurrence only.** Multi-day-per-week rules (`bi_weekly`, `tri_weekly`) were removed; 2x weekly is two separate `weekly` profiles anchored on different days. `AddRecurringModal` supports "+ Add another schedule" so the operator can stack profiles in one transaction. The DB no longer enforces one active profile per pool (partial unique index dropped in `20260509130000_allow_multiple_active_profiles_per_pool.sql`); the schedule projector dedupes per-day-per-pool instead.

`occurrencesInRange` in `src/lib/recurringScheduling.js` caps projection at `profile.created_at` so the cursor's backward walk never emits stops before the profile existed.
