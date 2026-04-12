# PoolPro — Project Audit & Architecture

> Snapshot for an evaluating Claude session. Treat this as a map, not a spec — the code is the source of truth. File paths and line counts as of commit `489c748` (2026-04-11).

---

## 1. What it is

**PoolPro** (also referred to as PoolMate in older docs) is a mobile-first PWA for Australian pool maintenance businesses. It is the operator app: the pool tech logs in, manages their clients/pools, runs through routes, performs services, sends quotes, raises invoices, and lets customers see their own pool history through a public portal.

- **Audience**: solo operators and small fleets in Australia (AUD, GST, en-AU date format).
- **Form factor**: PWA, designed phone-first. Recently extended to look reasonable on desktop (top-bar nav + wider grids), but mobile is the primary surface and the user is protective of it ("the mobile is at the moment is great, don't touch it").
- **Hosting**: Railway (`npm run start` → `serve dist -s -l ${PORT}`), built with Vite. Auto-deploys on push to `main`.
- **Backend**: Supabase (Postgres + RLS + Auth + Storage). Each operator owns one `businesses` row; everything else is scoped via the `current_business_id()` SQL helper.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Framework | React 18.3.1 (no TS) |
| Bundler | Vite 6 |
| Styling | Tailwind CSS 3.4 + small set of `@layer components` classes |
| Routing | react-router-dom 6.28 |
| State / data | Supabase JS client + custom hooks (no Redux/Zustand) |
| Maps | Mapbox (geocoding + autocomplete) and Leaflet/react-leaflet for map rendering |
| Charts | recharts |
| Dates | date-fns |
| PWA | vite-plugin-pwa with NetworkFirst caching for navigations + Supabase responses |
| Deploy | Railway, served by `serve` |

`vite.config.js` splits `react-vendor`, `recharts`, and `supabase` into separate chunks. Lazy-loaded routes (everything except the auth shell) keep first paint small.

---

## 3. Repo layout

```
src/
  App.jsx                 # Router + auth/business guards + AppShell mount
  main.jsx                # Vite entry
  styles/index.css        # Tailwind directives + component classes (.btn, .card, ...)
  components/
    layout/
      AppShell.jsx        # TopNav + <Outlet/> + BottomNav
      TopNav.jsx          # md+ sticky desktop nav (5 routes, brand left, links right)
      BottomNav.jsx       # Mobile bottom tab bar (md:hidden)
      Header.jsx          # Per-page sticky title bar (back arrow + right slot)
      PageWrapper.jsx     # max-w-lg / md:max-w-5xl|7xl, responsive padding
    ui/                   # Atoms: Button, Card, Badge, Modal, Input, EmptyState, ...
    PoolFormFields.jsx    # Shared pool create/edit fields + buildPoolPayload helper
  pages/                  # Route components (see §6)
  hooks/                  # useAuth, useBusiness, useClients, usePools, useService, useStaff, useActivity
  lib/
    supabase.js           # createClient with env vars
    utils.js              # date/format/status helpers, frequency labels, defaults
    mapbox.js             # geocodeAddress + autocomplete
    templateEngine.js     # Communication template variable substitution
supabase/migrations/      # 20 timestamped SQL files (see §5)
```

---

## 4. Routing (from `src/App.jsx`)

All real routes are wrapped in `<ProtectedRoute>` (auth required) → `<BusinessGuard>` (a business row must exist) → `<AppShell>`.

### Public
| Path | Page |
|---|---|
| `/login`, `/signup` | Auth |
| `/onboarding` | First-run business setup |
| `/portal/login`, `/portal/setup/:token`, `/portal`, `/portal/:token` | Customer self-service portal |
| `/quote/:token` | Public quote acceptance |
| `/survey/:token` | Public NPS / feedback survey |

