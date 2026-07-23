import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Download } from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import StatCard from '../components/ui/StatCard'
import Button from '../components/ui/Button'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

// Analytics — a top-level page (route /analytics). Everything is COUNT-based, sourced
// from `service_records` (the real field activity). No money metrics — prices aren't
// entered in this workflow, so revenue/service-value would always read zero.
//
// Service activity (KPIs 1-2, the time chart, condition mix, leaderboard) follows the
// selected date range. Recurring coverage + overdue rate are point-in-time (current
// state of the pools), so they intentionally ignore the range.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const RANGES = [
  { key: 'week',   label: 'This week' },
  { key: '30d',    label: 'Last 30 days' },
  { key: 'mtd',    label: 'This month' },
  { key: 'ytd',    label: 'This year' },
  { key: 'custom', label: 'Custom' },
]
const RANGE_SUBLABEL = {
  week: 'this week', '30d': 'last 30 days', mtd: 'month to date', ytd: 'year to date', custom: 'custom range',
}

// Pool condition on arrival — fixed order (best → worst) + a colour per condition.
const CONDITION_ORDER = ['Good', 'Cloudy', 'Dirty', 'Green']
const CONDITION_COLORS = {
  Good: 'bg-emerald-500',
  Cloudy: 'bg-sky-400',
  Dirty: 'bg-amber-600',
  Green: 'bg-lime-600', // green pool = algae bloom
}

