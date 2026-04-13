# Dashboard — Today's Summary Spec — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Replace the "Ready to Service" AND "Overdue Pools" sections on Dashboard with a single "Today's Summary" section. These two sections currently show duplicate data (the same overdue pools appear in both). The new section gives a glanceable progress snapshot of the day without duplicating what Schedule already shows in detail.

---

## What to remove

In Dashboard.jsx:
- Remove the "Ready to Service" section entirely (the list with Service buttons)
- Remove the "Overdue Pools" section entirely (the list with overdue badges)
- Keep everything else: Hero, stats row, Recent Activity feed

---

## What to add — "Today's Summary" section

Place it in the left column where "Ready to Service" used to be, above where "Overdue Pools" was.

### Layout

**Section header:** "Today's Summary" with today's date in lighter text (e.g. "Monday 13 April")

**Progress card (top of section):**
- A clean horizontal progress bar showing completion
- Text above or beside the bar: "3 of 8 stops completed" (dynamic)
- Progress bar fills proportionally (e.g. 3/8 = 37.5%)
- Bar color: pool brand gradient for completed portion, light grey for remaining
- If all stops completed: bar is full, text says "All done!" with a green checkmark
- If no stops for today: show "No stops scheduled for today" — no bar

**Below the progress bar — three compact stat pills in a row:**

| Overdue | Due Today | Completed |
|---------|-----------|-----------|
| 3       | 5         | 2         |

- **Overdue**: red text/accent — count of pools where `next_due_at < start_of_today`
- **Due Today**: blue/default — count of pools due today + jobs scheduled today + projected recurring stops for today (same sources as Schedule's Today view)
- **Completed**: green — count of services completed today (from `service_records` where `completed_at` is today)
- Each pill is tappable and navigates to Schedule (filtered to that category if possible, otherwise just to the Schedule Today tab)

**Below the stats — "Notes & Alerts" mini-list:**

Show up to 3 items — access notes and flags from today's stops. Pull from:
- `pools.access_notes` for any pool that's due today or overdue (only if access_notes is not empty/null)
- Any notes on jobs scheduled for today

Each item shows:
- Client name (bold) + short note preview (truncated to 1 line)
- e.g. "Shauns Villa — Side gate, dog in backyard"
- e.g. "Pool test2 — Key under mat, alarm code 4521"

If no notes exist for today's stops, don't show this sub-section at all — keep it clean.

**"View Full Schedule" link at the bottom** — navigates to `/route`

---

## Data sources

The summary needs to query the same sources as Schedule to get accurate counts:
1. Overdue pools: `pools` where `next_due_at < start_of_today` (join `clients` for names)
2. Due today: `pools` where `next_due_at = today` + `jobs` scheduled for today + projected recurring stops for today
3. Completed today: `service_records` where date of `completed_at` = today AND `status = 'completed'`
4. Access notes: `pools.access_notes` for pools in categories 1 and 2, where `access_notes IS NOT NULL AND access_notes != ''`

The total stops count for the progress bar = overdue + due today.
The completed count comes from service_records.
Progress = completed / total stops.

**Important:** Deduplicate the same way Schedule does — don't double-count a pool that appears as both a due pool and a projected recurring stop.

---

## Responsive layout

**Desktop (md+):**
- Today's Summary takes the left column (same width as the old Ready to Service section)
- Recent Activity stays in the right column
- Two-column layout preserved

**Mobile:**
- Today's Summary appears full-width below the stats row
- Recent Activity below it
- Single column stack

---

## Technical notes

- Reuse or share the query logic from Schedule (Route.jsx) if it's been extracted into a hook or utility. If not, query independently but use the same logic so counts match.
- The progress bar should update in real-time as services are completed — either re-fetch on focus/visibility change, or if there's a subscription pattern.
- The stats row at the top of Dashboard already shows "Overdue: 3" — that's fine to keep. The Today's Summary overdue count will match it. They serve different purposes (stats row = at-a-glance numbers, summary = actionable context).
- Do NOT change the stats row, hero section, or Recent Activity feed.
- Respect existing mobile conventions.

---

## Expected result

Admin opens Dashboard → sees:
1. Hero + stats row (unchanged)
2. Today's Summary: progress bar "2 of 8 stops completed", stat pills (3 overdue, 5 due today, 2 completed), access notes for 2 pools with gate codes
3. Recent Activity feed (unchanged, right column on desktop)

No more duplicate overdue lists. The Dashboard answers "how's my day going?" and Schedule answers "what exactly do I need to do?"
