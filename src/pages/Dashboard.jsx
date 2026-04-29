import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import StatCard from '../components/ui/StatCard'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'
import {
  Calendar, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronRight,
  Sparkles, AlertTriangle, Briefcase, Activity, ArrowRight,
} from 'lucide-react'

export default function Dashboard() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const location = useLocation()

  const [stats, setStats] = useState({
    scheduledThisWeek: 0,
    servicedThisWeek: 0,
    overduePools: 0,
    workOrdersInProgress: 0,
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

      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      endOfWeek.setHours(23, 59, 59, 999)

      const endOfToday = new Date(now)
      endOfToday.setHours(23, 59, 59, 999)

      const startOfToday = new Date(now)
      startOfToday.setHours(0, 0, 0, 0)

      const ymd = (d) => d.toISOString().split('T')[0]

      const [
        servicedRes,
        scheduledPoolsThisWeekRes,
        scheduledJobsThisWeekRes,
        overduePoolsRes,
        dueTodayPoolsRes,
        todayJobsRes,
        completedTodayRes,
        workOrdersInProgressRes,
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

        // Pool services scheduled this week — next_due_at within week window
        supabase
          .from('pools')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('next_due_at', startOfWeek.toISOString())
          .lte('next_due_at', endOfWeek.toISOString()),

        // Jobs scheduled this week — scheduled_date within week window
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('scheduled_date', ymd(startOfWeek))
          .lte('scheduled_date', ymd(endOfWeek)),

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
          .eq('scheduled_date', ymd(startOfToday))
          .in('status', ['scheduled', 'in_progress']),

        // Services completed today
        supabase
          .from('service_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'completed')
          .gte('completed_at', startOfToday.toISOString())
          .lte('completed_at', endOfToday.toISOString()),

        // Work orders strictly in progress
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'in_progress'),

        supabase
          .from('service_records')
          .select('id, serviced_at, technician_name, pool_id, pools(address)')
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
        scheduledThisWeek: (scheduledPoolsThisWeekRes.count || 0) + (scheduledJobsThisWeekRes.count || 0),
        servicedThisWeek: servicedRes.count || 0,
        overduePools: overdueCount,
        workOrdersInProgress: workOrdersInProgressRes.count || 0,
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
      <PageWrapper>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  // Getting Started checklist
  const steps = [
    { label: 'Create your business', done: true, action: null },
    { label: 'Add your first client', done: counts.clients > 0, action: () => navigate('/clients'), actionLabel: 'Add Client' },
    { label: 'Add a pool to a client', done: counts.pools > 0, action: () => navigate('/clients'), actionLabel: 'Add Pool' },
    { label: 'Complete your first service', done: counts.services > 0, action: () => navigate('/schedule'), actionLabel: 'Start Service' },
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
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            {greeting()}
          </span>
        }
        title={business?.name || 'Welcome'}
        subtitle={formatDate(new Date())}
      />

        {/* Getting Started */}
        {!allDone && (
          <section className="mb-6 animate-fade-in">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Getting Started</h3>
                <span className="text-xs font-semibold text-pool-600 dark:text-pool-400 bg-pool-50 dark:bg-pool-950/40 px-2.5 py-0.5 rounded-lg">{completedSteps}/{steps.length}</span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full mb-4 overflow-hidden">
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
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                    )}>
                      {step.done ? (
                        <Check className="w-4 h-4" strokeWidth={2.5} />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className={cn(
                      'text-sm flex-1',
                      step.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-100 font-medium'
                    )}>
                      {step.label}
                    </span>
                    {!step.done && step.action && (
                      <button
                        onClick={step.action}
                        className="text-xs text-pool-600 dark:text-pool-400 font-semibold min-h-tap flex items-center px-2 hover:text-pool-700"
                      >
                        {step.actionLabel}
                        <ChevronRight className="w-3 h-3 ml-1" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* KPI strip — AWC StatCards with right-side icon-boxes */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <StatCard
            label="Scheduled"
            value={stats.scheduledThisWeek}
            icon={CalendarDays}
            iconTone="brand"
            trendLabel="this week"
            onClick={() => navigate('/schedule')}
          />
          <StatCard
            label="Serviced"
            value={stats.servicedThisWeek}
            icon={CheckCircle2}
            iconTone="brand"
            trendLabel="this week"
            onClick={() => navigate('/schedule')}
          />
          <StatCard
            label="Services Overdue"
            value={stats.overduePools}
            icon={AlertTriangle}
            iconTone={stats.overduePools > 0 ? 'red' : 'gray'}
            trendLabel="this week"
            onClick={() => navigate('/schedule')}
          />
          <StatCard
            label="Work Orders"
            value={stats.workOrdersInProgress}
            icon={Briefcase}
            iconTone="brand"
            trendLabel="in progress"
            onClick={() => navigate('/work-orders')}
          />
        </div>

        {/* TODAY (compact list) + RECENT ACTIVITY (feed) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* TODAY — narrow column */}
          <Card className="md:col-span-1 !p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <CalendarClock className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" strokeWidth={2.5} />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Today</p>
            </div>
            <ul className="space-y-3 flex-1">
              <li className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">Scheduled</span>
                <span className="inline-flex items-center justify-center min-w-[28px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                  {todaySummary.dueToday}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">Completed</span>
                <span className="inline-flex items-center justify-center min-w-[28px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                  {todaySummary.completed}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">Overdue</span>
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[28px] px-2 h-6 rounded-full text-xs font-semibold tabular-nums',
                  todaySummary.overdue > 0
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                )}>
                  {todaySummary.overdue}
                </span>
              </li>
            </ul>
            <button
              onClick={() => navigate('/schedule')}
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300 transition-colors group self-start"
            >
              Open schedule
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </button>
          </Card>

          {/* RECENT ACTIVITY — wide column */}
          <Card className="md:col-span-2 !p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" strokeWidth={2.5} />
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Recent Activity</p>
                {recentActivity.length > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pool-500 text-white text-[10px] font-bold tabular-nums">
                    {recentActivity.length}
                  </span>
                )}
              </div>
            </div>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 py-4 flex-1">No recent activity yet.</p>
            ) : (
              <ul className="space-y-1 flex-1 -mx-2">
                {recentActivity.map(record => (
                  <li key={record.id}>
                    <button
                      onClick={() => navigate(record.id ? `/services/${record.id}` : `/pools/${record.pool_id}`)}
                      className="w-full text-left flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-pool-500 mt-2 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-pool-700 dark:group-hover:text-pool-300 transition-colors">
                          {record.pools?.address || 'Pool'} serviced
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {record.technician_name && `${record.technician_name} · `}
                          {formatDate(record.serviced_at)}
                        </p>
                      </div>
                      <Badge variant="success" className="shrink-0 mt-0.5">Service</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
    </PageWrapper>
  )
}
