# Tech Role View Spec — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Create a separate, stripped-down experience for field technicians (pool techs). When a tech logs in, they see ONLY what they need: their assigned stops, service forms, and a map. The admin/owner continues to see the full app as it exists today. This is role-based UI — same app, different shells depending on who's logged in.

**Do NOT change the existing admin experience. This spec ADDS a parallel tech experience.**

---

## 1. Role system

### Database changes

Add a `role` column to `staff_members` table:
- `role` enum: `'admin'` | `'tech'`
- Default: `'tech'`
- The business owner (the user in `businesses.owner_id`) is always admin regardless of this column

Add auth support for tech logins:
- `staff_members` needs a `user_id` column (references `auth.users`) — this links a Supabase auth account to a staff member
- `staff_members` already has `email` — this becomes the login identity
- Add `invite_token` column (uuid, nullable) for the invite flow
- Add `invite_status` column: `'pending'` | `'accepted'`
- Add `avatar_url` column (nullable) if it doesn't already exist

### RLS changes
- Tech users should only see data scoped to their `business_id` (same as admin)
- BUT the app shell restricts what UI they can access — RLS doesn't need to be different, just the frontend routing

---

## 2. Admin — Invite & manage techs

### In Settings → Staff page (already exists)

Enhance the existing staff management:

**Invite flow:**
- Admin clicks "+ Add Staff" (existing button)
- Form fields: Name, Email, Phone, Role (Admin / Tech dropdown — default Tech)
- On save: generates an `invite_token`, sends an invite email via Resend
- Email contains a link: `https://poolmateapp.online/invite/{invite_token}`
- The staff list shows invite status: "Pending" badge until accepted

**Invite acceptance page** (`/invite/:token`):
- Public route (no auth required)
- Shows: "You've been invited to join {business_name} on PoolPro"
- Form: Set password (or magic link — match existing auth pattern)
- On submit: creates a Supabase auth user, links `staff_members.user_id` to the new auth user, sets `invite_status = 'accepted'`
- Redirects to the tech view

### In Schedule — Assignment controls (admin only)

On each schedule card (overdue items, today's route, week, upcoming):
- Add an "Assign" action — either a small icon button on the card or inside the stop detail modal
- Tapping it opens a quick picker: list of staff members with avatars + names
- Selecting a tech assigns them to that stop (updates `assigned_staff_id` on the job or creates the assignment)
- For recurring profiles: assigning a tech sets them as the default for all future projected stops from that profile

**Bulk assign option (nice to have, not required for v1):**
- Select multiple stops → "Assign all to..." → pick tech
- Useful for route planning day

---

## 3. Tech View — the stripped-down experience

### Detection
When a user logs in, check:
1. Are they the `businesses.owner_id`? → Admin view (full app, existing AppShell)
2. Are they linked via `staff_members.user_id` AND `role = 'admin'`? → Admin view
3. Are they linked via `staff_members.user_id` AND `role = 'tech'`? → Tech view

### Tech Shell component (`TechShell.jsx`)

Replace `AppShell.jsx` for tech users. Much simpler:

**Header (sticky top):**
- PoolPro logo (left)
- Business name (center, small text)
- Profile icon (right) — tapping opens a minimal menu: "My Profile", "Log Out"

**No top nav. No bottom nav with 5 tabs.** Instead:

**Tab bar (below header):**
- Today | Week | Upcoming | Map
- Same tabs as Schedule but this IS their entire app — not a sub-page

**No access to:** Home/Dashboard, Work Orders, Clients, Settings, Invoices, Quotes, Reports, or any admin pages. If a tech manually types an admin URL, redirect them to their tech view.

### Today tab (default, what they see on app open)

**Content:**
- ONLY stops assigned to this tech for today (filter by `assigned_staff_id` matching their `staff_members.id`)
- Same two sections as admin Schedule: "Overdue" (red, top) and "Today's Route" (below)
- Each card shows:
  - Client name
  - Pool address
  - Pool type badge (Chlorine / Salt / etc.)
  - Time (if set)
  - "Start Service" button (primary, prominent)

**Empty state:**
- "No stops assigned for today" with a friendly illustration
- "Check with your manager if you're expecting work today"

**Card tap → Stop Detail view:**
- Client name, address, pool details (type, volume, equipment)
- Access notes (gate code, dog warning, key location — from `pools.access_notes`)
- "Navigate" button — opens device maps app with the pool address
- "Start Service" button → goes to existing service wizard (`/pools/:id/service`)
- Service history for this pool (last 3 services — so the tech knows what was done previously)
- The tech should NOT see client email, phone, billing info, or quotes/invoices

**After completing a service:**
- Return to the run sheet
- The completed stop shows a green checkmark and moves to a "Completed" section at the bottom
- Progress indicator at the top: "3 of 7 stops completed"

### Week tab

- Shows the tech's assigned stops grouped by day for the current week
- Same card format as Today
- Tapping a future day's stop shows the stop detail (read-only, can't start service until the day)
- Overdue items show under today only

