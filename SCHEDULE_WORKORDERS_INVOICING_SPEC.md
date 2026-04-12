# Schedule, Work Orders & Invoicing Enhancements — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Fill the remaining gaps in the restructured app:
1. Schedule needs a way to create recurring maintenance directly
2. Schedule cards should show assigned technician (if any)
3. Work Orders needs a Quick Quote entry point
4. Invoice creation needs obvious entry points from completed work / accepted quotes

---

## 1. Schedule — Add Recurring Service button

### The problem
The `/recurring-jobs` route exists but is buried. A pool tech looking at their Schedule has no obvious way to set up a new recurring client. They have to know about a hidden page.

### The fix
Add a "+ Add Recurring Service" button to the Schedule page. Place it below the date/tab navigation area — a secondary-style button (outlined, not the big gradient primary) so it doesn't compete with the daily route list.

### "Add Recurring Service" modal flow:

**Step 1 — Select Client**
- Searchable dropdown of existing clients
- "+ Add new client" link below (opens existing Add Client modal, returns with new client selected)

**Step 2 — Select or Add Pool**
- If client has existing pools, show them as selectable cards
- "+ Add Pool" option (opens existing Add Pool modal with client pre-filled)
- If client has only one pool, auto-select it

**Step 3 — Schedule Details**
- Frequency: Weekly / Fortnightly / Monthly / Custom (dropdown)
- If Custom: "Every ___ days" number input
- Preferred day of week (optional — helps with route planning)
- First service date (date picker, default today)
- Assign technician (optional — dropdown of staff_members, with avatar + name)
- Notes (optional textarea — e.g. "back gate code 1234")

**Step 4 — Confirm**
- Summary card showing: Client name, pool address, frequency, start date, assigned tech
- "Create Recurring Service" button

### What it creates:
- A row in `recurring_job_profiles` with the correct `pool_id`, `business_id`, interval settings, `next_generation_at` = first service date
- The pool's `frequency` field gets updated to match
- The pool's `next_due_at` gets set to the first service date
- The new recurring service immediately appears in Schedule projections

### Also:
- Add a link in Settings or a visible path to `/recurring-jobs` for managing all recurring profiles (edit frequency, pause, delete). Label it "Manage Recurring Services" somewhere accessible — could be a link at the bottom of Schedule or in Settings.

---

## 2. Schedule — Show assigned technician on cards

### The problem
Schedule cards currently show client name, address, and overdue status. For businesses with multiple techs, there's no way to see who's assigned to each stop without tapping into it.

### The fix
On each schedule card (overdue items, today's route items, week view items, upcoming items):

**If a technician is assigned:**
- Show a small circular avatar (32px) + first name on the right side of the card, before the Service button
- Avatar uses the staff member's profile photo if available, otherwise show initials on a colored circle (same pattern as client avatars)
- First name only to keep it compact (e.g. "Dave" not "Dave Thompson")

**If no technician is assigned:**
- Show nothing — don't show an empty avatar or "Unassigned" label. Keep the card clean.
- The absence of a tech name IS the signal that it's unassigned

### Data source:
- Jobs have `assigned_staff_id` (or similar — check the `add_assigned_staff` migration)
- Recurring profiles may also have an assigned tech
- Pool-based due items (from `next_due_at`) won't have assignment — show no tech on these

### Optional enhancement:
- On the Week and Upcoming views, add a filter pill: "All" | "Mine" | by tech name — so a tech on a multi-person team can filter to just their stops. Only show this filter if the business has more than one staff member.

---

## 3. Work Orders — Add Quick Quote button

### The problem
Quotes now live in Client detail pages, but sometimes a tech is on the Work Orders page and gets a call needing a quote. There's no quick way to create one without navigating to a client first.

### The fix
Add a secondary "+ Quick Quote" button below the existing "+ New Work Order" button on the Work Orders page.

**Styling:**
- Secondary/outlined style (white bg, pool-colored border and text) — not the big gradient primary button
- Same width as the New Work Order button
- Sits directly below it with a small gap

**Behaviour:**
- Opens the same `CreateQuoteModal` component built in the Jobs & Quotes spec
- Client picker is shown (not pre-filled) since we're not in a client context
- Full quote flow: select/create client → quote title → line items → save/send

This is purely a convenience shortcut — same modal, just an extra entry point.

---

## 4. Invoice creation entry points

### The problem
Invoice routes exist (`/invoices`, `/invoices/new`, `/invoices/:id`) but there's no natural way to get to them from completed work or accepted quotes. Invoicing feels disconnected.

### The fix — wire up invoice creation from three places:

### 4a. From a completed Work Order
On the WorkOrderDetail page (when status = "Completed"):
- Show a "Create Invoice" button in the action area
- Tapping it navigates to `/invoices/new` with the work order data pre-filled:
  - Client pre-selected
  - Line item auto-populated from the work order title + price
  - Reference to the work order ID for tracking

### 4b. From an accepted Quote
On the QuoteDetail page (when status = "Accepted"):
- Show a "Convert to Invoice" button in the action area
- Tapping it navigates to `/invoices/new` with the quote data pre-filled:
  - Client pre-selected
  - All quote line items copied over as invoice line items
  - Reference to the quote ID for tracking
- This should feel like a one-tap conversion — the tech reviews the pre-filled invoice and hits send

### 4c. From Client Detail page
In ClientDetail.jsx, add an "Invoices" section (similar to the Quotes section from the previous spec):
- Show a list of invoices for that client
- Each invoice card shows: invoice number, date, total, status (Draft, Sent, Paid, Overdue)
- "+ Create Invoice" button at the top of the section
- This creates a new invoice with the client pre-filled

### Also:
- Add "Invoices" as a link in Settings or as a visible path somewhere for viewing ALL invoices across clients (the existing `/invoices` page)
- The Dashboard could eventually show an "Unpaid Invoices" stat but do NOT change Dashboard in this spec — that's a future enhancement

---

## Technical notes

- `staff_members` table exists (see audit — `add_assigned_staff` migration). Check the exact column names for staff assignment on jobs and recurring profiles.
- `recurring_job_profiles` table exists (see audit — `recurring_jobs` migration). Check exact column structure for interval settings.
- `invoices` and `invoice_lines` tables exist (see audit — `invoicing` migration).
- The CreateQuoteModal should already exist from the previous spec. Reuse it, don't rebuild.
- For the recurring service modal, reuse existing `PoolFormFields.jsx` for pool creation if the user needs to add a new pool.
- Respect existing mobile conventions: 44px touch targets, no horizontal scroll, wrap pills, mobile is sacred.
- The tech filter on Schedule (Mine / All / by tech) should only render if `staff_members` count > 1 for the business. Solo operators should never see this filter.

---

## Expected result

- Tech opens Schedule → sees their day with tech assignments visible on cards
- Tech wants to add a new weekly client → taps "+ Add Recurring Service" right from Schedule → fills the modal → client appears in next week's route
- Tech gets a call while on Work Orders page → taps "Quick Quote" → quotes the job without leaving context
- Tech completes a work order → taps "Create Invoice" → invoice is pre-filled and ready to send
- Client accepts a quote → tech taps "Convert to Invoice" → done in one tap
- Tech opens a Client → sees their quotes AND invoices in one place
