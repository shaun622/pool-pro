// Date math + dropdown options for recurring job profiles.
//
// Recurring services are SINGLE-DAY-PER-OCCURRENCE only. The previous
// multi-day weekly rules (bi_weekly = 2/week, tri_weekly = 3/week)
// were removed in 20260509120000_drop_multiday_recurrence.sql — the
// chip grid kept drifting from operator intent and the projection
// branches caused recurring "ghost day" bugs in the schedule view.
// If a customer needs 2× weekly, the operator creates two separate
// `weekly` profiles anchored on different weekdays.
//
// Two rule shapes remain:
//   1. Cadence + single day (weekly / fortnightly / 6_weekly /
//      quarterly / monthly-legacy / custom): one occurrence every N
//      days, anchored on the profile's next_generation_at.
//   2. Monthly Nth-weekday: monthly_week_of_month +
//      preferred_day_of_week describe "1st Monday of every month",
//      "last Friday", etc.

export const RECURRENCE_LABELS = {
  weekly:      'Weekly',
  fortnightly: 'Fortnightly',
  monthly:     'Monthly',
  '6_weekly':  'Every 6 weeks',
  quarterly:   'Quarterly',
  custom:      'Custom',
}

// Options shown in the new-create / edit pickers. Ordered most
// frequent first.
export const RECURRENCE_OPTIONS = [
  { value: 'weekly',      label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly',     label: 'Monthly' },
  { value: '6_weekly',    label: 'Every 6 weeks' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'custom',      label: 'Custom' },
]

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun', long: 'Sunday' },
  { value: 1, label: 'Mon', long: 'Monday' },
  { value: 2, label: 'Tue', long: 'Tuesday' },
  { value: 3, label: 'Wed', long: 'Wednesday' },
  { value: 4, label: 'Thu', long: 'Thursday' },
  { value: 5, label: 'Fri', long: 'Friday' },
  { value: 6, label: 'Sat', long: 'Saturday' },
]

export const MONTH_WEEK_OPTIONS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: 'Last' },
]

// True when the rule uses Nth-weekday semantics (only set for monthly
// when monthly_week_of_month is populated; legacy monthly profiles
// fall back to the cadence path).
export function isNthWeekdayMonthly(profile) {
  return profile?.recurrence_rule === 'monthly' && profile.monthly_week_of_month != null
}

// Cadence interval in days for the simple "+N days" rules.
// Nth-weekday monthly is NOT representable as a fixed interval —
// callers should branch via isNthWeekdayMonthly before falling back.
export function cadenceIntervalDays(profile) {
  if (!profile) return null
  switch (profile.recurrence_rule) {
    case 'weekly':      return 7
    case 'fortnightly': return 14
    case 'monthly':     return 30
    case '6_weekly':    return 42
    case 'quarterly':   return 90
    case 'custom':      return profile.custom_interval_days || 7
    default:            return null
  }
}

