import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useBusiness } from '../hooks/useBusiness'
import { occurrencesInRange, isProfileActive, isOccurrenceInRange } from '../lib/recurringScheduling'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import { cn } from '../lib/utils'

// Monthly per-technician fulfilment report. For the selected month, per tech,
// per client/pool: scheduled (recurring occurrences incl. skips) vs done
// (completed records matched by occurrence identity — any tech counts) with the
// shortfall in red. Unable-to-service flagged (not counted as done); one-off
// "extra" visits shown separately (not counted toward the target).

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function isSameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() }
function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export default function TechnicianReport() {
  const { business } = useBusiness()
  const navigate = useNavigate()
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [data, setData] = useState({ staff: [], profiles: [], pools: [], recurring: [], extra: [] })
  const [loading, setLoading] = useState(true)

  const monthLabel = monthAnchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  useEffect(() => {
    if (!business?.id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const mStart = startOfMonth(monthAnchor)
      const mEnd = endOfMonth(monthAnchor)
      const startYmd = ymd(mStart)
      const endYmd = ymd(mEnd)
      try {
        const [staffRes, profilesRes, poolsRes, recRes, extraRes] = await Promise.all([
          supabase.from('staff_members').select('id, name, photo_url').eq('business_id', business.id).eq('is_active', true).order('name'),
          supabase.from('recurring_job_profiles').select('*').eq('business_id', business.id),
          supabase.from('pools').select('id, name, address, client_id, assigned_staff_id, clients(name)').eq('business_id', business.id),
          // Recurring fulfilment — matched by occurrence_date in the month (so an
          // early/late service still lands in the right month), any technician.
          supabase.from('service_records')
            .select('id, pool_id, staff_id, status, recurring_profile_id, occurrence_date')
            .eq('business_id', business.id)
            .not('recurring_profile_id', 'is', null)
            .in('status', ['completed', 'unable_to_service'])
            .gte('occurrence_date', startYmd)
            .lte('occurrence_date', endYmd),
          // One-off / ad-hoc completions (no occurrence identity) — bucketed by serviced_at.
          supabase.from('service_records')
            .select('id, pool_id, serviced_at')
            .eq('business_id', business.id)
            .is('recurring_profile_id', null)
            .eq('status', 'completed')
            .gte('serviced_at', mStart.toISOString())
            .lte('serviced_at', mEnd.toISOString()),
        ])
        if (cancelled) return
        setData({
          staff: staffRes.data || [],
          profiles: profilesRes.data || [],
          pools: poolsRes.data || [],
          recurring: recRes.data || [],
          extra: extraRes.data || [],
        })
      } catch (e) {
        console.error('Technician report load failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [business?.id, monthAnchor])

  const { sections, totals } = useMemo(() => {
    const { staff, profiles, pools, recurring, extra } = data
    const techById = new Map(staff.map(s => [s.id, s]))
    const poolById = new Map(pools.map(p => [p.id, p]))
    const profileById = new Map(profiles.map(p => [p.id, p]))
    const mStart = startOfMonth(monthAnchor)
    const mEnd = endOfMonth(monthAnchor)
    const startYmd = ymd(mStart)
    const endYmd = ymd(mEnd)
    const techKeyOf = (id) => id || 'unassigned'

    const rows = new Map() // `${techKey}::${poolId}` → row
    function ensureRow(techKey, poolId) {
      const k = `${techKey}::${poolId}`
      if (!rows.has(k)) {
        const pool = poolById.get(poolId)
        rows.set(k, {
          techKey, poolId,
          poolName: pool?.name || null,
          poolAddress: pool?.address || null,
          clientName: pool?.clients?.name || null,
          scheduled: 0, done: 0, unable: 0, extra: 0,
        })
      }
      return rows.get(k)
    }

    // Scheduled — active profiles only; skips added back (they still count).
    for (const profile of profiles) {
      if (!isProfileActive(profile) || !profile.pool_id) continue
      const occ = occurrencesInRange(profile, mStart, mEnd).filter((d, i) => isOccurrenceInRange(profile, d, i))
      let count = occ.length
      const skips = Array.isArray(profile.skipped_dates) ? profile.skipped_dates : []
      for (const s of skips) {
        const sy = ymd(s)
        if (sy >= startYmd && sy <= endYmd) count++
      }
      if (count === 0) continue
      ensureRow(techKeyOf(profile.assigned_staff_id), profile.pool_id).scheduled += count
    }

    // Done + unable — attribute to the assigned tech via the fulfilled profile.
    for (const r of recurring) {
      const prof = profileById.get(r.recurring_profile_id)
      const techKey = techKeyOf(prof?.assigned_staff_id || poolById.get(r.pool_id)?.assigned_staff_id)
      const row = ensureRow(techKey, r.pool_id)
      if (r.status === 'completed') row.done++
      else if (r.status === 'unable_to_service') row.unable++
    }

    // Extra (one-off) — attribute to the pool's assigned tech.
    for (const r of extra) {
      ensureRow(techKeyOf(poolById.get(r.pool_id)?.assigned_staff_id), r.pool_id).extra++
    }

    const byTech = new Map()
    for (const row of rows.values()) {
      if (!byTech.has(row.techKey)) byTech.set(row.techKey, [])
      byTech.get(row.techKey).push(row)
    }

    const sections = []
    for (const [techKey, techRows] of byTech) {
      const tech = techKey === 'unassigned' ? null : techById.get(techKey)
      techRows.sort((a, b) => (a.clientName || a.poolAddress || '').localeCompare(b.clientName || b.poolAddress || ''))
      sections.push({
        techKey,
        name: tech?.name || (techKey === 'unassigned' ? 'Unassigned' : 'Unknown technician'),
        photo: tech?.photo_url || null,
        rows: techRows,
        sched: techRows.reduce((s, r) => s + r.scheduled, 0),
        done: techRows.reduce((s, r) => s + r.done, 0),
        shortfall: techRows.reduce((s, r) => s + Math.max(0, r.scheduled - r.done), 0),
      })
    }
    sections.sort((a, b) => {
      if (a.techKey === 'unassigned') return 1
      if (b.techKey === 'unassigned') return -1
      return a.name.localeCompare(b.name)
    })

    const totals = {
      scheduled: sections.reduce((s, x) => s + x.sched, 0),
      done: sections.reduce((s, x) => s + x.done, 0),
      shortfall: sections.reduce((s, x) => s + x.shortfall, 0),
    }
    return { sections, totals }
  }, [data, monthAnchor])

  function exportCsv() {
    const header = ['Month', 'Technician', 'Client', 'Pool', 'Scheduled', 'Done', 'Unable', 'Extra', 'Shortfall']
    const out = [header]
    for (const sec of sections) {
      for (const r of sec.rows) {
        out.push([
          monthLabel, sec.name, r.clientName || '', r.poolName || r.poolAddress || '',
          r.scheduled, r.done, r.unable, r.extra, Math.max(0, r.scheduled - r.done),
        ])
      }
    }
    const csv = out.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `technician-report-${ymd(startOfMonth(monthAnchor)).slice(0, 7)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pillBase = 'inline-flex items-center gap-1 px-3 h-9 rounded-full text-sm font-medium border transition-colors'
  const pillIdle = 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'

  return (
    <div className="space-y-5">
      {/* Header: month nav + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Technician report</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Scheduled vs delivered services per technician — {monthLabel}.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthAnchor(d => addMonths(d, -1))} className={cn(pillBase, pillIdle)} aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" strokeWidth={2} /> Prev
          </button>
          <button
            onClick={() => setMonthAnchor(new Date())}
            className={cn(pillBase, isSameMonth(monthAnchor, new Date())
              ? 'bg-pool-50 dark:bg-pool-950/40 border-pool-200/70 dark:border-pool-800/40 text-pool-700 dark:text-pool-300'
              : pillIdle)}
          >
            This month
          </button>
          <button onClick={() => setMonthAnchor(d => addMonths(d, 1))} className={cn(pillBase, pillIdle)} aria-label="Next month">
            Next <ChevronRight className="w-4 h-4" strokeWidth={2} />
          </button>
          <button onClick={exportCsv} className={cn(pillBase, pillIdle)} title="Export CSV">
            <Download className="w-4 h-4" strokeWidth={2} /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Month summary */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Scheduled" value={totals.scheduled} />
            <StatCard label="Delivered" value={totals.done} />
            <StatCard label="Shortfall" value={totals.shortfall} iconTone="red" icon={totals.shortfall > 0 ? AlertTriangle : undefined} />
          </div>

          {sections.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No scheduled or completed services for {monthLabel}.</p>
          ) : (
            sections.map(sec => (
              <section key={sec.techKey} className="rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {/* Tech header */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50/70 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {sec.photo ? (
                      <img src={sec.photo} alt={sec.name} className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-700" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-pool-100 dark:bg-pool-950/50 text-pool-700 dark:text-pool-300 flex items-center justify-center text-xs font-bold">
                        {sec.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{sec.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-gray-500 dark:text-gray-400">{sec.done}/{sec.sched} done</span>
                    {sec.shortfall > 0
                      ? <span className="font-bold text-red-600 dark:text-red-400">{sec.shortfall} short</span>
                      : <span className="font-medium text-emerald-600 dark:text-emerald-400">On target</span>}
                  </div>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4.5rem] gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <span>Client · Pool</span>
                  <span className="text-right">Sched</span>
                  <span className="text-right">Done</span>
                  <span className="text-right">Short</span>
                </div>

                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sec.rows.map(r => {
                    const short = Math.max(0, r.scheduled - r.done)
                    return (
                      <li key={r.poolId}>
                        <button
                          onClick={() => navigate(`/pools/${r.poolId}`)}
                          className="w-full grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4.5rem] gap-2 px-4 py-3 text-left items-center hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.clientName || 'Unknown client'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.poolName || r.poolAddress || 'Pool'}</p>
                            {(r.unable > 0 || r.extra > 0) && (
                              <div className="flex items-center gap-1.5 mt-1">
                                {r.unable > 0 && <Badge variant="warning" className="text-[10px]">{r.unable} unable</Badge>}
                                {r.extra > 0 && <span className="text-[10px] text-gray-400 dark:text-gray-500">+{r.extra} extra</span>}
                              </div>
                            )}
                          </div>
                          <span className="text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">{r.scheduled}</span>
                          <span className="text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">{r.done}</span>
                          <span className={cn('text-right text-sm tabular-nums font-bold', short > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-gray-600')}>
                            {short > 0 ? short : '—'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
