// THE single writer of pools.next_due_at (and the only place that advances a
// recurring profile's next_generation_at mirror).
//
// Pattern-only scheduling: the recurrence pattern (rule + immutable
// series_anchor_date) is the source of truth; service_records are the history.
// next_due_at is a DERIVED CACHE = the oldest UNFULFILLED occurrence per the
// fixed pattern. It is NEVER advanced by "+interval" — it is recomputed from
// (pattern − fulfilled occurrences). Every action that changes history/schedule
// calls recomputePoolNextDue(poolId); nothing else writes these columns. A
// build-time guard (scripts/check-single-writer.mjs) enforces that.
import { supabase } from './supabase'
import { occurrencesInRange, computeNextOccurrence } from './recurringScheduling'

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Has this profile's configured duration ended as of `now`?
function profileEnded(profile, now) {
  if (profile.duration_type === 'until_date' && profile.end_date) {
    if (new Date(profile.end_date + 'T23:59:59') < now) return true
  }
  if (profile.duration_type === 'num_visits' && profile.total_visits) {
    if ((profile.completed_visits || 0) >= profile.total_visits) return true
  }
  return false
}

// Earliest UNFULFILLED occurrence for ONE profile, accounting for history.
// `records` = [{ t: localMidnightMillis }] of completed/unable services.
// Returns a Date (local midnight) or null.
function nextUnfulfilledForProfile(profile, records, now) {
  const lookback = startOfDay(now); lookback.setDate(lookback.getDate() - 365)
  const horizon = startOfDay(now); horizon.setDate(horizon.getDate() + 365)
  const occ = occurrencesInRange(profile, lookback, horizon)
  if (!occ.length) return null
  let guard = 0
  for (let i = 0; i < occ.length; i++) {
    if (++guard > 5000) break
    const start = occ[i].getTime()
    // Upper bound of this occurrence's fulfillment window = the next occurrence.
    const nextOcc = (i + 1 < occ.length)
      ? occ[i + 1]
      : (computeNextOccurrence(occ[i], profile) || new Date(occ[i].getTime() + 365 * 86400000))
    const end = nextOcc.getTime()
    // Half-open [start, end): a service done a day or two late still clears the
    // right occurrence, and one service never clears two adjacent occurrences.
    const fulfilled = records.some(r => r.t >= start && r.t < end)
    if (!fulfilled) return occ[i]
  }
  return null
}

// Recompute and persist pools.next_due_at for one pool. Returns the ISO string
// written (or null). Safe to call from any history/schedule-changing action.
export async function recomputePoolNextDue(poolId, { now = new Date() } = {}) {
  if (!poolId) return null

  const [poolRes, profilesRes] = await Promise.all([
    supabase.from('pools').select('id, schedule_frequency, last_serviced_at').eq('id', poolId).single(),
    supabase
      .from('recurring_job_profiles')
      .select('id, recurrence_rule, custom_interval_days, preferred_day_of_week, monthly_week_of_month, series_anchor_date, created_at, skipped_dates, duration_type, total_visits, completed_visits, end_date, status, is_active')
      .eq('pool_id', poolId)
      .eq('is_active', true)
      .in('status', ['active']),
  ])
  // A transient load failure must NOT be treated as "no schedule" — writing
  // next_due_at = null on a network blip would silently drop the pool off the
  // schedule. Leave the cache untouched and bail. (.single() also errors when
  // the pool genuinely no longer exists, in which case there's nothing to write
  // either.) Returns undefined = "not recomputed", distinct from null = "cleared".
  if (poolRes.error || profilesRes.error) {
    console.warn('recomputePoolNextDue: load failed, leaving next_due_at unchanged', poolRes.error || profilesRes.error)
    return undefined
  }
  const pool = poolRes.data
  const active = profilesRes.data || []

  // No active profile → the pool has no schedule. Pool-level scheduling was
  // removed; next_due_at is now purely a profile-derived cache, so clear it.
  if (!active.length) {
    await supabase.from('pools').update({ next_due_at: null }).eq('id', poolId)
    return null
  }

  // Fulfilling history (bounded window — flat as history grows).
  const lookback = startOfDay(now); lookback.setDate(lookback.getDate() - 365)
  const { data: recRows, error: recErr } = await supabase
    .from('service_records')
    .select('serviced_at, status')
    .eq('pool_id', poolId)
    .in('status', ['completed', 'unable_to_service'])
    .gte('serviced_at', lookback.toISOString())
  // If history failed to load, every occurrence would look unfulfilled and the
  // pool would jump backward to the oldest occurrence. Leave the cache alone.
  if (recErr) {
    console.warn('recomputePoolNextDue: history load failed, leaving next_due_at unchanged', recErr)
    return undefined
  }
  const records = (recRows || []).map(r => ({ t: startOfDay(new Date(r.serviced_at)).getTime() }))

  // Per-profile: an ended profile flips to completed INDIVIDUALLY and drops out
  // (it must not null the pool when a sibling profile is still live); each
  // surviving profile contributes its own next unfulfilled occurrence.
  let earliest = null
  for (const profile of active) {
    if (profileEnded(profile, now)) {
      await supabase.from('recurring_job_profiles').update({ status: 'completed' }).eq('id', profile.id)
      continue
    }
    const occ = nextUnfulfilledForProfile(profile, records, now)
    if (occ) {
      // Mirror this profile's own next occurrence (read-only; /recurring shows it).
      await supabase.from('recurring_job_profiles').update({ next_generation_at: ymdLocal(occ) }).eq('id', profile.id)
      if (!earliest || occ < earliest) earliest = occ
    }
  }

  // next_due_at = earliest across surviving profiles (09:00 local), else null.
  let nextDue = null
  if (earliest) {
    nextDue = new Date(earliest)
    nextDue.setHours(9, 0, 0, 0)
  }
  await supabase.from('pools').update({ next_due_at: nextDue ? nextDue.toISOString() : null }).eq('id', poolId)
  return nextDue ? nextDue.toISOString() : null
}

// (setPoolNextDue was removed alongside pool-level scheduling. next_due_at is
// now written ONLY by recomputePoolNextDue, derived from recurring profiles.)
