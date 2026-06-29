import { occurrencesInRange, isProfileActive, isOccurrenceInRange } from './recurringScheduling'

// Shared monthly fulfilment maths — the same model the technician report uses,
// so the client summary boxes reconcile with it.
//
//   scheduled = recurring occurrences projected for the month (incl. skips —
//               a client-requested skip still counts toward the target)
//   done      = completed service_records that fulfil those occurrences
//               (matched by occurrence identity upstream; any technician counts)
//   unable    = unable-to-service records (not counted as done)
//   shortfall = max(0, scheduled - done)
//
// Callers pass the profiles + records already scoped to whatever they want
// (one client, one pool, the whole business).

export function monthStart(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1) }
export function monthEnd(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }

function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function monthlyFulfilment(profiles, records, monthDate = new Date()) {
  const mStart = monthStart(monthDate)
  const mEnd = monthEnd(monthDate)
  const startYmd = ymd(mStart)
  const endYmd = ymd(mEnd)

  let scheduled = 0
  for (const p of (profiles || [])) {
    if (!isProfileActive(p)) continue
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
    if (r.status === 'completed') done++
    else if (r.status === 'unable_to_service') unable++
  }

  return { scheduled, done, unable, shortfall: Math.max(0, scheduled - done) }
}