### Authenticated
| Path | Page | Notes |
|---|---|---|
| `/` | `Dashboard.jsx` | Hero + stats + Ready/Overdue/Recent. Desktop uses 4-col stats and 2-col content layout. |
| `/route` | `Route.jsx` | Schedule with List / Upcoming / Map / Calendar sub-views. Projects `recurring_job_profiles` forward. (1086 lines — biggest page.) |
| `/clients` | `Clients.jsx` | Active Clients (with pools) and All Clients (CRM view). Search works on both views. |
| `/clients/:id` | `ClientDetail.jsx` | Client + pools + services + history. (979 lines.) |
| `/pools/:id` | `PoolDetail.jsx` | Pool dashboard (chemicals, history, equipment). |
| `/pools/:id/service` | `NewService.jsx` | 4-step service wizard (Chemicals → Tasks → Added → Review). |
| `/services/:id` | `ServiceDetail.jsx` | Read-only completed service record. |
| `/jobs` | `Jobs.jsx` | Jobs + Quotes tabs with filters. (925 lines.) |
| `/jobs/:id` | `JobDetail.jsx` | Job edit/run. |
| `/recurring-jobs` | `RecurringJobs.jsx` | Manages `recurring_job_profiles`. |
| `/quotes`, `/quotes/new`, `/quotes/:id` | `Quotes.jsx`, `QuoteBuilder.jsx` | Sales pipeline. |
| `/invoices`, `/invoices/new`, `/invoices/:id` | `Invoices.jsx`, `InvoiceBuilder.jsx` | Invoicing. |
| `/reports` | `Reports.jsx` | Charts (recharts). |
| `/subscription` | `Subscription.jsx` | Stripe plan management (placeholder). |
| `/settings` | `Settings.jsx` | Settings hub. |
| `/settings/staff` | `Staff.jsx` | Staff members. |
| `/settings/chemicals` | `ChemicalLibrary.jsx` | Operator's chemical product catalog with dosing. |
| `/settings/templates` | `CommunicationTemplates.jsx` | SMS/email templates. |
| `/settings/job-types` | `JobTypeTemplates.jsx` | Reusable job type definitions. |
| `/settings/automations` | `Automations.jsx` | Trigger-based automations. |
| `/settings/surveys` | `SurveyResults.jsx` | Survey responses. |
| `/settings/integrations` | `Integrations.jsx` | Third-party integrations. |
| `/settings/import` | `ImportData.jsx` | CSV import. |

---

## 5. Database (Supabase)

Schema is built incrementally via 20 migration files in `supabase/migrations/`. The data model is multi-tenant via `business_id` columns + RLS using a `current_business_id()` SQL function.

### Core tables (initial schema)
- `businesses` — one per operator. `owner_id` ↔ `auth.users`.
- `clients` — name, email, phone, address, notes.
- `pools` — `client_id`, address, type (chlorine/salt/...), volume, shape, frequency, equipment jsonb, target_ranges jsonb, `next_due_at`, `last_serviced_at`, geocode (`latitude`, `longitude`, `geocoded_at`), `route_order`, `portal_token`.
- `service_records` — pool service entries (status: scheduled / in_progress / completed).
- `chemical_logs`, `tasks_completed`, `chemicals_added` — child rows for a service record.

### Added by later migrations (use the file names as a quick map)
- `staff_members`, `add_assigned_staff` — multi-tech support.
- `chemical_products` + `chemical_products_dosage` — operator's reusable chemical catalog.
- `customer_portal_auth` + `customer_portal_rls` + `customer_chemical_products_rls` — customer-facing portal access via token.
- `communication_templates` — SMS/email templates with variables.
- `job_type_templates` — reusable job type defs.
- `recurring_jobs` — `recurring_job_profiles` table (anchor + interval + custom_interval_days). Schedule projects these forward.
- `automations` — automation rules table.
- `surveys` — public feedback surveys with shareable tokens.
- `sales_pipeline` — quotes, quote_lines, pipeline stages.
- `invoicing` — invoices, invoice_lines.
- `geocoding` — adds lat/lng/geocoded_at to pools.
- `documents` — document uploads tied to clients/pools/jobs.
- `client_pipeline_stage` — CRM-style status on clients.
- `quote_recurring_settings` — recurring quote support.
- `activity_feed` — feed events for the bell/notification panel.

### RLS pattern
Almost every table has `for all using (business_id = current_business_id())`. The `current_business_id()` helper is `security definer` and looks up the business by `owner_id = auth.uid()`. Public-facing tables (`pools` for portal) have additional permissive `for select` policies.

---

## 6. Hooks layer (`src/hooks`)

Thin wrappers around Supabase queries. They don't add caching beyond the component's own state — each consumer triggers its own fetch on mount.

