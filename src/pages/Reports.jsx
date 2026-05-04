import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Download } from 'lucide-react'
import Card from '../components/ui/Card'
import StatCard from '../components/ui/StatCard'
import Button from '../components/ui/Button'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'

// NOTE: Reports renders inside the Settings shell (route is
// `/settings/analytics`), so it MUST NOT render its own PageWrapper
// or PageHero — Settings.jsx provides both. Just emit the content.

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

// Service-mix palette (pool-tinted variants)
const MIX_COLORS = ['bg-pool-500', 'bg-pool-400', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-gray-400']

export default function Reports() {
  const { business } = useBusiness()
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [invoices, setInvoices] = useState([])
  const [pools, setPools] = useState([])
  const [staff, setStaff] = useState([])
  const [recurring, setRecurring] = useState([])
  const [jobTypes, setJobTypes] = useState([])

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

    const [jobsRes, quotesRes, invoicesRes, poolsRes, staffRes, recurringRes, jobTypesRes] = await Promise.all([
      supabase.from('jobs')
        .select('id, status, scheduled_date, price, job_type_template_id, assigned_staff_id, client_id')
        .eq('business_id', business.id)
        .gte('scheduled_date', cutoff.slice(0, 10)),
      supabase.from('quotes')
        .select('id, status, pipeline_stage, viewed_at, created_at')
        .eq('business_id', business.id),
      supabase.from('invoices')
        .select('id, total, status, paid_date, issued_date')
        .eq('business_id', business.id)
        .eq('status', 'paid')
        .gte('paid_date', cutoff),
      supabase.from('pools')
        .select('id, next_due_at, schedule_frequency')
        .eq('business_id', business.id),
      supabase.from('recurring_job_profiles')
        .select('id, pool_id, is_active, status')
        .eq('business_id', business.id),
      supabase.from('staff_members')
        .select('id, name, role, photo_url')
        .eq('business_id', business.id)
        .eq('is_active', true),
      supabase.from('job_type_templates')
        .select('id, name, color')
        .eq('business_id', business.id),
    ])

    setJobs(jobsRes.data || [])
    setQuotes(quotesRes.data || [])
    setInvoices(invoicesRes.data || [])
    setPools(poolsRes.data || [])
    setStaff(staffRes.data || [])
    setRecurring(recurringRes.data || [])
    setJobTypes(jobTypesRes.data || [])
    setLoading(false)
  }

  // ─── KPI 1: Avg service value (last month's completed jobs) ──
  const avgServiceValue = useMemo(() => {
    const lastMonthStart = new Date()
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1)
    lastMonthStart.setDate(1)
    const lastMonthCutoff = lastMonthStart.toISOString().slice(0, 10)
    const completed = jobs.filter(j => j.status === 'completed' && j.price && j.scheduled_date >= lastMonthCutoff)
    if (completed.length === 0) return 0
    return completed.reduce((s, j) => s + Number(j.price || 0), 0) / completed.length
  }, [jobs])

  // ─── KPI 2: Quote → Won % ──
  const quoteWinRate = useMemo(() => {
    // Of quotes that have moved past "draft" (sent / viewed / accepted / declined),
    // what % were accepted?
    const decided = quotes.filter(q =>
      q.status === 'accepted' || q.status === 'declined'
    )
    if (decided.length === 0) return null
    const accepted = decided.filter(q => q.status === 'accepted').length
    return Math.round((accepted / decided.length) * 100)
  }, [quotes])

  // ─── KPI 3: Recurring coverage (% of pools on active recurring) ──
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

  // ─── KPI 4: Overdue rate (% of pools past next_due_at) ──
  const overdueRate = useMemo(() => {
    if (pools.length === 0) return null
    const now = Date.now()
    const overdue = pools.filter(p => p.next_due_at && new Date(p.next_due_at).getTime() < now).length
    return Math.round((overdue / pools.length) * 100)
  }, [pools])

  // ─── Revenue chart: revenue grouped by last 6 months ──
  const months = useMemo(() => getLast6Months(), [])
  const revenueByMonth = useMemo(() => {
    const map = {}
    for (const m of months) map[m.key] = 0
    for (const inv of invoices) {
      if (!inv.paid_date) continue
      const d = new Date(inv.paid_date)
      const k = `${d.getFullYear()}-${d.getMonth()}`
      if (k in map) map[k] += Number(inv.total || 0)
    }
    return months.map(m => ({ ...m, value: map[m.key] || 0 }))
  }, [months, invoices])

  const totalRevenue6mo = useMemo(
    () => revenueByMonth.reduce((s, m) => s + m.value, 0),
    [revenueByMonth],
  )
  // Trend: latest month vs prior month
  const revenueTrend = useMemo(() => {
    if (revenueByMonth.length < 2) return null
    const latest = revenueByMonth[revenueByMonth.length - 1].value
    const prior = revenueByMonth[revenueByMonth.length - 2].value
    if (prior === 0) return null
    return Math.round(((latest - prior) / prior) * 100)
  }, [revenueByMonth])

  // ─── Service mix: jobs grouped by job_type_template ──
  const serviceMix = useMemo(() => {
    const counts = {}
    for (const j of jobs) {
      if (j.status !== 'completed') continue
      const id = j.job_type_template_id || 'untyped'
      counts[id] = (counts[id] || 0) + 1
    }
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    if (total === 0) return []
    const entries = Object.entries(counts).map(([id, count]) => {
      const tpl = jobTypes.find(t => t.id === id)
      return {
        id,
        name: tpl?.name || (id === 'untyped' ? 'Other' : 'Service'),
        count,
        pct: Math.round((count / total) * 100),
      }
    })
    return entries.sort((a, b) => b.count - a.count).slice(0, 6)
  }, [jobs, jobTypes])

  // ─── Crew leaderboard ──
  const currentMonthLabel = MONTH_NAMES[new Date().getMonth()]
  const crewLeaderboard = useMemo(() => {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const startStr = startOfMonth.toISOString().slice(0, 10)

    const byStaff = {}
    for (const j of jobs) {
      if (j.status !== 'completed') continue
      if (!j.scheduled_date || j.scheduled_date < startStr) continue
      const sid = j.assigned_staff_id || 'unassigned'
      if (!byStaff[sid]) byStaff[sid] = { jobs: 0, value: 0 }
      byStaff[sid].jobs += 1
      byStaff[sid].value += Number(j.price || 0)
    }
    return staff
      .filter(s => s.name && s.name.trim())
      .map(s => ({
        id: s.id,
        name: s.name,
        role: s.role || 'Tech',
        photo: s.photo_url,
        jobs: byStaff[s.id]?.jobs || 0,
        value: byStaff[s.id]?.value || 0,
      }))
      .sort((a, b) => (b.value - a.value) || (b.jobs - a.jobs))
  }, [jobs, staff])

  function exportCsv() {
    const header = ['Month', 'Revenue']
    const rows = revenueByMonth.map(m => [`${m.label} ${m.year}`, m.value])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `poolmate-revenue-6mo-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const maxRevenue = Math.max(1, ...revenueByMonth.map(m => m.value))
  const trendStr = revenueTrend == null ? '' : `${revenueTrend >= 0 ? '+' : ''}${revenueTrend}%`

  return (
    <>
      {/* Header bar — Settings shell shows the page title "Analytics",
          this row carries the eyebrow + action button only. */}
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" strokeWidth={2.5} />
            Last 6 months · revenue · services · crew
          </p>
        </div>
        <Button leftIcon={Download} variant="secondary" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      {/* KPI strip — 4 pool-relevant metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
        <StatCard
          label="Avg service value"
          value={avgServiceValue}
          format="currency"
          iconTone="brand"
          trendLabel="last month"
        />
        <StatCard
          label="Quote → won"
          value={quoteWinRate == null ? '—' : quoteWinRate}
          suffix={quoteWinRate == null ? '' : '%'}
          iconTone="brand"
          trendLabel={quoteWinRate == null ? 'no decided quotes' : 'all-time'}
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
        {/* Revenue · 6mo */}
        <Card className="md:col-span-2 !p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Revenue · 6mo</p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">
              {formatCurrency(totalRevenue6mo)}
              {trendStr && (
                <span className={cn(
                  'ml-2 text-xs font-semibold',
                  revenueTrend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                )}>{trendStr}</span>
              )}
            </p>
          </div>
          {totalRevenue6mo === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No revenue data yet</p>
          ) : (
            <div className="grid grid-cols-6 gap-3 items-end h-32 mt-6">
              {revenueByMonth.map(m => {
                const heightPct = Math.max(3, Math.round((m.value / maxRevenue) * 100))
                const isLatest = m.key === months[months.length - 1].key
                return (
                  <div key={m.key} className="flex flex-col items-center gap-1.5">
                    {isLatest && m.value > 0 && (
                      <span className="text-[10px] font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                        ${(m.value / 1000).toFixed(1)}k
                      </span>
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
            {revenueByMonth.map(m => (
              <p key={m.key} className="text-[11px] text-center text-gray-500 dark:text-gray-400">{m.label}</p>
            ))}
          </div>
        </Card>

        {/* Service mix */}
        <Card className="!p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 mb-4">Service mix</p>
          {serviceMix.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center">No completed services yet</p>
          ) : (
            <ul className="space-y-3">
              {serviceMix.map((s, i) => (
                <li key={s.id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-900 dark:text-gray-100 truncate">{s.name}</span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">{s.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', MIX_COLORS[i % MIX_COLORS.length])}
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
            {crewLeaderboard.filter(c => c.jobs > 0).length} active
          </span>
        </div>
        {crewLeaderboard.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No staff yet</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {crewLeaderboard.map((c, i) => (
              <li key={c.id} className="px-4 py-3">
                {/* Desktop: 5-column grid */}
                <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_5rem_7rem] gap-3 items-center">
                  <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {c.name}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {c.jobs > 0 ? c.role : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </span>
                  <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300 text-right">
                    {c.jobs} {c.jobs === 1 ? 'job' : 'jobs'}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 text-right">
                    {c.value > 0 ? formatCurrency(c.value) : <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}
                  </span>
                </div>
                {/* Mobile: stacked card-style row */}
                <div className="md:hidden flex items-center gap-3">
                  <span className="tabular-nums text-[11px] font-semibold text-pool-600 dark:text-pool-400 w-6 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {c.name}
                    </p>
                    <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
                      {c.jobs > 0 ? c.role : '—'} · {c.jobs} {c.jobs === 1 ? 'job' : 'jobs'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 shrink-0">
                    {c.value > 0 ? formatCurrency(c.value) : <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