const ymd = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`

function startOfWeek(now) {
  const x = new Date(now)
  x.setHours(0, 0, 0, 0)
  const day = x.getDay() // 0 Sun … 6 Sat
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1)) // back to Monday
  return x
}

// Resolve a preset/custom key into a concrete { start, end } window (end = "now" for
// presets). "now" is captured when the range is chosen — fine for analytics.
function resolveRange(key, customStart, customEnd) {
  const now = new Date()
  if (key === 'week') return { start: startOfWeek(now), end: now }
  if (key === '30d') { const s = new Date(now); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - 29); return { start: s, end: now } }
  if (key === 'mtd') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  if (key === 'ytd') return { start: new Date(now.getFullYear(), 0, 1), end: now }
  // custom
  const start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1)
  const end = customEnd ? new Date(`${customEnd}T23:59:59`) : now
  return { start, end }
}

// Bucket completed records across [start, end]. Daily bars for short ranges, monthly
// for long — so the chart reads well whatever the range.
function buildBuckets(completed, start, end) {
  const spanDays = (end - start) / 86_400_000
  const granularity = spanDays <= 35 ? 'day' : 'month'
  const buckets = []
  if (granularity === 'day') {
    const cur = new Date(start); cur.setHours(0, 0, 0, 0)
    const last = new Date(end); last.setHours(0, 0, 0, 0)
    let guard = 0
    while (cur <= last && guard < 400) {
      buckets.push({ key: dayKey(cur), date: new Date(cur), value: 0 })
      cur.setDate(cur.getDate() + 1); guard++
    }
  } else {
    const cur = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    let guard = 0
    while (cur <= last && guard < 120) {
      buckets.push({ key: monthKey(cur), date: new Date(cur), value: 0 })
      cur.setMonth(cur.getMonth() + 1); guard++
    }
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  for (const r of completed) {
    if (!r.serviced_at) continue
    const d = new Date(r.serviced_at)
    const i = idx.get(granularity === 'day' ? dayKey(d) : monthKey(d))
    if (i != null) buckets[i].value += 1
  }
  return { buckets, granularity }
}

export default function Reports() {
  const { business } = useBusiness()
  const [rangeKey, setRangeKey] = useState('30d')
  const [customEnd, setCustomEnd] = useState(() => ymd(new Date()))
  const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return ymd(d) })

  const [records, setRecords] = useState([])
  const [pools, setPools] = useState([])
  const [recurring, setRecurring] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  const range = useMemo(() => resolveRange(rangeKey, customStart, customEnd), [rangeKey, customStart, customEnd])

  // Point-in-time data (pools/recurring/staff) — range-independent, fetched once.
  useEffect(() => {
    if (!business?.id) return
    let active = true
    ;(async () => {
      const [poolsRes, recurringRes, staffRes] = await Promise.all([
        supabase.from('pools').select('id, next_due_at').eq('business_id', business.id),
        supabase.from('recurring_job_profiles').select('id, pool_id, is_active, status').eq('business_id', business.id),
        supabase.from('staff_members').select('id, name, role, photo_url').eq('business_id', business.id).eq('is_active', true),
      ])
      if (!active) return
      setPools(poolsRes.data || [])
      setRecurring(recurringRes.data || [])
      setStaff(staffRes.data || [])
    })()
    return () => { active = false }
  }, [business?.id])

  // Service records for the selected range — re-fetched when the range changes.
  useEffect(() => {
    if (!business?.id) return
    let active = true
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('service_records')
        .select('id, status, serviced_at, staff_id, pool_condition')
        .eq('business_id', business.id)
        .gte('serviced_at', range.start.toISOString())
        .lte('serviced_at', range.end.toISOString())
      if (!active) return
      setRecords(data || [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [business?.id, range])

  const completed = useMemo(() => records.filter(r => r.status === 'completed'), [records])
  const unable = useMemo(() => records.filter(r => r.status === 'unable_to_service'), [records])

  // ─── Time chart (range-scoped, adaptive granularity) ──
  const { buckets, granularity } = useMemo(
    () => buildBuckets(completed, range.start, range.end),
    [completed, range],
  )
  const maxBucket = Math.max(1, ...buckets.map(b => b.value))

  // ─── KPI: recurring coverage (point-in-time) ──
  const recurringCoverage = useMemo(() => {
    if (pools.length === 0) return null
    const ids = new Set(
      recurring.filter(r => r.is_active && r.status !== 'cancelled' && r.status !== 'completed').map(r => r.pool_id).filter(Boolean)
    )
    return Math.round((ids.size / pools.length) * 100)
  }, [pools, recurring])

  // ─── KPI: overdue rate (point-in-time) ──
  const overdueRate = useMemo(() => {
    if (pools.length === 0) return null
    const now = Date.now()
    const overdue = pools.filter(p => p.next_due_at && new Date(p.next_due_at).getTime() < now).length
    return Math.round((overdue / pools.length) * 100)
  }, [pools])

  // ─── Pool condition on arrival (completed records that recorded one) ──
  const conditionMix = useMemo(() => {
    const counts = { Good: 0, Cloudy: 0, Dirty: 0, Green: 0 }
    let total = 0
    for (const r of completed) {
      if (r.pool_condition && r.pool_condition in counts) { counts[r.pool_condition] += 1; total += 1 }
    }
    if (total === 0) return []
    return CONDITION_ORDER.map(name => ({ name, count: counts[name], pct: Math.round((counts[name] / total) * 100) }))
  }, [completed])

  // ─── Crew leaderboard (services done + unable, in range) ──
  const crewLeaderboard = useMemo(() => {
    const byStaff = {}
    for (const r of records) {
      const sid = r.staff_id || 'unassigned'
      if (!byStaff[sid]) byStaff[sid] = { done: 0, unable: 0 }
      if (r.status === 'completed') byStaff[sid].done += 1
      else if (r.status === 'unable_to_service') byStaff[sid].unable += 1
    }
    return staff
      .filter(s => s.name && s.name.trim())
      .map(s => ({ id: s.id, name: s.name, role: s.role || 'Tech', done: byStaff[s.id]?.done || 0, unable: byStaff[s.id]?.unable || 0 }))
      .sort((a, b) => (b.done - a.done) || (a.unable - b.unable))
  }, [records, staff])

  function exportCsv() {
    const unit = granularity === 'day' ? 'Day' : 'Month'
    const header = [unit, 'Services completed']
    const rows = buckets.map(b => [
      granularity === 'day' ? ymd(b.date) : `${MONTH_NAMES[b.date.getMonth()]} ${b.date.getFullYear()}`,
      b.value,
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `poolpro-services-${rangeKey}-${ymd(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const rangeSub = RANGE_SUBLABEL[rangeKey]
  const labelEvery = buckets.length <= 8 ? 1 : Math.ceil(buckets.length / 6)
  const todayStr = ymd(new Date())

  return (
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5" strokeWidth={2.5} />
            Service activity
          </span>
        }
        title="Analytics"
        action={
          <Button leftIcon={Download} variant="secondary" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      {/* Range filter */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRangeKey(r.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              rangeKey === r.key
                ? 'bg-pool-500 border-pool-500 text-white'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-pool-300',
            )}
          >
            {r.label}
          </button>
        ))}
        {rangeKey === 'custom' && (
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="date" value={customStart} max={customEnd || todayStr}
              onChange={e => setCustomStart(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5"
            />
            <span>to</span>
            <input
              type="date" value={customEnd} min={customStart} max={todayStr}
              onChange={e => setCustomEnd(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5"
            />
          </div>
        )}
      </div>
      <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">
        Service counts follow the selected range · recurring coverage and overdue rate reflect now.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
            <StatCard label="Services completed" value={completed.length} iconTone="brand" trendLabel={rangeSub} />
            <StatCard label="Unable to service" value={unable.length} iconTone={unable.length > 0 ? 'red' : 'gray'} trendLabel={rangeSub} />
            <StatCard
              label="Recurring coverage"
              value={recurringCoverage == null ? '—' : recurringCoverage}
              suffix={recurringCoverage == null ? '' : '%'}
              iconTone="brand"
              trendLabel={recurringCoverage == null ? 'no pools yet' : 'of pools · now'}
            />
            <StatCard
              label="Overdue rate"
              value={overdueRate == null ? '—' : overdueRate}
              suffix={overdueRate == null ? '' : '%'}
              iconTone={overdueRate && overdueRate > 0 ? 'red' : 'gray'}
              trendLabel={overdueRate == null ? 'no pools yet' : 'past due · now'}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Services over time */}
            <Card className="md:col-span-2 !p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  Services · {RANGES.find(r => r.key === rangeKey)?.label}
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {completed.length} {completed.length === 1 ? 'service' : 'services'}
                </p>
              </div>
              {completed.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No completed services in this range</p>
              ) : (
                <>
                  <div className="flex items-end gap-1 h-32 mt-4">
                    {buckets.map((b, i) => {
                      const heightPct = Math.max(3, Math.round((b.value / maxBucket) * 100))
                      const isLast = i === buckets.length - 1
                      const lbl = granularity === 'day' ? ymd(b.date) : `${MONTH_NAMES[b.date.getMonth()]} ${b.date.getFullYear()}`
                      return (
                        <div key={b.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${lbl}: ${b.value}`}>
                          {buckets.length <= 12 && b.value > 0 && (
                            <span className="text-[10px] font-semibold tabular-nums text-gray-600 dark:text-gray-400">{b.value}</span>
                          )}
                          <div
                            className={cn('w-full rounded-sm transition-all', isLast ? 'bg-pool-500 dark:bg-pool-400' : 'bg-pool-200/70 dark:bg-pool-900/40')}
                            style={{ height: `${heightPct}%`, minHeight: '4px' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-1 mt-2">
                    {buckets.map((b, i) => (
                      <p key={b.key} className="flex-1 text-[10px] text-center text-gray-500 dark:text-gray-400 min-w-0 truncate">
                        {i % labelEvery === 0 ? (granularity === 'day' ? b.date.getDate() : MONTH_NAMES[b.date.getMonth()]) : ''}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* Pool condition on arrival */}
            <Card className="!p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 mb-4">Condition on arrival</p>
              {conditionMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No condition data in this range</p>
              ) : (
                <ul className="space-y-3">
                  {conditionMix.map(s => (
                    <li key={s.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-900 dark:text-gray-100 truncate">{s.name}</span>
                        <span className="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">{s.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', CONDITION_COLORS[s.name] || 'bg-gray-400')} style={{ width: `${Math.max(2, s.pct)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Crew leaderboard */}
          <Card className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                Crew leaderboard · {RANGES.find(r => r.key === rangeKey)?.label}
              </p>
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                {crewLeaderboard.filter(c => c.done > 0).length} active
              </span>
            </div>
            {crewLeaderboard.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No staff yet</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {crewLeaderboard.map((c, i) => (
                  <li key={c.id} className="px-4 py-3">
                    {/* Desktop */}
                    <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_10rem] gap-3 items-center">
                      <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {c.done > 0 ? c.role : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </span>
                      <span className="text-sm tabular-nums text-gray-900 dark:text-gray-100 text-right font-semibold">
                        {c.done} {c.done === 1 ? 'service' : 'services'}
                        {c.unable > 0 && <span className="ml-1 text-[11px] font-normal text-orange-500">· {c.unable} unable</span>}
                      </span>
                    </div>
                    {/* Mobile */}
                    <div className="md:hidden flex items-center gap-3">
                      <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400 w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</p>
                        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
                          {c.done > 0 ? c.role : '—'}{c.unable > 0 ? ` · ${c.unable} unable` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 shrink-0">{c.done}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </PageWrapper>
  )
}
