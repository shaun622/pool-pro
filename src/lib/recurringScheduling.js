// Date math + dropdown options for recurring job profiles.
//
// The schema supports two distinct shapes:
//   1. Cadence + single day (weekly / fortnightly / 6_weekly / quarterly /
//      monthly-legacy / custom): one occurrence every N days, anchored on
//      the profile's next_generation_at.
//   2. Multi-day weekly (bi_weekly / tri_weekly): preferred_days_of_week
//      is an int[] of weekdays (0=Sun..6=Sat), occurrence on each one
//      every week.
//   3. Monthly Nth-weekday: monthly_week_of_month + preferred_day_of_week
//      describe "1st Monday of every month", "last Friday", etc.
//
// Helpers here are the single source of truth for those rules so the
// Schedule projection, the StopDetailModal materialisation paths, and
// the recurring create/edit forms can't drift out of sync.

export const RECURRENCE_LABELS = {
  weekly:      'Weekly',
  fortnightly: 'Fortnightly',
  bi_weekly:   'Bi-weekly (2/week)',
  tri_weekly:  'Tri-weekly (3/week)',
  monthly:     'Monthly',
  '6_weekly':  'Every 6 weeks',
  quarterly:   'Quarterly',
  custom:      'Custom',
}

// Options shown in the new-create / edit pickers. Legacy values
// (6_weekly, quarterly) are still valid in the DB but no longer offered
// to operators creating new profiles.
export const RECURRENCE_OPTIONS = [
  { value: 'weekly',      label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'bi_weekly',   label: 'Bi-weekly (2/week)' },
  { value: 'tri_weekly',  label: 'Tri-weekly (3/week)' },
  { value: 'monthly',     label: 'Monthly' },
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

// How many distinct days a multi-day-per-week rule expects. Returns null
// for cadence rules so the form knows to render the single-day picker.
export function expectedDayCount(rule) {
  if (rule === 'bi_weekly')  return 2
  if (rule === 'tri_weekly') return 3
  return null
}

// True when the rule is a "many days per week" pattern.
export function isMultiDayWeekly(rule) {
  return rule === 'bi_weekly' || rule === 'tri_weekly'
}

// True when the rule uses Nth-weekday semantics (only set for monthly
// when monthly_week_of_month is populated; legacy monthly profiles
// fall back to the cadence path).
export function isNthWeekdayMonthly(profile) {
  return profile?.recurrence_rule === 'monthly' && profile.monthly_week_of_month != null
}

// Cadence interval in days for the simple "+N days" rules. Multi-day
// weekly and Nth-weekday monthly are NOT representable as a fixed
// interval — callers should branch via isMultiDayWeekly / isNthWeekdayMonthly
// before falling back here.
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

  if (isMultiDayWeekly(profile.recurrence_rule)) {
    const days = (profile.preferred_days_of_week || []).slice().sort((a, b) => a - b)
    if (!days.length) return null
    // Walk forward day-by-day; the next match is at most 7 days out.
    for (let offset = 1; offset <= 7; offset++) {
      const test = new Date(base)
      test.setDate(test.getDate() + offset)
      if (days.includes(test.getDay())) return test
    }
    return null
  }

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

// Enumerate every occurrence date the profile would land on, strictly
// inside [rangeStart, rangeEnd] (inclusive on both ends). Used by the
// Schedule view to project profile-based stops onto the visible week.
//
// rangeStart/rangeEnd should be Dates (any time-of-day; we normalise).
// Returns an array of Date objects, each at local midnight.
export function occurrencesInRange(profile, rangeStart, rangeEnd) {
  if (!profile) return []
  const start = new Date(rangeStart); start.setHours(0, 0, 0, 0)
  const end   = new Date(rangeEnd);   end.setHours(0, 0, 0, 0)
  if (start > end) return []

  if (isMultiDayWeekly(profile.recurrence_rule)) {
    const days = (profile.preferred_days_of_week || []).slice()
    if (!days.length) return []
    const out = []
    const cursor = new Date(start)
    while (cursor <= end) {
      if (days.includes(cursor.getDay())) {
        const d = new Date(cursor); d.setHours(0, 0, 0, 0)
        out.push(d)
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return out
  }

  if (isNthWeekdayMonthly(profile)) {
    const day = profile.preferred_day_of_week
    const n = profile.monthly_week_of_month
    const out = []
    let m = new Date(start.getFullYear(), start.getMonth(), 1)
    const lastM = new Date(end.getFullYear(), end.getMonth(), 1)
    while (m <= lastM) {
      const candidate = nthWeekdayOfMonth(m.getFullYear(), m.getMonth(), n, day)
      if (candidate && candidate >= start && candidate <= end) {
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
  const anchorStr = profile.next_generation_at || profile.last_generated_at
  const anchor = anchorStr ? new Date(anchorStr) : new Date()
  if (isNaN(anchor.getTime())) return []
  let cursor = new Date(anchor); cursor.setHours(0, 0, 0, 0)
  while (cursor > end)   cursor.setDate(cursor.getDate() - interval)
  while (cursor < start) cursor.setDate(cursor.getDate() + interval)
  const out = []
  while (cursor <= end) {
    out.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + interval)
  }
  return out
}

// Pretty-print the schedule for the recurring detail card / list.
// Examples:
//   "Mon, Wed, Fri every week"
//   "1st Monday of every month"
//   "Weekly · Tue"
//   "Every 14 days"
export function describeSchedule(profile) {
  if (!profile) return ''
  const r = profile.recurrence_rule
  if (isMultiDayWeekly(r)) {
    const days = (profile.preferred_days_of_week || [])
      .slice().sort((a, b) => a - b)
      .map(d => DAYS_OF_WEEK.find(o => o.value === d)?.label || '')
      .filter(Boolean)
    return days.length ? `${days.join(', ')} every week` : RECURRENCE_LABELS[r]
  }
  if (isNthWeekdayMonthly(profile)) {
    const dayLabel = DAYS_OF_WEEK.find(o => o.value === profile.preferred_day_of_week)?.long
    const nLabel   = MONTH_WEEK_OPTIONS.find(o => o.value === profile.monthly_week_of_month)?.label
    if (dayLabel && nLabel) return `${nLabel} ${dayLabel} of every month`
  }
  if (r === 'custom') return `Every ${profile.custom_interval_days || 7} days`
  return RECURRENCE_LABELS[r] || r
}
