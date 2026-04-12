# Schedule Fix Spec — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Make Schedule (`/route` — `Route.jsx`) the single source of truth for "what do I need to do today/this week." Right now Schedule only shows `jobs` rows and projected `recurring_job_profiles`. It completely misses pools that are due or overdue based on `next_due_at`, which is where most of a pool tech's daily work actually lives. The Dashboard shows these (Ready to Service + Overdue Pools) but Schedule doesn't — that's the core problem. A tech opens Schedule and sees "Nothing scheduled" while the Dashboard shows 2 overdue pools. That's broken.

**Dashboard is NOT changing. Do not touch Dashboard.jsx.**

---

## What changes (Route.jsx only)

### Merge all work sources into the Schedule views

Route.jsx currently builds its list from:
- Real `jobs` rows in the date range
- Synthetic projected stops from `recurring_job_profiles`

It needs to ALSO pull in:
- **Overdue pools** — any pool where `next_due_at < start_of_today`
- **Due pools** — any pool where `next_due_at` falls on the selected day/range

Look at how Dashboard.jsx fetches "Ready to Service" and "Overdue Pools" — use the same query logic but integrate the results into Schedule's existing item list.

---

### Today tab

Display as two sections:

**"Overdue" section (top)**
- Only shows if there are overdue items
- Each card shows: client name, pool address, days overdue (e.g. "2d overdue" in red text — same style as Dashboard)
- Sorted by most overdue first
- "Service" button on each card → `/pools/:id/service`
- Style this section with urgency — red accent, similar to how Dashboard styles overdue items

**"Today's Route" section (below)**
- All items due today: pools with `next_due_at` = today, one-off jobs scheduled today, projected recurring stops for today
- Sorted by `route_order` if set, otherwise alphabetical by client name
- Each card shows: client name, pool address, type indicator (recurring service vs one-off job)
- "Service" button → `/pools/:id/service` for pool-based items, or job detail for one-off jobs

**Deduplication is critical:**
- If a pool appears as both a due pool AND has a `jobs` row for today, show it once (prefer the `jobs` row)
- If a pool appears as both a due pool AND a projected recurring stop, show it once (prefer the pool-based item since it's real data)
- Use the existing `takenByProfile` dedup pattern in Route.jsx as reference

---

### Week tab

- Same merged sources, grouped by day
- Overdue items appear under the current day only (don't repeat across every day)
- Each day section shows the combined pool-due + jobs + projected stops for that day

---

### Upcoming tab

- Keep existing projection logic
- Also include pools with future `next_due_at` dates in the upcoming list
- Deduplicate against projected recurring stops

---

### Map tab

- Include all items from the Today view (overdue + today's route) as map markers
- Pools without geocoded coordinates should be excluded from map but still appear in list views

---

## Technical notes

- Route.jsx is already 1086 lines. Try to extract the data-fetching/merging logic into a helper or custom hook rather than making the file even bigger.
- Pool items need to be shaped similarly to job items for the existing card components to render them. Create a unified "schedule item" shape that both jobs and pool-due items conform to.
- The pool query needs to join `clients` to get client name and contact info for the cards.
- `next_due_at` is on the `pools` table. After a service is completed via the service wizard, `next_due_at` gets bumped forward — so completed items naturally drop off the schedule.
- Respect existing mobile layout conventions: no horizontal scroll strips, wrap filter pills, min touch targets 44px.
- Do NOT change the nav structure, tab names, or URL paths.
- Do NOT touch Dashboard.jsx or any other pages.

---

## Expected result

A pool tech opens Schedule → Today and sees:
1. Any overdue pools at the top (red/urgent)  
2. Today's full run sheet below (recurring services due + one-off jobs + projected stops)
3. They can tap "Service" on any item and go straight to the service wizard

No more "Nothing scheduled" when there's actually work to do.