| Hook | Purpose |
|---|---|
| `useAuth.jsx` | Wraps `supabase.auth`, exposes `user`, `loading`, `signOut`. Provider in `App.jsx`. |
| `useBusiness.jsx` | Loads the business row for the current user. Provider in `App.jsx`. |
| `useClients.js` | List/create clients. |
| `usePools.js` | List pools for the current business. |
| `useService.js` | Heavy hook — drives the NewService wizard (createServiceRecord, saveChemicalLog, saveTasks, saveChemicalsAdded, completeService). |
| `useStaff.js` | Staff members CRUD. |
| `useActivity.js` | Activity feed bell. |

There is **no** central data store and **no** SWR/React Query — pages re-fetch when they mount. Watch out for stale lists when navigating back after mutations.

---

## 7. Design system

There is a `DESIGN_SYSTEM.md` in the repo root that describes a "Modern Hospitality PWA" aesthetic (cream bg, serif display, pill buttons). **PoolPro has not adopted that aesthetic** — only the responsive top-bar / bottom-bar split pattern was borrowed. Don't try to apply the rest unless asked.

### What's actually in use

- **Background**: `bg-slate-50`.
- **Brand**: `pool` color scale defined in `tailwind.config.js` (50 → 950, 500 = `#0CA5EB`, 600 = `#0084C9`, 700 = `#0069A3`). Brand gradient is `bg-gradient-brand` (135deg pool-500 → pool-700).
- **Fonts**: system sans (no custom font).
- **Shadows**: custom `card`, `card-hover`, `elevated`, `glow`, `nav`, `inner-soft`.
- **Border radius**: `2xl` = 1rem, `3xl` = 1.25rem. Buttons use `rounded-xl` (NOT pill).
- **Touch targets**: `min-h-tap` / `min-w-tap` = 44px (Apple HIG).
- **Animations**: `fade-in`, `slide-up`, `scale-in`, `slide-in-right` keyframes defined in tailwind config.
- **Component classes** (defined in `src/styles/index.css`):
  - `.btn`, `.btn-primary` (gradient + white text), `.btn-secondary`, `.btn-danger`
  - `.card`, `.card-interactive`, `.card-gradient`
  - `.input`, `.input-lg`
  - `.glass` (backdrop-blur + white/80)
  - `.section-title` (uppercase tracking-wider)

### Conventions

- **No emojis** in source files unless asked.
- **No eyebrow labels** (the user explicitly rejected them when offered).
- **Mobile is sacred** — do not change spacing/sizes/components on mobile without explicit ask. Desktop changes go behind `md:` breakpoints.
- **No horizontal scroll filter strips on mobile**. Use `flex flex-wrap` instead. The user disliked both `overflow-x-auto` sliders AND a `<select>` dropdown alternative.
- **Buttons**: the `<Button>` component bakes `btn-primary` (gradient + white text) — overriding `bg-white text-pool-X` via `className` does NOT win. Use a plain `<button>` element when you need a non-gradient style.
- **Card elevation**: prefer `Card` (uses `.card-interactive` automatically when given an `onClick`).

### Layout shell (current)

- `BusinessGuard` → renders `<AppShell />` which wraps every authed page in `<TopNav>` (md+ only) + `<Outlet/>` + `<BottomNav>` (md:hidden).
- `Header` is per-page (sticky title bar with back arrow + optional right slot). It's still rendered on desktop *below* the TopNav.
- `PageWrapper` accepts `width="default" | "wide"`:
  - `default`: `max-w-lg md:max-w-5xl`
  - `wide`: `max-w-lg md:max-w-7xl`
- Mobile is always `max-w-lg`. Padding `px-4 md:px-8`, bottom `pb-24 md:pb-8` (no bottom nav on desktop).

### Desktop grid pattern

After the recent desktop refresh, list pages use this pattern instead of single columns:

```jsx
<div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
  {items.map(...)}
</div>
```

Applied on Clients (Active + All), Jobs (jobs + quotes). Dashboard goes further and splits its content area into a 2-col layout (Ready/Overdue on left, Recent Activity on right).

---

## 8. Notable cross-cutting flows

### Schedule projection (Route.jsx)
Lists in `/route` combine:
1. Real `jobs` rows in the date range.
2. Pools whose `next_due_at` falls in the range.
3. **Synthetic "projected" stops** generated from `recurring_job_profiles` by stepping forward from `next_generation_at`/`last_generated_at` by `profileIntervalDays(profile)` across a 180-day horizon.

