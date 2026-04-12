# Recurring Service Duration Spec — PoolPro

> Hand this to Claude Code. Read PROJECT_AUDIT.md first for full context on the codebase.

---

## Goal

Add duration/end options to recurring services. Currently a recurring service just repeats indefinitely. Techs and admins need to set how long a recurring service runs — ongoing, fixed period, specific end date, or a set number of visits.

---

## 1. Database changes

Add columns to `recurring_job_profiles`:

- `duration_type` — enum: `'ongoing'` | `'until_date'` | `'num_visits'`
  - Default: `'ongoing'`
- `end_date` — date, nullable. Used when `duration_type = 'until_date'`
- `total_visits` — integer, nullable. Used when `duration_type = 'num_visits'`
- `completed_visits` — integer, default 0. Counter that increments each time a service is completed against this profile
- `status` — enum: `'active'` | `'paused'` | `'completed'` | `'cancelled'`
  - Default: `'active'`

Migrate existing rows: set all current recurring profiles to `duration_type = 'ongoing'`, `status = 'active'`.

---

## 2. "Add Recurring Service" modal — update Step 3 (Schedule Details)

In the recurring service creation modal (from the previous spec), add a "Duration" section after frequency:

### Duration options (radio buttons or segmented control):

**Ongoing (until cancelled)**
- Default selection
- No additional fields
- Label: "Ongoing — continues until you cancel it"

**Until a specific date**
- Shows a date picker for end date
- Label: "Until" + date picker
- Validate: end date must be after first service date
- Helpful presets as quick-tap pills: "3 months", "6 months", "12 months" — these auto-fill the end date relative to the first service date

**Fixed number of visits**
- Shows a number input
- Label: "Number of visits"
- Placeholder: e.g. "12"
- Below the input, show a calculated end estimate: "Approx. finishes {date}" based on frequency × number of visits

---

## 3. Schedule projection changes

In Route.jsx (or wherever the projection logic was extracted to):

- When projecting forward from a recurring profile, respect the duration:
  - `ongoing`: project as currently (180-day horizon, no end)
  - `until_date`: stop projecting stops after `end_date`
  - `num_visits`: stop projecting after `total_visits - completed_visits` remaining stops

- When a service is completed against a `num_visits` profile:
  - Increment `completed_visits`
  - If `completed_visits >= total_visits`: set `status = 'completed'`, stop projecting

- When today's date passes `end_date` on an `until_date` profile:
  - Set `status = 'completed'`, stop projecting

- Completed/cancelled profiles should NOT generate any projected stops

---

## 4. Recurring service management

On the recurring profile detail/edit page and in any list views:

**Show duration info on the card:**
- Ongoing: "Ongoing" badge (subtle, grey/green)
- Until date: "Until {date}" or "3 months remaining"
- Num visits: "4 of 12 visits completed" with a subtle progress indicator

**Status badges:**
- Active: green
- Paused: yellow/amber
- Completed: grey with checkmark
- Cancelled: grey with strikethrough

**Actions:**
- Pause: temporarily stop projecting stops (admin can resume later)
- Cancel: permanently end the recurring service, set `status = 'cancelled'`
- Extend: for `until_date` profiles, push the end date out. For `num_visits`, increase the total.
- Edit: change frequency, assigned tech, duration — but not retroactively (only affects future stops)

---

## 5. Client Detail — show duration context

On the Client Detail page, where recurring services/pools are displayed:
- Show the duration info alongside the frequency: "Weekly · Ongoing" or "Fortnightly · Until Jul 2026" or "Weekly · 4/12 visits"
- When a recurring service completes (all visits done or end date reached), show it in a "Past Services" or "Completed" section rather than hiding it entirely — the history matters

---

## Technical notes

- This only affects `recurring_job_profiles`, the projection logic, and the UI displaying recurring services
- The `completed_visits` counter should increment when a service_record is completed that references this profile (check how services are currently linked to profiles — likely via `recurring_profile_id` on the jobs table)
- The status auto-transition (active → completed) should happen at service completion time AND on schedule load (catch any that were missed)
- Do NOT change the one-off job/work order flow — that's separate
- Duration presets (3/6/12 months) are just UI sugar — they calculate and set the `end_date`, no special DB handling needed
- Respect mobile conventions

---

## Expected result

- Admin creates a recurring service → picks "12 visits" → schedule shows 12 projected stops
- After each service, the counter updates: "5 of 12 visits completed"
- After the 12th service, the profile auto-completes and stops projecting
- Admin creates a summer-only client → picks "Until March 2027" → stops project only until that date
- Most clients stay "Ongoing" which works exactly as it does now — no change for the default case