// Map a pool's denormalised schedule_frequency (string or number) to days.
// Used by the legacy (no-profile) branch of recomputePoolNextDue; mirrors the
// Schedule projector's own frequency→days mapping.
export function frequencyToDays(freq) {
  if (!freq) return null
  if (typeof freq === 'number') return freq
  const f = String(freq).toLowerCase().trim()
  if (f === 'weekly' || f === 'every_week' || f === '1w') return 7
  if (f === 'fortnightly' || f === 'biweekly' || f === 'every_2_weeks' || f === '2w') return 14
  if (f === 'every_3_weeks' || f === '3w') return 21
  if (f === 'every_4_weeks' || f === '4w') return 28
  if (f === 'monthly' || f === 'every_month' || f === '1m') return 30
  if (f === '6_weekly' || f === 'every_6_weeks' || f === '6w') return 42
  if (f === 'quarterly' || f === '3m') return 90
  const n = parseInt(f, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Inverse of nthWeekdayOfMonth — given a date, return which Nth
// occurrence of its own weekday it is in its month. 1..4 = exact;
// 5 = "the last one" (chosen when the date is the final occurrence
// of its weekday in the month, even if it's also the 4th). Without
// the heuristic, "Last Friday" can't be expressed by picking a date —
// the operator would just see "4th Friday" and lose the "always the
// last Friday, even in 5-Friday months" semantics. Matches the
// Google Calendar interpretation.
export function computeNthFromDate(date) {
  if (!date) return null
  const d = typeof date === 'string'
    ? new Date(date + 'T00:00:00')
    : new Date(date)
  if (isNaN(d.getTime())) return null
  const day = d.getDate()
  const exactN = Math.floor((day - 1) / 7) + 1   // 1..5
  // Is there another occurrence of this weekday later in the month?
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const hasLater = day + 7 <= lastOfMonth
  // If this is the final occurrence, prefer "Last" semantics.
  return hasLater ? exactN : 5
}

// Build the human-readable preview line shown under the schedule
// picker — "Every Monday", "Monthly on the 2nd Monday", "Every other
// Tuesday", etc.
//
// rule:        the recurrence_rule
// firstDate:   Date | YYYY-MM-DD string of the first service date
// customDays:  number for `custom`
export function derivedScheduleLabel(rule, firstDate, customDays) {
  if (!firstDate) return ''
  const d = typeof firstDate === 'string'
    ? new Date(firstDate + 'T00:00:00')
    : new Date(firstDate)
  if (isNaN(d.getTime())) return ''
  const anchorWd = d.getDay()
  const anchorLong = DAYS_OF_WEEK.find(o => o.value === anchorWd)?.long || ''

  if (rule === 'weekly')      return anchorLong ? `Every ${anchorLong}` : ''
  if (rule === 'fortnightly') return anchorLong ? `Every other ${anchorLong}` : ''

  if (rule === 'monthly') {
    const n = computeNthFromDate(d)
    const nLabel = MONTH_WEEK_OPTIONS.find(o => o.value === n)?.label || ''
    return nLabel && anchorLong ? `Monthly on the ${nLabel} ${anchorLong}` : ''
  }

  if (rule === '6_weekly') return anchorLong ? `Every 6 weeks (${anchorLong})` : 'Every 6 weeks'
  if (rule === 'quarterly') return anchorLong ? `Every 90 days (${anchorLong})` : 'Every 90 days'

  if (rule === 'custom') {
    const n = Number(customDays) || 0
    if (n <= 0) return ''
    return `Every ${n} day${n === 1 ? '' : 's'} starting ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
  }

  return ''
}

// Compute the date of the Nth occurrence of `weekday` (0..6) in
// (year, month). n=1..4 picks the exact occurrence; n=5 means "the
// last one" — so 5 lands on the 4th or 5th weekday depending on month
// length. Returns a Date at local midnight, or null if the month has
// fewer than n occurrences (only possible when n=4 happens to fall
// past the end — rare; we treat as null and the caller can drop that
// month).
export function nthWeekdayOfMonth(year, month, n, weekday) {
  if (n == null || weekday == null) return null
  if (n === 5) {
    const last = new Date(year, month + 1, 0) // last day of `month`
    const offset = (last.getDay() - weekday + 7) % 7
    last.setDate(last.getDate() - offset)
    last.setHours(0, 0, 0, 0)
    return last
  }
  const first = new Date(year, month, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  first.setDate(first.getDate() + offset + (n - 1) * 7)
  if (first.getMonth() !== month) return null
  first.setHours(0, 0, 0, 0)
  return first
}

// Return the next date strictly after `date` that the profile's rule
// would place an occurrence on. Used by the materialisation paths to
// advance next_generation_at after inserting a real job from a
// projected stop.
//
// `date` should be a Date or YYYY-MM-DD string.
// Returns a Date at local midnight, or null if no future occurrence
// can be computed (mis-configured profile).
export function computeNextOccurrence(date, profile) {
  if (!profile) return null
  const base = typeof date === 'string'
    ? new Date(date + 'T00:00:00')
    : new Date(date)
  base.setHours(0, 0, 0, 0)

  if (isNthWeekdayMonthly(profile)) {
    // Try the Nth occurrence in (date's month + 1) first; fall back to
    // the month after that if the computed date somehow lands at or
    // before `base` (shouldn't happen, but defensive).
    const day = profile.preferred_day_of_week
    const n = profile.monthly_week_of_month
    for (let monthsAhead = 1; monthsAhead <= 12; monthsAhead++) {
      const m = new Date(base.getFullYear(), base.getMonth() + monthsAhead, 1)
      const candidate = nthWeekdayOfMonth(m.getFullYear(), m.getMonth(), n, day)
      if (candidate && candidate > base) return candidate
    }
    return null
  }

  const interval = cadenceIntervalDays(profile)
  if (!interval) return null
  const next = new Date(base)
  next.setDate(next.getDate() + interval)
  return next
}

// Local YYYY-MM-DD formatter — must use local time so weekend boundaries
// match what the operator sees in the calendar.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Build a Set of YYYY-MM-DD strings from profile.skipped_dates so the
// occurrence enumerator can drop them. Postgres date[] comes back as
// either strings ("2026-05-01") or full ISO timestamps depending on
// driver / casting; normalise both.
function skippedDateSet(profile) {
  const raw = profile?.skipped_dates || []
  const out = new Set()
  for (const d of raw) {
    if (!d) continue
    if (typeof d === 'string') {
      out.add(d.split('T')[0])
    } else {
      const parsed = new Date(d)
      if (!isNaN(parsed.getTime())) out.add(ymdLocal(parsed))
    }
  }
  return out
}

// Enumerate every occurrence date the profile would land on, strictly
// inside [rangeStart, rangeEnd] (inclusive on both ends). Used by the
// Schedule view to project profile-based stops onto the visible week.
//
// rangeStart/rangeEnd should be Dates (any time-of-day; we normalise).
// Returns an array of Date objects, each at local midnight.
//
// profile.skipped_dates filters the enumeration — the operator's
// "skip just this one" actions append to that array, so the
// projection stops showing the skipped occurrence's date.
export function occurrencesInRange(profile, rangeStart, rangeEnd) {
  if (!profile) return []
  const start = new Date(rangeStart); start.setHours(0, 0, 0, 0)
  const end   = new Date(rangeEnd);   end.setHours(0, 0, 0, 0)
  if (start > end) return []
  const skipped = skippedDateSet(profile)
  const notSkipped = (d) => !skipped.has(ymdLocal(d))

  // Floor: never emit an occurrence earlier than the day the profile
  // was created. Without this, the cadence path's backward walk
  // (`while (cursor > end) cursor -= interval`) happily lands the
  // cursor on dates that pre-date the profile entirely — e.g. a profile
  // created on a Sat with first service date next Mon would emit a
  // ghost stop on the *previous* Mon when the operator views this
  // week. The floor matches what the operator means by "this is when
  // the schedule started" — historical fact, not user-editable.
  // Missing created_at (legacy rows) falls back to no floor.
  const createdFloor = (() => {
    if (!profile.created_at) return null
    const d = new Date(profile.created_at)
    if (isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    return d
  })()
  const notBeforeCreated = (d) => !createdFloor || d >= createdFloor

  if (isNthWeekdayMonthly(profile)) {
    const day = profile.preferred_day_of_week
    const n = profile.monthly_week_of_month
    const out = []
    let m = new Date(start.getFullYear(), start.getMonth(), 1)
    const lastM = new Date(end.getFullYear(), end.getMonth(), 1)
    while (m <= lastM) {
      const candidate = nthWeekdayOfMonth(m.getFullYear(), m.getMonth(), n, day)
      if (candidate && candidate >= start && candidate <= end
          && notSkipped(candidate) && notBeforeCreated(candidate)) {
        out.push(candidate)
      }
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    }
    return out
  }

  // Cadence interval: anchor on next_generation_at || last_generated_at,
  // then walk forward/backward by interval days.
  const interval = cadenceIntervalDays(profile)
  if (!interval) return []
  // Pattern-only: anchor on the IMMUTABLE series origin, never the moving
  // next_generation_at (which used to drift). Fall back through created_at and
  // the legacy pointers so any caller still resolves. Parse date-only strings
  // as LOCAL midnight so a YYYY-MM-DD anchor never shifts a day in any tz.
  // Prefer the immutable series_anchor_date; before the migration backfills it,
  // fall back to next_generation_at (still ON-pattern, = old behaviour) rather
  // than created_at (an arbitrary weekday). created_at stays the floor below.
  const anchorStr = profile.series_anchor_date || profile.next_generation_at || profile.last_generated_at
  const anchor = anchorStr
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(anchorStr) ? anchorStr + 'T00:00:00' : anchorStr)
    : new Date()
  if (isNaN(anchor.getTime())) return []
  let cursor = new Date(anchor); cursor.setHours(0, 0, 0, 0)
  while (cursor > end)   cursor.setDate(cursor.getDate() - interval)
  while (cursor < start) cursor.setDate(cursor.getDate() + interval)
  const out = []
  while (cursor <= end) {
    if (notSkipped(cursor) && notBeforeCreated(cursor)) out.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + interval)
  }
  return out
}

// Map a form's RecurrencePicker state + first-date into the set of DB
// columns we'd write on the recurring_job_profiles row. Centralises
// the "weekly stores preferred_day_of_week, monthly stores both +
// monthly_week_of_month" logic so AddRecurringModal, RecurringJobs,
// and StopDetailModal all produce identical writes for the same
// picker state.
//
// Returns an object suitable to spread into an insert/update payload:
//   { recurrence_rule, custom_interval_days, preferred_day_of_week,
//     preferred_days_of_week, monthly_week_of_month }
//
// preferred_days_of_week is always null (legacy multi-day column kept
// nullable on the schema for back-compat; the app no longer writes
// to it).
//
// firstDate must be a YYYY-MM-DD string or Date (we just need its
// weekday). Pass null/empty when no anchor — the day-of-week fields
// will all be null in that case.
export function profileFieldsFromForm({ rule, customDays, firstDate }) {
  const anchorDate = firstDate
    ? (typeof firstDate === 'string' ? new Date(firstDate + 'T00:00:00') : new Date(firstDate))
    : null
  const anchorWd = anchorDate && !isNaN(anchorDate.getTime()) ? anchorDate.getDay() : null

  let preferred_day_of_week = null
  let monthly_week_of_month = null

  if (rule === 'monthly' && anchorWd != null) {
    preferred_day_of_week = anchorWd
    monthly_week_of_month = computeNthFromDate(anchorDate)
  } else if ((rule === 'weekly' || rule === 'fortnightly') && anchorWd != null) {
    preferred_day_of_week = anchorWd
  }

  return {
    recurrence_rule: rule,
    custom_interval_days: rule === 'custom' ? (Number(customDays) || 7) : null,
    preferred_day_of_week,
    preferred_days_of_week: null,
    monthly_week_of_month,
  }
}

// True when the rule needs a recurring_job_profile to fully express
// itself (monthly-Nth). Pool/job rows alone can't store that —
// StopDetailModal uses this to decide whether to spawn a profile when
// one doesn't already exist.
export function ruleRequiresProfile(rule, monthlyWeekOfMonth) {
  if (rule === 'monthly' && monthlyWeekOfMonth != null) return true
  return false
}

// Pretty-print the schedule for the recurring detail card / list.
// Examples:
//   "1st Monday of every month"
//   "Weekly"
//   "Every 14 days"
export function describeSchedule(profile) {
  if (!profile) return ''
  const r = profile.recurrence_rule
  if (isNthWeekdayMonthly(profile)) {
    const dayLabel = DAYS_OF_WEEK.find(o => o.value === profile.preferred_day_of_week)?.long
    const nLabel   = MONTH_WEEK_OPTIONS.find(o => o.value === profile.monthly_week_of_month)?.label
    if (dayLabel && nLabel) return `${nLabel} ${dayLabel} of every month`
  }
  if (r === 'custom') return `Every ${profile.custom_interval_days || 7} days`
  return RECURRENCE_LABELS[r] || r
}
