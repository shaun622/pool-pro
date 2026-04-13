# PoolPro — Full Project Audit

> Generated 2026-04-13. Covers every route, component, hook, database table, utility, and convention.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Routes](#routes)
4. [Pages](#pages)
5. [Components](#components)
6. [Hooks](#hooks)
7. [Libraries & Utilities](#libraries--utilities)
8. [Database Schema](#database-schema)
9. [RLS Policies](#rls-policies)
10. [Database Functions & Indexes](#database-functions--indexes)
11. [Storage Buckets](#storage-buckets)
12. [Realtime Subscriptions](#realtime-subscriptions)
13. [Tailwind Theme](#tailwind-theme)
14. [Global CSS Utilities](#global-css-utilities)
15. [PWA Configuration](#pwa-configuration)
16. [Environment Variables](#environment-variables)
17. [Conventions](#conventions)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 18.3.1 |
| Router | react-router-dom | 6.28.0 |
| Styling | Tailwind CSS | 3.4.16 |
| Build | Vite | 6.0.0 |
| Backend / Auth | Supabase (supabase-js) | 2.47.0 |
| Maps | Leaflet + react-leaflet | 1.9.4 / 4.2.1 |
| Charts | Recharts | 2.13.0 |
| Date utils | date-fns | 4.1.0 |
| Image processing | Sharp | 0.34.5 |
| Production server | serve | 14.2.6 |
| PWA | vite-plugin-pwa | 0.21.0 |
| CSS processing | PostCSS + Autoprefixer | 8.4.49 / 10.4.20 |

### Scripts

```
dev      → vite
build    → vite build
preview  → vite preview
start    → serve dist -s -l ${PORT:-3000}
```

---

## Project Structure

```
src/
├── components/
│   ├── layout/          # AppShell, TopNav, BottomNav, Header, PageWrapper, TechShell
│   ├── ui/              # Button, Card, Badge, Input, Modal, CustomSelect,
│   │                      AddressAutocomplete, DocumentUploader, EmptyState,
│   │                      ActivityPanel, StaffCard, StopDetailModal
│   └── PoolFormFields.jsx
├── hooks/               # useAuth, useBusiness, useClients, usePools, usePool,
│                          useStaff, useService, useActivity
├── lib/                 # supabase.js, utils.js, templateEngine.js, mapbox.js
├── pages/
│   ├── tech/            # TechRunSheet, TechProfile
│   ├── portal/          # PortalLogin, PortalSetup, PortalTokenLanding, PortalDashboard
│   ├── settings/        # Staff, ChemicalLibrary, CommunicationTemplates,
│   │                      JobTypeTemplates, Automations, SurveyResults,
│   │                      Integrations, ImportData
│   ├── Dashboard.jsx
│   ├── Route.jsx
│   ├── Clients.jsx / ClientDetail.jsx
│   ├── PoolDetail.jsx
│   ├── WorkOrders.jsx / WorkOrderDetail.jsx
│   ├── RecurringJobs.jsx
│   ├── Quotes.jsx / QuoteBuilder.jsx
│   ├── Invoices.jsx / InvoiceBuilder.jsx
│   ├── Settings.jsx
│   ├── Reports.jsx
│   ├── Subscription.jsx
│   ├── Login.jsx / Signup.jsx
│   ├── Onboarding.jsx
│   ├── NewService.jsx / ServiceDetail.jsx
│   ├── PublicQuote.jsx / PublicSurvey.jsx / InviteAccept.jsx
│   └── App.jsx
├── styles/
│   └── index.css        # Global styles, Leaflet overrides, component classes
└── main.jsx             # Entry point
```

---

## Routes

### Public (no auth)

| Path | Component | Purpose |
|------|-----------|---------|
| `/login` | Login | Email/password sign-in, role-based redirect |
| `/signup` | Signup | Account registration + email verification |
| `/quote/:token` | PublicQuote | Unauthenticated quote accept/decline |
| `/survey/:token` | PublicSurvey | Star-rating survey submission |
| `/invite/:token` | InviteAccept | Staff invitation acceptance |
| `/portal/login` | PortalLogin | Customer portal sign-in |
| `/portal/setup/:token` | PortalSetup | Customer portal account creation |
| `/portal/:token` | PortalTokenLanding | Token redirect to setup/login |
| `/portal` | PortalDashboard | Customer dashboard (pools, services, invoices) |

### Protected — Onboarding

| Path | Component | Guard | Purpose |
|------|-----------|-------|---------|
| `/onboarding` | Onboarding | ProtectedRoute | First-login business setup wizard |

### Protected — Tech (TechGuard → TechShell)

| Path | Component | Purpose |
|------|-----------|---------|
| `/tech` | TechRunSheet | Daily route sheet, map, job list |
| `/tech/profile` | TechProfile | Profile & password settings |

### Protected — Shared (accessible from both tech and admin shells)

| Path | Component | Purpose |
|------|-----------|---------|
| `/pools/:id/service` | NewService | Create service record |
| `/work-orders/:id` | WorkOrderDetail | Work order detail |
| `/services/:id` | ServiceDetail | Service record with chemistry logs & photos |

### Protected — Admin/Owner (BusinessGuard → AppShell)

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | Dashboard | KPIs, today's summary, recent activity |
| `/route` | Route | Map-based route planning with numbered stops |
| `/clients` | Clients | Client list with status badges |
| `/clients/:id` | ClientDetail | Client detail — pools, services, staff |
| `/pools/:id` | PoolDetail | Pool chemistry, service history chart |
| `/services/:id` | ServiceDetail | Service record detail |
| `/work-orders` | WorkOrders | Work order list with status filters |
| `/work-orders/:id` | WorkOrderDetail | Work order detail with map & timeline |
| `/recurring-jobs` | RecurringJobs | Recurring service schedule management |
| `/quotes` | Quotes | Quote pipeline (Kanban stages) |
| `/quotes/new` | QuoteBuilder | Create quote with line items |
| `/quotes/:id` | QuoteBuilder | Edit existing quote |
| `/invoices` | Invoices | Invoice list (draft/sent/paid/overdue tabs) |
| `/invoices/new` | InvoiceBuilder | Create invoice |
| `/invoices/:id` | InvoiceBuilder | Edit invoice |
| `/settings` | Settings | Business profile, timezone |
| `/settings/staff` | Staff | Staff management + invites |
| `/settings/chemicals` | ChemicalLibrary | Chemical inventory |
| `/settings/templates` | CommunicationTemplates | Email/SMS templates |
| `/settings/job-types` | JobTypeTemplates | Reusable job templates |
| `/settings/automations` | Automations | Trigger-based workflow rules |
| `/settings/surveys` | SurveyResults | Customer satisfaction analytics |
| `/settings/integrations` | Integrations | Third-party integrations (coming soon) |
| `/settings/import` | ImportData | CSV bulk import |
| `/reports` | Reports | Revenue, services, chemical usage charts |
| `/subscription` | Subscription | Plan info & upgrade |

### Catch-all

| Path | Behaviour |
|------|-----------|
| `*` | Redirect to `/` |

**Total: 39 routed components + guards**

### Auth Guards

- **ProtectedRoute** — redirects unauthenticated users to `/login`
- **BusinessGuard** — redirects customers → `/portal`, techs → `/tech`; renders `<AppShell />`
- **TechGuard** — redirects admins/owners → `/`; renders `<TechShell />`

---

## Pages

### Dashboard (`src/pages/Dashboard.jsx`)
- KPIs: weekly services, overdue pools, active jobs, pending quotes
- **Today's Summary**: progress bar (X of Y stops completed), three stat pills (Overdue red, Due Today blue, Completed green), access notes from today's stops, "View Full Schedule" link
- Recent activity feed

### Route (`src/pages/Route.jsx`)
- Map view with Leaflet — numbered marker stops, route polyline, distance/duration
- List view with two always-visible sections when viewing today: **Overdue** (red) and **Today's Route**
- Empty states: green "No overdue pools" with checkmark, grey "No stops scheduled" with calendar
- Date-stripping fix for overdue calculation: `dueDate.setHours(0,0,0,0)` before comparison
- "Due today" shown in green instead of "0d overdue"
- Week view uses `Math.max(daysOver, 1)` for minimum 1 day display
- Stop detail via `StopDetailModal` with inline quick-edit

### Clients (`src/pages/Clients.jsx`)
- Grid view with status badges (overdue/due soon/up to date/no schedule)

### ClientDetail (`src/pages/ClientDetail.jsx`)
- Nested pools, services, assigned staff, contact management

### PoolDetail (`src/pages/PoolDetail.jsx`)
- Chemistry readings, service history graph, target ranges, chemical status indicators

### WorkOrders (`src/pages/WorkOrders.jsx`)
- Status-filtered list
- Unscheduled cards: grey `bg-gray-100` styling with calendar icon and "Not scheduled" text (not blue "No date")

### Settings (`src/pages/Settings.jsx`)
- Business profile: name, ABN, phone, email, timezone, logo upload, brand colour
- Timezone picker with `AUSTRALIAN_TIMEZONES` constant:
  - Sydney, Melbourne, Brisbane, Hobart (AEST/AEDT)
  - Adelaide (ACST/ACDT)
  - Darwin (ACST)
  - Perth (AWST)

### TechRunSheet (`src/pages/tech/TechRunSheet.jsx`)
- Technician's daily view with same overdue/today split and empty states as admin Route
- Same date-stripping overdue fix applied

---

## Components

### Layout (`src/components/layout/`)

| Component | Props | Purpose |
|-----------|-------|---------|
| **AppShell** | none | Wraps TopNav + `<Outlet />` + BottomNav |
| **TopNav** | none | Desktop-only (`hidden md:flex`) horizontal nav — 5 tabs with active highlighting, gradient brand logo |
| **BottomNav** | none | Mobile-only (`md:hidden`) bottom tab nav — 5 tabs with filled/outline icon states |
| **Header** | `title`, `backTo`, `right` | Sticky page header with glass morphism, back button, right-side action slot. Container: `max-w-lg md:max-w-6xl` |
| **PageWrapper** | `children`, `noPadding`, `width` ('default'\|'wide') | Content container with responsive max-width (`max-w-lg md:max-w-5xl`, wide: `md:max-w-7xl`), conditional bottom padding |
| **TechShell** | none | Tech layout — header with branding, profile menu, sign-out |

### UI (`src/components/ui/`)

| Component | Props | Purpose |
|-----------|-------|---------|
| **Button** | `children`, `variant` (primary/secondary/danger/ghost), `className`, `loading` | Button with variants and loading spinner |
| **Card** | `children`, `className`, `onClick` | Generic card container, interactive styling when clickable |
| **Badge** | `children`, `variant` (default/primary/success/warning/danger/chlorine/salt/mineral/freshwater), `className` | Inline badge with colour variants including pool-type specific |
| **Input** | `label`, `error`, `className`, `large` | Input wrapper with label and error display. Also exports `TextArea` and re-exports `Select` |
| **CustomSelect** | `label`, `options`, `value`, `onChange`, `error`, `disabled`, `placeholder`, `inline` | Custom styled dropdown replacing native select — click-outside, escape-key, animations |
| **Modal** | `open`, `onClose`, `title`, `headerAction`, `children` | Bottom-sheet on mobile, centered dialog on desktop. `headerAction` renders content next to X button |
| **AddressAutocomplete** | `label`, `value`, `onChange`, `onSelect`, `placeholder`, `required` | Address input with Nominatim geocoding, debounced suggestions |
| **DocumentUploader** | `clientId`, `poolId`, `jobId`, `documents`, `onUpdate` | Multi-file upload with categories, Supabase storage integration |
| **EmptyState** | `icon`, `title`, `description`, `action`, `onAction` | Centered empty state with fade-in animation |
| **ActivityPanel** | `open`, `onClose` | Slide-in activity timeline with type icons, mark read, unread count |
| **StaffCard** | `staff`, `variant` (default/compact), `brandColor` | Staff member display with photo/initials fallback |
| **StopDetailModal** | `open`, `onClose`, `stop`, `stopNumber`, `onUpdated`, `staffList` | Route stop detail with Leaflet map, quick-edit mode (address, phone, email, notes, date/time), status controls, recurrence options |

### Form Helpers (`src/components/`)

| Component | Exports | Purpose |
|-----------|---------|---------|
| **PoolFormFields** | `PoolFormFields` (component), `emptyPool` (object), `buildPoolPayload` (async fn) | Reusable pool config form fields — address, type, shape, volume, equipment, servicing toggle. `buildPoolPayload()` handles geocoding |

---

## Hooks

### useAuth (`src/hooks/useAuth.jsx`)
- **Provider:** `AuthProvider`
- **Returns:** `{ user, loading, signUp, signIn, signOut }`
- **Tables:** `auth.users` (Supabase Auth)
- Handles PKCE flow, URL hash cleanup, auth state listener

### useBusiness (`src/hooks/useBusiness.jsx`)
- **Provider:** `BusinessProvider`
- **Returns:** `{ business, loading, staffRecord, userRole, createBusiness, updateBusiness, refetch }`
- **Role resolution:** owner (owns business) → admin (staff with admin/manager/owner role) → tech (other staff)
- **Tables:** `businesses`, `staff_members`

### useClients (`src/hooks/useClients.jsx`)
- **Returns:** `{ clients, loading, createClient, updateClient, deleteClient, refetch }`
- **Tables:** `clients` (filtered by `business_id`, ordered by `name`)

### usePools (`src/hooks/usePools.jsx`)
- **Parameters:** `clientId` (optional)
- **Returns:** `{ pools, loading, createPool, updatePool, deletePool, refetch }`
- **Tables:** `pools` (joins `clients(name, email)`)

### usePool (`src/hooks/usePool.jsx`)
- **Parameters:** `poolId`
- **Returns:** `{ pool, loading, setPool }`
- **Tables:** `pools` (joins `clients`)

### useStaff (`src/hooks/useStaff.jsx`)
- **Returns:** `{ staff, loading, staffLimit, canAddStaff, createStaff, updateStaff, deleteStaff, uploadPhoto, refetch }`
- **Computed:** `staffLimit` based on plan (trial=1, starter=2, pro=10), `canAddStaff` boolean
- **Tables:** `staff_members` + cascading FK cleanup on delete (`service_records`, `clients`, `pools`, `jobs`, `recurring_job_profiles`)
- **Storage:** `staff-photos` bucket

### useService (`src/hooks/useService.jsx`)
- **Returns:** `{ loading, createServiceRecord, saveChemicalLog, saveTasks, saveChemicalsAdded, completeService, getServiceHistory }`
- **Tables:** `service_records`, `chemical_logs`, `service_tasks`, `chemicals_added`, `pools` (updates `last_serviced_at`, `next_due_at`), `recurring_job_profiles` (increments `completed_visits`)
- **Edge Functions:** `complete-service`
- **Helper:** `calculateNextDueDate(from, frequency)` — supports weekly, fortnightly, monthly, 6_weekly, quarterly

### useActivity (`src/hooks/useActivity.jsx`)
- **Returns:** `{ activities, unreadCount, loading, markAllRead, markRead, refetch }`
- **Tables:** `activity_feed` (last 50, ordered by `created_at DESC`)
- **Realtime:** Subscribes to INSERT events on `activity_feed`, auto-prepends new items

---

## Libraries & Utilities

### supabase.js (`src/lib/supabase.js`)
- Exports `supabase` client configured from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### utils.js (`src/lib/utils.js`)

**Date functions:**
- `formatDate(date)` → "dd/MM/yyyy"
- `formatDateTime(date)` → "dd/MM/yyyy HH:mm"
- `daysOverdue(nextDueAt)` → number (0 if not overdue)
- `calculateNextDue(lastServicedAt, frequency)` → Date

**Status functions:**
- `getOverdueStatus(nextDueAt)` → 'red' (3+ days) / 'amber' (1+ days) / 'green'
- `getChemicalStatus(value, range)` → 'red' / 'amber' / 'green'
- `statusColor(status)` → Tailwind classes
- `statusDot(status)` → Tailwind dot classes

**Currency:**
- `formatCurrency(amount)` → AUD string
- `calculateGST(subtotal)` → 10% GST amount

**UI:**
- `cn(...classes)` → joins class names, filters falsy

**Constants:**
- `POOL_TYPES` — chlorine, salt, mineral, freshwater
- `POOL_SHAPES` — freeform, rectangular, lap
- `SCHEDULE_FREQUENCIES` — weekly, fortnightly, monthly, 6_weekly, quarterly
- `PHOTO_TAGS` — before, during, after, equipment, issue
- `CHEMICAL_UNITS` — L, kg, g, tabs
- `FREQUENCY_LABELS` — human-readable frequency names
- `DEFAULT_TARGET_RANGES` — pH, free_cl, total_cl, alk, stabiliser, calcium, salt
- `DEFAULT_TASKS` — common maintenance tasks
- `CHEMICAL_LABELS` — labels and units for chemical readings

### templateEngine.js (`src/lib/templateEngine.js`)
- `PLACEHOLDERS` — client, pool, job, staff, business, link, service, invoice placeholders
- `DEFAULT_TEMPLATES` — 7 pre-configured templates (service reminder email/SMS, running late, follow-up, survey)
- `renderTemplate(template, variables)` — replaces `{key}` placeholders
- `buildTemplateVariables({ client, pool, job, staff, business, survey, invoice, quote })` — constructs variable map from context

### mapbox.js (`src/lib/mapbox.js`)
- `MAPBOX_AVAILABLE` — boolean (checks `VITE_MAPBOX_TOKEN`)
- `MAPBOX_TILE_URL` / `MAPBOX_ATTRIBUTION` — Mapbox Streets v12 tile config
- `geocodeAddress(address)` — Nominatim (OpenStreetMap), Australia-restricted, returns `{ lat, lng, place_name }`
- `getRoute(waypoints)` — OSRM public demo server, returns `{ coordinates, distance_km, duration_min }`
- `haversineKm(a, b)` — great-circle distance fallback

---

## Database Schema

### Tables (22 total, 187 columns)

#### businesses
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| owner_id | uuid | — | NOT NULL, FK → auth.users |
| name | text | — | NOT NULL |
| logo_url | text | | |
| brand_colour | text | '#0EA5E9' | |
| abn | text | | |
| phone | text | | |
| email | text | | |
| stripe_customer_id | text | | |
| stripe_subscription_id | text | | |
| plan | text | 'trial' | |
| trial_ends_at | timestamptz | now() + 14 days | |
| next_invoice_number | integer | 1 | |
| invoice_prefix | text | 'INV' | |
| default_payment_terms_days | integer | 14 | |
| bank_details | text | | |
| timezone | text | 'Australia/Sydney' | |
| created_at | timestamptz | now() | |

#### clients
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, FK → businesses |
| name | text | — | NOT NULL |
| email | text | | |
| phone | text | | |
| address | text | | |
| notes | text | | |
| service_rate | numeric | | |
| billing_frequency | text | | |
| auth_user_id | uuid | | FK → auth.users, UNIQUE WHERE NOT NULL |
| assigned_staff_id | uuid | | FK → staff_members |
| pipeline_stage | text | 'active' | CHECK: lead, quoted, active, on_hold, lost |
| created_at | timestamptz | now() | |

#### pools
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, FK → businesses |
| client_id | uuid | — | NOT NULL, FK → clients |
| address | text | — | NOT NULL |
| type | text | — | NOT NULL |
| volume_litres | numeric | | |
| shape | text | | |
| schedule_frequency | text | 'weekly' | |
| access_notes | text | | |
| equipment | jsonb | '{}' | |
| target_ranges | jsonb | (defaults) | pH, free_cl, alk, stabiliser, calcium ranges |
| last_serviced_at | timestamptz | | |
| next_due_at | timestamptz | | |
| route_order | integer | 0 | |
| portal_token | uuid | gen_random_uuid() | |
| assigned_staff_id | uuid | | FK → staff_members |
| latitude | numeric | | |
| longitude | numeric | | |
| geocoded_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### staff_members
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, FK → businesses |
| name | text | — | NOT NULL |
| role | text | 'technician' | |
| phone | text | | |
| email | text | | |
| photo_url | text | | |
| bio | text | | |
| is_active | boolean | true | |
| user_id | uuid | | FK → auth.users |
| invite_token | uuid | gen_random_uuid() | UNIQUE WHERE NOT NULL |
| invite_status | text | 'pending' | CHECK: pending, accepted |
| created_at | timestamptz | now() | |

#### service_records
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, FK → businesses |
| pool_id | uuid | — | NOT NULL, FK → pools |
| staff_id | uuid | | FK → staff_members |
| technician_name | text | | |
| serviced_at | timestamptz | now() | |
| status | text | 'completed' | |
| notes | text | | |
| report_sent_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### chemical_logs
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| service_record_id | uuid | NOT NULL, FK → service_records |
| ph | numeric | |
| free_chlorine | numeric | |
| total_chlorine | numeric | |
| alkalinity | numeric | |
| stabiliser | numeric | |
| calcium_hardness | numeric | |
| salt | numeric | |
| water_temp | numeric | |
| created_at | timestamptz | now() |

#### chemicals_added
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| service_record_id | uuid | NOT NULL |
| product_name | text | NOT NULL |
| quantity | numeric | NOT NULL |
| unit | text | NOT NULL |
| cost | numeric | |
| created_at | timestamptz | now() |

#### service_tasks
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| service_record_id | uuid | NOT NULL |
| task_name | text | NOT NULL |
| completed | boolean | false |
| created_at | timestamptz | now() |

#### service_photos
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| service_record_id | uuid | NOT NULL |
| storage_path | text | NOT NULL |
| signed_url | text | |
| tag | text | |
| created_at | timestamptz | now() |

#### chemical_products
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, UNIQUE(business_id, name) |
| name | text | — | NOT NULL |
| default_unit | text | 'L' | |
| category | text | | |
| suggested_dose | text | | |
| notes | text | | |
| use_count | integer | 0 | |
| last_used_at | timestamptz | now() | |
| created_at | timestamptz | now() | |

#### pricing_items
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| business_id | uuid | NOT NULL |
| name | text | NOT NULL |
| category | text | |
| unit | text | |
| default_price | numeric | |
| created_at | timestamptz | now() |

#### quotes
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| client_id | uuid | — | NOT NULL |
| pool_id | uuid | | |
| status | text | 'draft' | |
| pipeline_stage | text | 'draft' | |
| line_items | jsonb | '[]' | |
| scope | text | | |
| terms | text | | |
| subtotal | numeric | 0 | |
| gst | numeric | 0 | |
| total | numeric | 0 | |
| public_token | uuid | gen_random_uuid() | |
| sent_at | timestamptz | | |
| responded_at | timestamptz | | |
| viewed_at | timestamptz | | |
| follow_up_at | timestamptz | | |
| converted_at | timestamptz | | |
| lost_reason | text | | |
| recurring_settings | jsonb | | |
| created_at | timestamptz | now() | |

#### jobs
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| client_id | uuid | — | NOT NULL |
| pool_id | uuid | | |
| quote_id | uuid | | FK → quotes |
| recurring_profile_id | uuid | | FK → recurring_job_profiles |
| job_type_template_id | uuid | | FK → job_type_templates |
| assigned_staff_id | uuid | | FK → staff_members |
| title | text | — | NOT NULL |
| status | text | 'scheduled' | |
| scheduled_date | date | | |
| scheduled_time | time | | |
| estimated_duration_minutes | integer | | |
| price | numeric | | |
| notes | text | | |
| started_at | timestamptz | | |
| completed_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### recurring_job_profiles
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| client_id | uuid | — | NOT NULL |
| pool_id | uuid | | |
| job_type_template_id | uuid | | |
| assigned_staff_id | uuid | | |
| title | text | — | NOT NULL |
| recurrence_rule | text | 'weekly' | CHECK: weekly, fortnightly, monthly, 6_weekly, quarterly, custom |
| custom_interval_days | integer | | |
| preferred_day_of_week | integer | | CHECK: 0–6 |
| preferred_time | time | | |
| price | numeric | | |
| notes | text | | |
| duration_type | text | 'ongoing' | CHECK: ongoing, until_date, num_visits |
| end_date | date | | |
| total_visits | integer | | |
| completed_visits | integer | 0 | |
| status | text | 'active' | CHECK: active, paused, completed, cancelled |
| is_active | boolean | true | |
| last_generated_at | timestamptz | | |
| next_generation_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### communication_templates
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, UNIQUE(business_id, name, type) |
| name | text | — | NOT NULL |
| type | text | 'email' | CHECK: email, sms |
| trigger_type | text | | CHECK: service_reminder, running_late, service_complete, follow_up, survey, quote_sent, quote_accepted, job_update, invoice, custom |
| subject | text | | |
| body | text | — | NOT NULL |
| is_active | boolean | true | |
| created_at | timestamptz | now() | |

#### job_type_templates
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, UNIQUE(business_id, name) |
| name | text | — | NOT NULL |
| description | text | | |
| default_tasks | jsonb | '[]' | |
| estimated_duration_minutes | integer | | |
| default_price | numeric | | |
| checklist | jsonb | '[]' | |
| color | text | '#0EA5E9' | |
| is_active | boolean | true | |
| created_at | timestamptz | now() | |

#### automation_rules
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| name | text | — | NOT NULL |
| trigger_event | text | — | NOT NULL, CHECK: job_scheduled, job_started, job_running_late, job_completed, service_completed, quote_sent, quote_accepted |
| condition | jsonb | '{}' | |
| action_type | text | 'send_email' | CHECK: send_email, send_sms, both |
| template_id | uuid | | FK → communication_templates |
| delay_minutes | integer | 0 | |
| is_active | boolean | true | |
| created_at | timestamptz | now() | |

#### automation_logs
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| automation_rule_id | uuid | FK → automation_rules |
| business_id | uuid | NOT NULL |
| job_id | uuid | FK → jobs |
| service_record_id | uuid | FK → service_records |
| recipient_email | text | |
| recipient_phone | text | |
| channel | text | CHECK: email, sms |
| status | text | 'sent' (CHECK: pending, sent, failed) |
| template_name | text | |
| rendered_body | text | |
| error_message | text | |
| sent_at | timestamptz | now() |
| created_at | timestamptz | now() |

#### surveys
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| service_record_id | uuid | | |
| client_id | uuid | — | NOT NULL |
| token | uuid | gen_random_uuid() | UNIQUE |
| rating | integer | | CHECK: 1–5 |
| comment | text | | |
| submitted_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### invoices
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| client_id | uuid | — | NOT NULL |
| service_record_id | uuid | | |
| invoice_number | text | — | NOT NULL |
| status | text | 'draft' | CHECK: draft, sent, paid, overdue, void |
| line_items | jsonb | '[]' | |
| subtotal | numeric | 0 | |
| gst | numeric | 0 | |
| total | numeric | 0 | |
| issued_date | date | | |
| due_date | date | | |
| paid_date | date | | |
| paid_amount | numeric | | |
| payment_method | text | | |
| notes | text | | |
| public_token | uuid | gen_random_uuid() | |
| sent_at | timestamptz | | |
| created_at | timestamptz | now() | |

#### documents
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL |
| client_id | uuid | | |
| pool_id | uuid | | |
| job_id | uuid | | |
| name | text | — | NOT NULL |
| file_type | text | | |
| file_size | integer | | |
| storage_path | text | — | NOT NULL |
| category | text | 'other' | CHECK: certificate, compliance, photo, contract, report, other |
| uploaded_by | uuid | | |
| created_at | timestamptz | now() | |

#### activity_feed
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid | gen_random_uuid() | PK |
| business_id | uuid | — | NOT NULL, FK ON DELETE CASCADE |
| type | text | — | NOT NULL, CHECK: quote_sent, quote_accepted, quote_declined, quote_viewed, job_created, job_completed, service_completed, client_created, payment_received, recurring_generated |
| title | text | — | NOT NULL |
| description | text | | |
| link_to | text | | |
| is_read | boolean | false | |
| created_at | timestamptz | now() | |

---

## RLS Policies

### Multi-tenant core function

```sql
current_business_id() RETURNS uuid
-- SECURITY DEFINER
-- Returns COALESCE of:
--   1. Owner's business: SELECT id FROM businesses WHERE owner_id = auth.uid()
--   2. Staff's business: SELECT business_id FROM staff_members WHERE user_id = auth.uid() AND is_active
```

### Per-table policies

| Table | Policy | Operation | Expression |
|-------|--------|-----------|------------|
| **businesses** | Users can view own | SELECT | `owner_id = auth.uid()` |
| | Users can insert own | INSERT | `owner_id = auth.uid()` |
| | Users can update own | UPDATE | `owner_id = auth.uid()` |
| | Customers can view | SELECT | `id IN (SELECT business_id FROM clients WHERE auth_user_id = auth.uid())` |
| | Staff can read | SELECT | `id IN (SELECT business_id FROM staff_members WHERE user_id = auth.uid())` |
| **clients** | Business can manage | ALL | `business_id = current_business_id()` |
| | Customer can view own | SELECT | `auth_user_id = auth.uid()` |
| **pools** | Business can manage | ALL | `business_id = current_business_id()` |
| | Public portal access | SELECT | `true` |
| **service_records** | Business can manage | ALL | `business_id = current_business_id()` |
| | Public via pool | SELECT | `true` |
| **chemical_logs** | Access via service_record | ALL | `true` |
| **chemicals_added** | Access via service_record | ALL | `true` |
| **service_tasks** | Access via service_record | ALL | `true` |
| **service_photos** | Access via service_record | ALL | `true` |
| **staff_members** | Business can manage | ALL | `business_id = current_business_id()` |
| | Public staff read | SELECT | `true` |
| **chemical_products** | Business can manage | ALL | `business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())` |
| | Customers can view | SELECT | via client auth_user_id |
| **quotes** | Business can manage | ALL | `business_id = current_business_id()` |
| | Public access | SELECT | `true` |
| | Public respond | UPDATE | `true` |
| **jobs** | Business can manage | ALL | `business_id = current_business_id()` |
| **pricing_items** | Business can manage | ALL | `business_id = current_business_id()` |
| **communication_templates** | Business can manage | ALL | `business_id = current_business_id()` |
| **job_type_templates** | Business can manage | ALL | `business_id = current_business_id()` |
| **recurring_job_profiles** | Business can manage | ALL | `business_id = current_business_id()` |
| **automation_rules** | Business can manage | ALL | `business_id = current_business_id()` |
| **automation_logs** | Business can view | ALL | `business_id = current_business_id()` |
| **surveys** | Business can manage | ALL | `business_id = current_business_id()` |
| | Public view by token | SELECT | `token IS NOT NULL` |
| | Public submit by token | UPDATE | `token IS NOT NULL` |
| **documents** | Business can manage | ALL | `business_id = current_business_id()` |
| **invoices** | Business can manage | ALL | `business_id = current_business_id()` |
| **activity_feed** | Users can view own | SELECT | via business owner_id |
| | Users can update own | UPDATE | via business owner_id |

---

## Database Functions & Indexes

### Functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `current_business_id()` | uuid | Core RLS function — resolves business for current auth user (owner or active staff) |

### Indexes (31 total)

| Table | Index | Columns |
|-------|-------|---------|
| clients | idx_clients_business | business_id |
| clients | idx_clients_auth_user | auth_user_id (partial) |
| pools | idx_pools_business | business_id |
| pools | idx_pools_client | client_id |
| pools | idx_pools_next_due | next_due_at |
| pools | idx_pools_portal_token | portal_token |
| service_records | idx_service_records_pool | pool_id |
| service_records | idx_service_records_business | business_id |
| service_records | idx_service_records_staff | staff_id |
| chemical_logs | idx_chemical_logs_service | service_record_id |
| staff_members | idx_staff_business | business_id |
| staff_members | idx_staff_user_id | user_id (partial) |
| staff_members | idx_staff_invite_token | invite_token (UNIQUE, partial) |
| quotes | idx_quotes_business | business_id |
| quotes | idx_quotes_public_token | public_token |
| jobs | idx_jobs_business | business_id |
| recurring_job_profiles | idx_recurring_profiles_business | business_id |
| recurring_job_profiles | idx_recurring_profiles_next | next_generation_at (partial: is_active) |
| automation_rules | idx_automation_rules_business | business_id |
| automation_logs | idx_automation_logs_business | business_id |
| automation_logs | idx_automation_logs_date | sent_at DESC |
| surveys | idx_surveys_token | token |
| surveys | idx_surveys_business | business_id |
| surveys | idx_surveys_submitted | submitted_at DESC |
| invoices | idx_invoices_business_id | business_id |
| invoices | idx_invoices_client_id | client_id |
| invoices | idx_invoices_public_token | public_token |
| documents | idx_documents_business | business_id |
| documents | idx_documents_client | client_id |
| documents | idx_documents_pool | pool_id |
| activity_feed | idx_activity_feed_business | business_id, created_at DESC |
| activity_feed | idx_activity_feed_unread | business_id, is_read (partial) |

No triggers defined — all state changes handled at application level.

---

## Storage Buckets

| Bucket | Access | Used By |
|--------|--------|---------|
| logos | Public read, authenticated upload | Business logo (Settings) |
| service-photos | Public read, authenticated upload/update | Service record photos |
| staff-photos | Public read, authenticated upload/update | Staff profile photos |
| documents | Public read, authenticated upload/delete | Client/pool/job documents |

---

## Realtime Subscriptions

| Table | Events | Used In |
|-------|--------|---------|
| activity_feed | INSERT | useActivity hook |
| jobs | (published) | Available for subscription |
| quotes | (published) | Available for subscription |

---

## Tailwind Theme

### Brand Colour Scale (pool-*)

```
pool-50:  #f0faff    pool-500: #0CA5EB (primary)
pool-100: #e0f4fe    pool-600: #0084C9 (hover)
pool-200: #b9e8fe    pool-700: #0069A3
pool-300: #7cd7fd    pool-800: #045886
pool-400: #36c1fa    pool-900: #0A4A6F
                     pool-950: #062F4A
```

### Spacing
- `min-h-tap` / `min-w-tap`: 44px (accessible touch targets)

### Shadows
- `card` — subtle (0 1px 3px)
- `card-hover` — medium (0 4px 12px)
- `elevated` — strong (0 8px 24px)
- `glow` / `glow-lg` — pool-blue glow
- `nav` — top shadow for bottom nav
- `inner-soft` — inset (inputs)

### Gradients
- `gradient-brand` — pool-500 → pool-700
- `gradient-brand-light` — pool-100 → pool-50
- `gradient-success` — emerald-500 → emerald-600
- `gradient-danger` — red-500 → red-600
- `gradient-warm` — amber-500 → amber-600
- `gradient-glass` — white 90% → white 70%
- `gradient-page` — slate-50 → slate-100

### Border Radius
- `2xl`: 1rem / `3xl`: 1.25rem

### Animations
- `fade-in` (0.3s), `slide-up` (0.3s), `scale-in` (0.2s), `slide-in-right` (0.25s)

---

## Global CSS Utilities

Defined in `src/styles/index.css`:

### Base
- Webkit tap highlight removed
- Overscroll disabled
- Safe-area bottom padding
- No number-input spinners
- Smooth scrolling
- Selection colour: pool-200 bg

### Component Classes

| Class | Purpose |
|-------|---------|
| `.btn` | Base button — flex, rounded-xl, semibold, 44×44 min |
| `.btn-primary` | Gradient brand, white text, pool shadow |
| `.btn-secondary` | White bg, gray text, border |
| `.btn-danger` | Gradient danger, white text |
| `.input` | Full-width, rounded-xl, inner shadow, focus ring |
| `.select-inline` | Compact select (rounded-lg) for inline use |
| `.input-lg` | Large centered input (2xl text) |
| `.card` | White, rounded-2xl, border, card shadow |
| `.card-interactive` | Card + hover lift + darker border |
| `.card-gradient` | Rounded-2xl, elevated shadow |
| `.glass` | White/80, xl backdrop blur, white border/20 |
| `.section-title` | Uppercase, xs, gray-400, wide tracking |

### Leaflet Overrides
- `.leaflet-container` — `isolation: isolate` (z-index containment)
- `.pool-map-popup` — 16px radius, custom shadow, styled pointer

---

## PWA Configuration

- **Registration:** Auto-update
- **Display:** Standalone
- **Orientation:** Portrait
- **Theme:** #0EA5E9
- **Icons:** 192×192 and 512×512 (maskable)
- **Caching:**
  - Pages — NetworkFirst, 5-min max age, 10 entries
  - Supabase API — NetworkFirst, 24-hour max age, 100 entries
- **Code splitting:** react-vendor, recharts, supabase (separate chunks)

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | Client | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Client | Supabase anon/public key |
| `VITE_MAPBOX_TOKEN` | Client | Mapbox tile rendering (optional) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Client | Stripe payments (future) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Admin DB access |
| `RESEND_API_KEY` | Server | Transactional email |
| `STRIPE_SECRET_KEY` | Server | Stripe backend |
| `STRIPE_WEBHOOK_SECRET` | Server | Stripe webhook verification |

---

## Conventions

### Architecture
- **Multi-tenant SaaS** — every table has `business_id`, enforced by `current_business_id()` RLS function
- **Role-based UI** — AppShell for admin/owner, TechShell for techs, Portal for customers
- **Mobile-first** — all layouts designed for 375px first, desktop enhancements via `md:` breakpoints
- **Desktop responsive** — TopNav (md+) replaces BottomNav, wider containers via PageWrapper `width` prop

### Component Patterns
- **`cn()` utility** for conditional class joining (no clsx/classnames dependency)
- **CustomSelect** instead of native `<select>` everywhere
- **AddressAutocomplete** with Nominatim geocoding for all address fields
- **Modal** with `headerAction` prop for inline actions (e.g., quick-edit pencil)
- **44×44 minimum** touch targets on all interactive elements (`min-h-tap min-w-tap`)
- **Glass morphism** on sticky headers (`bg-white/90 backdrop-blur-xl`)

### Data Patterns
- **Optimistic UI** — forms show saving state, refetch after mutation
- **Date comparison** — always strip time component (`setHours(0,0,0,0)`) before overdue calculations
- **Geocoding** — Nominatim (free, Australia-restricted), coordinates stored on pools
- **Route calculation** — OSRM public demo server for driving routes

### Styling
- **Colour palette:** pool-blue brand, slate-50 background, system sans fonts
- **Buttons:** `rounded-xl` everywhere
- **Cards:** `rounded-2xl` with subtle borders and soft shadows
- **No eyebrow labels** on sections
- **Badge variants** include pool-type colours (chlorine, salt, mineral, freshwater)

### Deployment
- **Hosting:** Railway (auto-deploys from main)
- **Database:** Supabase (project ref: `tdeytachcvjehlunlsue`)
- **Edge Functions:** `complete-service` (post-service automation)

---

*End of audit — 22 tables, 39 routes, 20 components, 7 hooks, 4 utility modules.*
