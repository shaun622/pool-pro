import { occurrencesInRange, isProfileActive, isOccurrenceInRange } from './recurringScheduling'

// Shared monthly fulfilment maths — the same model the technician report uses,
// so the client summary boxes + the per-pool drill-down all reconcile.
//
//   scheduled = recurring occurrences projected for the month (incl. skips —
//               a client-requested skip still counts toward the target)
//   done      = completed service_records that fulfil those occurrences
//               (matched by occurrence identity upstream; any technician counts)
//   unable    = unable-to-service records (not counted as done)
//   extra     = one-off / ad-hoc completions (NOT counted toward the target)
//   shortfall = max(0, scheduled - done)
//
// Callers pass the profiles + records already scoped to whatever they want
// (one client, one pool, the whole business).

export function monthStart(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
export function monthEnd(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

export function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// "Thu 3 Jul" — parse a YYYY-MM-DD string as local midnight so it never shifts a day.
export function fmtDay(d) {
  if (!d) return ''
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00' : d)
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function monthlyFulfilment(profiles, records, extras = [], monthDate = new Date()) {
  const mStart = monthStart(monthDate)
  const mEnd = monthEnd(monthDate)
  const startYmd = ymd(mStart)
  const endYmd = ymd(mEnd)

  // Only ACTIVE profiles contribute to the month. Tie done/unable to the same
  // active set so a paused/cancelled/exhausted profile's stray completions can't
  // inflate done past scheduled (which would hide a real shortfall).
  const activeIds = new Set()
  let scheduled = 0
  for (const p of (profiles || [])) {
    if (!isProfileActive(p)) continue
    activeIds.add(p.id)
    const occ = occurrencesInRange(p, mStart, mEnd).filter((d, i) => isOccurrenceInRange(p, d, i))
    scheduled += occ.length
    const skips = Array.isArray(p.skipped_dates) ? p.skipped_dates : []
    for (const s of skips) {
      const sy = ymd(s)
      if (sy >= startYmd && sy <= endYmd) scheduled++
    }
  }

  let done = 0
  let unable = 0
  for (const r of (records || [])) {
    // A record carrying an occurrence identity for a non-active profile doesn't count.
    if (r.recurring_profile_id && !activeIds.has(r.recurring_profile_id)) continue
    if (r.status === 'completed') done++
    else if (r.status === 'unable_to_service') unable++
  }

  return { scheduled, done, unable, extra: (extras || []).length, shortfall: Math.max(0, scheduled - done) }
}

// Per-pool month breakdown for the expandable drill-down (report + client
// profile). Returns the dated occurrence list with a status each, plus the
// one-off "extra" visits. profiles = the pool's profiles (active filtered
// inside); records = the pool's completed/unable recurring records with
// occurrence_date in the month; extras = the pool's one-off completions.
export function poolMonthDetail(profiles, records, extras, monthDate = new Date()) {
  const mStart = monthStart(monthDate)
  const mEnd = monthEnd(monthDate)
  const startYmd = ymd(mStart)
  const endYmd = ymd(mEnd)
  const todayY = ymd(new Date())

  const profs = (profiles || []).filter(p => isProfileActive(p) && p.pool_id)
  const recs = records || []
  const recByKey = new Map()
  for (const r of recs) recByKey.set(`${r.recurring_profile_id}|${String(r.occurrence_date).split('T')[0]}`, r)
  const used = new Set()
  const occurrences = []

  for (const p of profs) {
    const occ = occurrencesInRange(p, mStart, mEnd).filter((d, i) => isOccurrenceInRange(p, d, i))
    for (const d of occ) {
      const dy = ymd(d)
      const rec = recByKey.get(`${p.id}|${dy}`)
      let status
      if (rec?.status === 'completed') { status = 'done'; used.add(rec.id) }
      else if (rec?.status === 'unable_to_service') { status = 'unable'; used.add(rec.id) }
      else if (dy < todayY) status = 'missed'
      else if (dy === todayY) status = 'due'
      else status = 'upcoming'
      occurrences.push({ key: `${p.id}-${dy}`, date: dy, status, rec })
    }
    for (const s of (Array.isArray(p.skipped_dates) ? p.skipped_dates : [])) {
      const sy = ymd(s)
      if (sy >= startYmd && sy <= endYmd) occurrences.push({ key: `${p.id}-skip-${sy}`, date: sy, status: 'skipped', rec: null })
    }
  }
  // Records whose occurrence wasn't enumerated (rule changed) — show so the list
  // reconciles. Skip records belonging to non-active profiles (paused/cancelled/
  // exhausted) so they don't appear as phantom "done" rows the counts exclude.
  const activeIds = new Set(profs.map(p => p.id))
  for (const r of recs) {
    if (used.has(r.id)) continue
    if (r.recurring_profile_id && !activeIds.has(r.recurring_profile_id)) continue
    const dy = String(r.occurrence_date).split('T')[0]
    occurrences.push({ key: `off-${r.id}`, date: dy, status: r.status === 'completed' ? 'done' : 'unable', rec: r })
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date))

  const ex = (extras || [])
    .map(r => ({ key: r.id, servicedAt: r.serviced_at, tech: r.technician_name }))
    .sort((a, b) => String(a.servicedAt).localeCompare(String(b.servicedAt)))

  return { occurrences, extras: ex }
}
