import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import ActivityPanel, { ActivityBell } from '../components/ui/ActivityPanel'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'

export default function Dashboard() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const location = useLocation()
  const [activityOpen, setActivityOpen] = useState(false)

  const [stats, setStats] = useState({
    servicedThisWeek: 0,
    overduePools: 0,
    activeJobs: 0,
    pendingQuotes: 0,
  })
  const [todaySummary, setTodaySummary] = useState({ overdue: 0, dueToday: 0, completed: 0, total: 0, notes: [] })
  const [recentActivity, setRecentActivity] = useState([])
  const [counts, setCounts] = useState({ clients: 0, pools: 0, services: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!business?.id) return

    async function fetchDashboard() {
      setLoading(true)

      const now = new Date()
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      startOfWeek.setHours(0, 0, 0, 0)

      const endOfToday = new Date(now)
      endOfToday.setHours(23, 59, 59, 999)

      const startOfToday = new Date(now)
      startOfToday.setHours(0, 0, 0, 0)

      const [
        servicedRes,
        overduePoolsRes,
        dueTodayPoolsRes,
        todayJobsRes,
        completedTodayRes,
        jobsRes,
        quotesRes,
        activityRes,
        clientCountRes,
        poolCountRes,
        serviceCountRes,
      ] = await Promise.all([
        supabase
          .from('service_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('serviced_at', startOfWeek.toISOString()),

        // Overdue pools: next_due_at < start of today
        supabase
          .from('pools')
          .select('id, address, access_notes, clients(name)')
          .eq('business_id', business.id)
          .lt('next_due_at', startOfToday.toISOString()),

        // Due today pools: next_due_at between start and end of today
        supabase
          .from('pools')
          .select('id, address, access_notes, clients(name)')
          .eq('business_id', business.id)
          .gte('next_due_at', startOfToday.toISOString())
          .lte('next_due_at', endOfToday.toISOString()),

        // Jobs scheduled today
        supabase
          .from('jobs')
          .select('id, title, notes, scheduled_date, clients(name)')
          .eq('business_id', business.id)
          .eq('scheduled_date', startOfToday.toISOString().split('T')[0])
          .in('status', ['scheduled', 'in_progress']),

        // Services completed today
        supabase
          .from('service_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'completed')
          .gte('completed_at', startOfToday.toISOString())
          .lte('completed_at', endOfToday.toISOString()),

        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .in('status', ['scheduled', 'in_progress']),

        supabase
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'sent'),

        supabase
          .from('service_records')
          .select('id, serviced_at, technician_name, pools(address)')
          .eq('business_id', business.id)
          .eq('status', 'completed')
          .order('serviced_at', { ascending: false })
          .limit(5),

        supabase
          .from('clients')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id),

        supabase
          .from('pools')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id),

        supabase
          .from('service_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id),
      ])

      const overdueCount = overduePoolsRes.data?.length || 0
      const dueTodayCount = (dueTodayPoolsRes.data?.length || 0) + (todayJobsRes.data?.length || 0)
      const completedCount = completedTodayRes.count || 0
      const totalStops = overdueCount + dueTodayCount

      // Collect access notes from overdue + due today pools (max 3)
      const notesItems = []
      for (const pool of [...(overduePoolsRes.data || []), ...(dueTodayPoolsRes.data || [])]) {
        if (pool.access_notes && pool.access_notes.trim()) {
          notesItems.push({ name: pool.clients?.name || 'Client', note: pool.access_notes.trim() })
        }
        if (notesItems.length >= 3) break
      }
      // Also check job notes
      if (notesItems.length < 3) {
        for (const job of (todayJobsRes.data || [])) {
          if (job.notes && job.notes.trim()) {
            notesItems.push({ name: job.clients?.name || job.title || 'Job', note: job.notes.trim() })
          }
          if (notesItems.length >= 3) break
        }
      }

      setStats({
        servicedThisWeek: servicedRes.count || 0,
        overduePools: overdueCount,
        activeJobs: jobsRes.count || 0,
        pendingQuotes: quotesRes.count || 0,
      })

      setCounts({
        clients: clientCountRes.count || 0,
        pools: poolCountRes.count || 0,
        services: serviceCountRes.count || 0,
      })

      setTodaySummary({
        overdue: overdueCount,
        dueToday: dueTodayCount,
        completed: completedCount,
        total: totalStops,
        notes: notesItems,
      })
      setRecentActivity(activityRes.data || [])
      setLoading(false)
    }

    fetchDashboard()
  }, [business?.id, location.key])

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Dashboard" right={<ActivityBell onClick={() => setActivityOpen(true)} />} />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  // Getting Started checklist
  const steps = [
    { label: 'Create your business', done: true, action: null },
    { label: 'Add your first client', done: counts.clients > 0, action: () => navigate('/clients'), actionLabel: 'Add Client' },
    { label: 'Add a pool to a client', done: counts.pools > 0, action: () => navigate('/clients'), actionLabel: 'Add Pool' },
    { label: 'Complete your first service', done: counts.services > 0, action: () => navigate('/route'), actionLabel: 'Start Service' },
  ]
  const allDone = steps.every(s => s.done)
  const completedSteps = steps.filter(s => s.done).length

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <>
      <Header title="Dashboard" right={<ActivityBell onClick={() => setActivityOpen(true)} />} />
      <PageWrapper width="wide">
        {/* Hero Welcome */}
        <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-brand p-5 md:p-8 mb-6 shadow-elevated shadow-pool-500/10">
          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-32 md:w-56 h-32 md:h-56 rounded-full bg-white/10" />
          <div className="absolute -bottom-4 -left-4 w-20 md:w-40 h-20 md:h-40 rounded-full bg-white/5" />

          <div className="relative md:flex md:items-end md:justify-between md:gap-8">
            <div>
              <p className="text-pool-100 text-sm font-medium">{greeting()}</p>
              <h2 className="text-xl md:text-3xl font-bold text-white mt-0.5">
                {business?.name || 'Welcome'}
              </h2>
              <p className="text-pool-200 text-sm md:text-base mt-1">
                {formatDate(new Date())}
              </p>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <button
                onClick={() => navigate('/route')}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-white/15 border border-white/25 hover:bg-white/25 backdrop-blur transition-colors"
              >
                View Schedule
              </button>
              <button
                onClick={() => navigate('/work-orders')}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-pool-700 bg-white hover:bg-pool-50 shadow-md transition-colors"
              >
                Work Orders
              </button>
            </div>
          </div>
        </div>

        {/* Getting Started */}
        {!allDone && (
          <section className="mb-6 animate-fade-in">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">Getting Started</h3>
                <span className="text-xs font-semibold text-pool-600 bg-pool-50 px-2.5 py-0.5 rounded-lg">{completedSteps}/{steps.length}</span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
                <div
                  className="h-2 bg-gradient-brand rounded-full transition-all duration-500"
                  style={{ width: `${(completedSteps / steps.length) * 100}%` }}
                />
              </div>
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold transition-all',
                      step.done
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-gray-100 text-gray-400'
                    )}>
                      {step.done ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className={cn(
                      'text-sm flex-1',
                      step.done ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'
                    )}>
                      {step.label}
                    </span>
                    {!step.done && step.action && (
                      <button
                        onClick={step.action}
                        className="text-xs text-pool-600 font-semibold min-h-tap flex items-center px-2 hover:text-pool-700"
                      >
                        {step.actionLabel}
                        <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          {[
            { label: 'Serviced', value: stats.servicedThisWeek, sub: 'this week', color: 'text-gray-900', to: '/route' },
            { label: 'Overdue', value: stats.overduePools, sub: 'pools', color: stats.overduePools > 0 ? 'text-red-600' : 'text-gray-900', to: '/route' },
            { label: 'Work Orders', value: stats.activeJobs, sub: 'in progress', color: 'text-gray-900', to: '/work-orders' },
            { label: 'Quotes', value: stats.pendingQuotes, sub: 'pending', color: 'text-gray-900', to: '/work-orders?tab=quotes' },
          ].map((stat, i) => (
            <Card key={i} onClick={() => navigate(stat.to)}>
              <p className="section-title mb-1">{stat.label}</p>
              <p className={cn('text-2xl font-bold tracking-tight', stat.color)}>
                {stat.value}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">{stat.sub}</p>
            </Card>
          ))}
        </div>

        <div className="md:grid md:grid-cols-3 md:gap-6">
        <div className="md:col-span-2 md:space-y-6">

        {/* Today's Summary */}
        <section className="mb-6 md:mb-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="section-title">Today's Summary</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
          </div>

          <Card className="space-y-4">
            {/* Progress bar */}
            {todaySummary.total > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  {todaySummary.completed >= todaySummary.total ? (
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      All done!
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-gray-900">
                      {todaySummary.completed} of {todaySummary.total} stops completed
                    </p>
                  )}
                  <span className="text-xs font-semibold text-gray-400">
                    {Math.round((todaySummary.completed / todaySummary.total) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-2.5 rounded-full transition-all duration-700',
                      todaySummary.completed >= todaySummary.total ? 'bg-green-500' : 'bg-gradient-brand'
                    )}
                    style={{ width: `${Math.min((todaySummary.completed / todaySummary.total) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 py-1">
                <svg className="w-5 h-5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-500">No stops scheduled for today</p>
              </div>
            )}

            {/* Stat pills */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => navigate('/route')}
                className={cn(
                  'rounded-xl py-2.5 text-center transition-colors',
                  todaySummary.overdue > 0 ? 'bg-red-50 hover:bg-red-100' : 'bg-gray-50 hover:bg-gray-100'
                )}
              >
                <p className={cn('text-lg font-bold', todaySummary.overdue > 0 ? 'text-red-600' : 'text-gray-400')}>
                  {todaySummary.overdue}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Overdue</p>
              </button>
              <button
                onClick={() => navigate('/route')}
                className="rounded-xl py-2.5 text-center bg-pool-50 hover:bg-pool-100 transition-colors"
              >
                <p className="text-lg font-bold text-pool-600">{todaySummary.dueToday}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Due Today</p>
              </button>
              <button
                onClick={() => navigate('/route')}
                className={cn(
                  'rounded-xl py-2.5 text-center transition-colors',
                  todaySummary.completed > 0 ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
                )}
              >
                <p className={cn('text-lg font-bold', todaySummary.completed > 0 ? 'text-green-600' : 'text-gray-400')}>
                  {todaySummary.completed}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Completed</p>
              </button>
            </div>

            {/* Notes & Alerts */}
            {todaySummary.notes.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Notes & Alerts</p>
                <div className="space-y-2">
                  {todaySummary.notes.map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-semibold text-gray-900">{item.name}</span>
                        <span className="text-gray-400 mx-1">—</span>
                        {item.note}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* View Full Schedule link */}
            <button
              onClick={() => navigate('/route')}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-pool-600 hover:text-pool-700 pt-1 min-h-tap transition-colors"
            >
              View Full Schedule
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </Card>
        </section>

        </div>
        <div className="md:col-span-1">
        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <section className="mb-6 md:mb-0">
            <h3 className="section-title mb-3">Recent Activity</h3>
            <Card className="p-0 overflow-hidden divide-y divide-gray-100">
              {recentActivity.map((record, i) => (
                <div key={record.id} className="px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {record.pools?.address || 'Pool'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {record.technician_name && `${record.technician_name} · `}
                      {formatDate(record.serviced_at)}
                    </p>
                  </div>
                  <Badge variant="success" className="shrink-0">Serviced</Badge>
                </div>
              ))}
            </Card>
          </section>
        )}
        </div>
        </div>
      </PageWrapper>
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </>
  )
}
