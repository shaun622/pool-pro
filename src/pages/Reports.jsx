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

// Analytics — a top-level page (route /analytics). It renders its own PageWrapper +
// PageHero (it used to live inside the Settings shell, which supplied them).
//
// Everything here is COUNT-based, sourced from `service_records` (the real field
// activity the crew log). There are deliberately NO money metrics: prices aren't
// entered in this workflow, so revenue/service-value would always read zero.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Build the 6 most recent months [{ key, label, year, month }]
function getLast6Months(now = new Date()) {
  const out = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: MONTH_NAMES[d.getMonth()],
      key: `${d.getFullYear()}-${d.getMonth()}`,
    })
  }
  return out
}

// Pool condition on arrival — fixed order (best → worst) + a colour per condition.
const CONDITION_ORDER = ['Good', 'Cloudy', 'Dirty', 'Green']
const CONDITION_COLORS = {
  Good: 'bg-emerald-500',
  Cloudy: 'bg-sky-400',
  Dirty: 'bg-amber-600',
  Green: 'bg-lime-600', // green pool = algae bloom
}

export default function Reports() {
  const { business } = useBusiness()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState([])
  const [pools, setPools] = useState([])
  const [recurring, setRecurring] = useState([])
  const [staff, setStaff] = useState([])

  useEffect(() => {
    if (!business?.id) return
    fetchAll()
  }, [business?.id])

  async function fetchAll() {
    setLoading(true)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)
    const cutoff = sixMonthsAgo.toISOString()

    const [recordsRes, poolsRes, recurringRes, staffRes] = await Promise.all([
      supabase.from('service_records')
        .select('id, status, serviced_at, staff_id, pool_condition')
        .eq('business_id', business.id)
        .gte('serviced_at', cutoff),
      supabase.from('pools')
        .select('id, next_due_at')
        .eq('business_id', business.id),
      supabase.from('recurring_job_profiles')
        .select('id, pool_id, is_active, status')
        .eq('business_id', business.id),
      supabase.from('staff_members')
        .select('id, name, role, photo_url')
        .eq('business_id', business.id)
        .eq('is_active', true),
    ])

    setRecords(recordsRes.data || [])
    setPools(poolsRes.data || [])
    setRecurring(recurringRes.data || [])
    setStaff(staffRes.data || [])
    setLoading(false)
  }

  const months = useMemo(() => getLast6Months(), [])
  const completed = useMemo(() => records.filter(r => r.status === 'completed'), [records])
  const unable = useMemo(() => records.filter(r => r.status === 'unable_to_service'), [records])

  const startOfMonth = () => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  }

  // ─── Services completed per month (6mo) ──
  const servicesByMonth = useMemo(() => {
    const map = {}
    for (const m of months) map[m.key] = 0
    for (const r of completed) {
      if (!r.serviced_at) continue
      const d = new Date(r.serviced_at)
      const k = `${d.getFullYear()}-${d.getMonth()}`
      if (k in map) map[k] += 1
    }
    return months.map(m => ({ ...m, value: map[m.key] || 0 }))
  }, [months, completed])

  const total6mo = useMemo(() => servicesByMonth.reduce((s, m) => s + m.value, 0), [servicesByMonth])
  // Trend: latest month vs prior month
  const servicesTrend = useMemo(() => {
    if (servicesByMonth.length < 2) return null
    const latest = servicesByMonth[servicesByMonth.length - 1].value
    const prior = servicesByMonth[servicesByMonth.length - 2].value
    if (prior === 0) return null
    return Math.round(((latest - prior) / prior) * 100)
  }, [servicesByMonth])

  // ─── KPI 1: services completed this month (latest bucket) ──
  const servicesThisMonth = servicesByMonth.length ? servicesByMonth[servicesByMonth.length - 1].value : 0

  // ─── KPI 2: unable-to-service this month ──
  const unableThisMonth = useMemo(() => {
    const start = startOfMonth()
    return unable.filter(r => r.serviced_at && new Date(r.serviced_at) >= start).length
  }, [unable])

  // ─── KPI 3: recurring coverage (% of pools on active recurring) ──
  const recurringCoverage = useMemo(() => {
    if (pools.length === 0) return null
    const recurringPoolIds = new Set(
      recurring
        .filter(r => r.is_active && r.status !== 'cancelled' && r.status !== 'completed')
        .map(r => r.pool_id)
        .filter(Boolean)
    )
    return Math.round((recurringPoolIds.size / pools.length) * 100)
  }, [pools, recurring])

  // ─── KPI 4: overdue rate (% of pools past next_due_at) ──
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
      const c = r.pool_condition
      if (c && c in counts) { counts[c] += 1; total += 1 }
    }
    if (total === 0) return []
    return CONDITION_ORDER.map(name => ({
      name,
      count: counts[name],
      pct: Math.round((counts[name] / total) * 100),
    }))
  }, [completed])

  // ─── Crew leaderboard (this month: services done + unable) ──
  const currentMonthLabel = MONTH_NAMES[new Date().getMonth()]
  const crewLeaderboard = useMemo(() => {
    const start = startOfMonth()
    const byStaff = {}
    for (const r of records) {
      if (!r.serviced_at || new Date(r.serviced_at) < start) continue
      const sid = r.staff_id || 'unassigned'
      if (!byStaff[sid]) byStaff[sid] = { done: 0, unable: 0 }
      if (r.status === 'completed') byStaff[sid].done += 1
      else if (r.status === 'unable_to_service') byStaff[sid].unable += 1
    }
    return staff
      .filter(s => s.name && s.name.trim())
      .map(s => ({
        id: s.id,
        name: s.name,
        role: s.role || 'Tech',
        photo: s.photo_url,
        done: byStaff[s.id]?.done || 0,
        unable: byStaff[s.id]?.unable || 0,
      }))
      .sort((a, b) => (b.done - a.done) || (a.unable - b.unable))
  }, [records, staff])

  function exportCsv() {
    const header = ['Month', 'Services completed']
    const rows = servicesByMonth.map(m => [`${m.label} ${m.year}`, m.value])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `poolpro-services-6mo-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const maxServices = Math.max(1, ...servicesByMonth.map(m => m.value))
  const trendStr = servicesTrend == null ? '' : `${servicesTrend >= 0 ? '+' : ''}${servicesTrend}%`

  return (
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5" strokeWidth={2.5} />
            Last 6 months of activity
          </span>
        }
        title="Analytics"
        action={
          <Button leftIcon={Download} variant="secondary" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI strip — quantity metrics only */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
            <StatCard
              label="Services completed"
              value={servicesThisMonth}
              iconTone="brand"
              trendLabel="this month"
            />
            <StatCard
              label="Unable to service"
              value={unableThisMonth}
              iconTone={unableThisMonth > 0 ? 'red' : 'gray'}
              trendLabel="this month"
            />
            <StatCard
              label="Recurring coverage"
              value={recurringCoverage == null ? '—' : recurringCoverage}
              suffix={recurringCoverage == null ? '' : '%'}
              iconTone="brand"
              trendLabel={recurringCoverage == null ? 'no pools yet' : 'of pools'}
            />
            <StatCard
              label="Overdue rate"
              value={overdueRate == null ? '—' : overdueRate}
              suffix={overdueRate == null ? '' : '%'}
              iconTone={overdueRate && overdueRate > 0 ? 'red' : 'gray'}
              trendLabel={overdueRate == null ? 'no pools yet' : 'of pools past due'}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Services · 6mo */}
            <Card className="md:col-span-2 !p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Services · 6mo</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {total6mo} {total6mo === 1 ? 'service' : 'services'}
                  {trendStr && (
                    <span className={cn(
                      'ml-2 text-xs font-semibold',
                      servicesTrend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}>{trendStr}</span>
                  )}
                </p>
              </div>
              {total6mo === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No completed services yet</p>
              ) : (
                <div className="grid grid-cols-6 gap-3 items-end h-32 mt-6">
                  {servicesByMonth.map(m => {
                    const heightPct = Math.max(3, Math.round((m.value / maxServices) * 100))
                    const isLatest = m.key === months[months.length - 1].key
                    return (
                      <div key={m.key} className="flex flex-col items-center gap-1.5">
                        {isLatest && m.value > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums text-gray-700 dark:text-gray-300">{m.value}</span>
                        )}
                        <div
                          className={cn(
                            'w-full rounded-md transition-all',
                            isLatest ? 'bg-pool-500 dark:bg-pool-400' : 'bg-pool-200/70 dark:bg-pool-900/40',
                          )}
                          style={{ height: `${heightPct}%`, minHeight: '6px' }}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="grid grid-cols-6 gap-3 mt-2">
                {servicesByMonth.map(m => (
                  <p key={m.key} className="text-[11px] text-center text-gray-500 dark:text-gray-400">{m.label}</p>
                ))}
              </div>
            </Card>

            {/* Pool condition on arrival */}
            <Card className="!p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 mb-4">Condition on arrival</p>
              {conditionMix.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No condition data yet</p>
              ) : (
                <ul className="space-y-3">
                  {conditionMix.map(s => (
                    <li key={s.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-900 dark:text-gray-100 truncate">{s.name}</span>
                        <span className="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">{s.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', CONDITION_COLORS[s.name] || 'bg-gray-400')}
                          style={{ width: `${Math.max(2, s.pct)}%` }}
                        />
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
                Crew leaderboard · {currentMonthLabel}
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
                      <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {c.name}
                      </span>
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
                      <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400 w-6 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</p>
                        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
                          {c.done > 0 ? c.role : '—'}{c.unable > 0 ? ` · ${c.unable} unable` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 shrink-0">
                        {c.done}
                      </span>
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