### Upcoming tab

- Shows the tech's assigned stops for the next 2-4 weeks
- Grouped by day
- Read-only view — just so they know what's coming

### Map tab

- Shows today's assigned stops as markers on the map
- Use existing Leaflet/Mapbox map component from Route.jsx
- Markers show client name + address
- Tapping a marker opens the stop detail
- Show route line between stops in route order (if route_order is set)
- "Navigate to next stop" button — opens device maps with directions to the next unserviced stop

---

## 4. Service wizard adjustments for tech role

The existing service wizard (`NewService.jsx`) works for techs — they go through Chemicals → Tasks → Added → Review. No changes needed to the wizard itself.

**But add these for the tech context:**

- After completing the review step and saving, show a "Service Complete" confirmation screen with:
  - Green checkmark
  - Summary of what was logged
  - "Next Stop" button (goes to the next assigned stop in route order) — this is the key UX win for techs
  - "Back to Run Sheet" link
- The "Next Stop" flow keeps the tech moving efficiently without going back to the list each time

---

## 5. Routing changes (App.jsx)

### New public route:
- `/invite/:token` → `InviteAccept.jsx`

### New tech-only routes (wrapped in a TechGuard):
- `/tech` → Tech run sheet (Today view, default)
- `/tech/stop/:id` → Stop detail
- `/tech/service/:poolId` → Service wizard (reuse NewService.jsx)
- `/tech/profile` → Simple profile page (name, avatar upload, change password)

### TechGuard component:
- Checks if the logged-in user is a tech role
- If admin tries to access `/tech/*` → redirect to `/` (admin dashboard)
- If tech tries to access admin routes (`/`, `/work-orders`, `/clients`, etc.) → redirect to `/tech`

### Auth flow update:
- After login, check the user's role
- Admin → redirect to `/` (existing behaviour)
- Tech → redirect to `/tech`

---

## 6. Tech profile page (`/tech/profile`)

Minimal page:
- Avatar (upload/change photo — stored in Supabase Storage)
- Name (editable)
- Email (read-only)
- Phone (editable)
- Change password
- Log out button
- App version number at the bottom

---

## Technical notes

- The `staff_members` table already exists. You're adding columns to it, not creating a new table.
- Supabase auth handles the login. The invite flow creates a new auth user and links it to the existing staff_members row.
- The tech view queries the same tables as admin (pools, service_records, jobs, recurring_job_profiles) but always filters by `assigned_staff_id`. RLS still scopes by business_id.
- For the invite email, use Resend (already integrated in the project). The email should be simple: "Hi {name}, you've been invited to join {business_name} on PoolPro. Click here to get started."
- The tech shell should be a PWA-first experience — these guys are on phones in the sun. Big tap targets, high contrast, minimal scrolling.
- Offline support for the tech view would be amazing but is NOT in scope for this spec. Flag it as a future enhancement.
- If a tech has no stops assigned for a day, they see the empty state. They do NOT see unassigned stops — that's the admin's job to assign.
- The "Next Stop" flow after completing a service is the single most important UX feature here. It should feel like a conveyor belt — finish one, move to the next.
- Avatar storage: use Supabase Storage bucket (e.g. `staff-avatars`). Generate a public URL for display.

---

## Expected result

**Admin experience:**
- Adds a tech in Settings → Staff with their email
- Tech gets an invite email, clicks the link, sets up their account
- Admin goes to Schedule, assigns stops to the tech (individual or bulk)
- Admin can see all techs' assignments on schedule cards (avatar + name)

**Tech experience:**
- Opens the app → sees today's assigned run sheet
- Taps first stop → sees pool details + access notes
- Taps "Navigate" → phone maps opens with directions
- Arrives, taps "Start Service" → goes through the service wizard
- Finishes → taps "Next Stop" → moves to the next one
- End of day: all stops show green checkmarks
- Can check Week and Upcoming to see what's coming
- Can view Map to see today's route visually

The tech never sees admin features, client billing, quotes, invoices, or business settings.
