# Jobs & Quotes Restructure Spec — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Separate Quotes from Jobs. Jobs becomes a clean single-purpose list of one-off work (repairs, call-outs, equipment installs). Quotes move into Client detail pages and are also creatable independently. The nav stays clean at 5 items.

**Do NOT touch Dashboard.jsx or Schedule (Route.jsx).**

---

## 1. Rename "Jobs" in nav

- Change the nav label from "Jobs" to "Work Orders" in both TopNav.jsx and BottomNav.jsx
- The page header should say "Work Orders" with a small subtitle below: "One-off repairs, call-outs & extra work"
- URL stays `/jobs` (don't break existing links/bookmarks)
- The "Create Job" button label changes to "+ New Work Order"
- The Create Job modal title changes to "New Work Order"
- Keep the existing Create Job modal fields (Client, Job Title, Date, Time, Price, Notes) — they're good
- Keep the existing hint: "One-off job. For recurring services, use Schedule → Recurring."

---

## 2. Remove Quotes tab from Jobs page

- Remove the "Jobs (3) | Quotes (3)" tab switcher from Jobs.jsx
- Remove the "Create Quote" button from Jobs.jsx
- Jobs.jsx becomes a single flat list of work orders with the existing filter pills (All, Scheduled, In Progress, On Hold, Completed)
- This significantly simplifies the page

---

## 3. Add Quotes to Client Detail page

In ClientDetail.jsx, add a "Quotes" section:

- Place it below the existing pools/services sections
- Show a list of quotes for that client (from the `quotes` table filtered by `client_id`)
- Each quote card shows: quote title/number, date, total amount, status badge (Draft, Sent, Accepted, Declined)
- "+ Create Quote" button at the top of the section
- Tapping a quote card → opens the existing quote detail (`/quotes/:id`)

---

## 4. Create Quote modal — two entry points, one component

Build a single reusable `CreateQuoteModal` component:

### Entry point A — From Client Detail page
- Client is pre-filled and locked (show client name but not editable)
- Modal opens straight to quote details fields

### Entry point B — From anywhere else (Dashboard, global + button, /quotes route)
- First field is "Client" — a searchable dropdown of existing clients
- Include a "+ Add new client" link below the dropdown (opens the existing Add Client modal, then returns to the quote modal with the new client selected)
- After selecting/creating a client, the rest of the quote fields appear

### Quote modal fields (both entry points):
- Client (select or pre-filled — as described above)
- Quote Title (e.g. "Filter replacement", "Green pool cleanup")
- Line items section:
  - Description, Qty, Unit Price (keep same structure as existing QuoteBuilder if it has line items)
  - "+ Add line item" button
  - Auto-calculated subtotal
- GST toggle (default on, 10% — this is for Australian businesses)
- Total (auto-calculated)
- Notes (optional textarea)
- Valid until (date picker, default 30 days from today)
- "Save as Draft" button (secondary) and "Send to Client" button (primary)

If the existing QuoteBuilder.jsx already handles most of this, reuse it inside the modal rather than rebuilding. The key change is making it work as a modal AND making the client selection flexible.

---

## 5. Quotes list page (keep but de-emphasise)

- Keep the `/quotes` route and `Quotes.jsx` page — it's the full quotes list/pipeline view
- But do NOT give it a main nav item — it's accessible via:
  - Dashboard → tapping the "Quotes: X pending" stat card
  - Client Detail → "View all quotes" link (if useful)
  - Direct URL
- This page shows ALL quotes across all clients with filters (Draft, Sent, Accepted, Declined, All)
- Keep existing functionality

---

## 6. Dashboard connection

- The Dashboard "Quotes: 0 pending" stat card should link to `/quotes` when tapped
- The Dashboard "Active Jobs" stat card should be renamed to "Work Orders" and link to `/work-orders` when tapped
- The "Open Jobs" button in the Dashboard hero should be renamed to "Work Orders" and link to `/work-orders`
- No other Dashboard changes

---

## Technical notes

- The `quotes` and `quote_lines` tables already exist (see audit §5 — sales_pipeline migration)
- Jobs.jsx is currently 925 lines — removing the Quotes tab should simplify it significantly
- The CreateQuoteModal should be a standalone component in `src/components/` so it can be imported from both ClientDetail and the Quotes page
- When a quote is accepted, the existing "Convert to Job" flow (if it exists) should create a work order in the `jobs` table — verify this works and the new naming doesn't break it
- Respect existing mobile conventions: 44px touch targets, no horizontal scroll, wrap pills

### URL changes — do this properly throughout the entire codebase
- `/jobs` → `/work-orders`
- `/jobs/:id` → `/work-orders/:id`
- Rename the file: `Jobs.jsx` → `WorkOrders.jsx`
- Rename the file: `JobDetail.jsx` → `WorkOrderDetail.jsx`
- Update App.jsx route definitions
- Update ALL `<Link>` and `navigate()` calls across the entire codebase that reference `/jobs` — search thoroughly, this includes Dashboard.jsx, ClientDetail.jsx, Schedule (Route.jsx), any modals, anywhere
- Update BottomNav.jsx and TopNav.jsx nav items
- Update any breadcrumbs or back buttons that reference the old path
- Do a full grep for `/jobs` and `'/jobs` and `"/jobs` across src/ to catch everything — do NOT leave orphaned references

---

## Expected result

- Tech opens "Work Orders" (nav) → sees only one-off work orders, clean and simple
- Tech opens a Client → sees that client's quotes, can create a new one
- Tech gets a call, wants to quote immediately → global + or Dashboard → Create Quote → pick/create client → fill quote → send
- Quotes pipeline view still exists at /quotes, accessible from Dashboard stat card
- No duplication, clear separation of concerns