Projected stops have ids prefixed `profile-{id}-{ymd}` and `projected: true`. They are deduped against real jobs via a `takenByProfile` Map keyed by `(recurring_profile_id, scheduled_date)`.

Saving an edit on a projected stop in `StopDetailModal` **materializes** it: it inserts a real `jobs` row tied to the profile, then updates that row instead of the synthetic one.

### Pool address editing
Editing a pool address from `StopDetailModal` for a job that has no pool yet will **create** a pools row. The insert MUST include `type` and `shape` (NOT NULL); current code defaults to `chlorine` / `rectangular`.

### Auth scoping
- All authed reads/writes pass through RLS — there's no client-side enforcement of `business_id`. Trust the policies, but always include the `business_id` on inserts (it's required by `not null`).
- Customer portal uses a token-based row select policy — be careful editing the public policies.

---

## 9. Recent significant work (commit history sketch)

```
489c748 Fix back arrow loop on New Service screen
753a865 Add search to All Clients view
0f97e03 Clients: desktop view switcher buttons and visible email/phone
235740d Wrap filter pills instead of horizontal scroll; right-align desktop nav
cc52e97 Center desktop nav links (later reverted)
e78d4ac Fix unreadable Open Jobs button on Dashboard hero
11a4c82 Use real desktop grids on Dashboard, Clients, Jobs, Schedule
9cd5c0f Add desktop top nav and widen layout containers
b868c15 Upcoming view: project recurring jobs, edit address from modal
6d122d4 Schedule redesign, job modals, pool form refactor, and pricing flow
471f988 fix: downgrade react-leaflet to v4 for React 18 compatibility
9a59798 Add Google Places autocomplete and split mapping providers
763389a Redesign Schedule page with List/Upcoming/Map and Mapbox routing
```

The bulk of active work has been on Schedule projection, the desktop layout refresh, and CRM-style client filtering.

---

## 10. Known sharp edges / things to verify before changes

1. **No central data cache.** Mutations may leave a stale list visible until you navigate away and back.
2. **`Header` and `TopNav` both render on desktop.** TopNav is the global nav, Header is per-page chrome. They stack — that's intentional but worth knowing if you redesign one.
3. **`Button` component overrides are sticky.** `btn-primary` baked in white text + gradient via `@apply`. Use a plain `<button>` for off-brand color combos.
4. **Pools NOT NULL columns**: `type`, `shape`, `address`, `business_id`, `client_id`. Inserts elsewhere in the codebase have defaults — match them.
5. **Projected stops have non-UUID ids**. Anything that hits Supabase by id needs to detect `stop.projected || id.startsWith('profile-')` and materialize first.
6. **Back-arrow conventions**: most pages use `backTo={-1}` (history-back). Don't hardcode a specific path unless you're sure of the entry point — the New Service ↔ Pool Detail back loop bug came from doing this.
7. **`DESIGN_SYSTEM.md` is NOT the active design system.** It's a reference doc the user dropped in but doesn't want fully applied.
8. **Mobile is protected.** Any layout work should default to `md:` breakpoints. The user has reverted multiple mobile-affecting changes.
9. **Filter pills should wrap, never scroll.** Mobile slider strips are out. Native `<select>` was tried and rejected.
10. **Railway deploys from `main` push.** "Service unavailable" right after a push is normal for ~1–3 min.

---

## 11. How to run locally

```bash
npm install
npm run dev          # Vite dev server (port 5173 → autoports if busy)
npm run build        # Production build to dist/
npm run start        # Serve dist on $PORT (Railway)
```

Required env vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MAPBOX_TOKEN` (for geocoding + maps)

Sample lives in `.env.example`.

---

## 12. Open opportunities (not yet asked for)

These are ideas a future Claude session could surface to the user but **must not act on without confirmation**:

- Add SWR/React Query so list pages don't re-fetch from scratch after mutations.
- Convert recurring projection in `Route.jsx` to a memoized utility (it's currently inlined twice — week + upcoming).
- Add proper desktop tables for Clients/Jobs (the current 2/3-col card grid is a hybrid step toward this).
- Replace lazy ad-hoc `console.error` paths in `StopDetailModal` and `Jobs` with a shared error toast.
- Tighten the chemical dosing UX in `NewService.jsx` — the wizard is the longest single component (725 LOC) and would benefit from sub-components.

The user moves fast and prefers shipping; flag these only when they're directly relevant.
