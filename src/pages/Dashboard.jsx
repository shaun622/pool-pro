import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, daysOverdue, getOverdueStatus, cn } from '../lib/utils'

export default function Dashboard() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()

  const [stats, setStats] = useState({
    servicedThisWeek: 0,
    overduePools: 0,
    activeJobs: 0,
    pendingQuotes: 0,
  })
  const [todayPools, setTodayPools] = useState([])
  const [overduePools, setOverduePools] = useState([])
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

      const [
        servicedRes,
        dueTodayRes,
        overdueRes,
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

        supabase
          .from('pools')
          .select('id, address, type, next_due_at, last_serviced_at, schedule_frequency, clients(name)')
          .eq('business_id', business.id)
          .lte('next_due_at', endOfToday.toISOString())
          .order('next_due_at', { ascending: true })
          .limit(5),

        supabase
          .from('pools')
          .select('id, address, next_due_at, clients(name)')
          .eq('business_id', business.id)
          .lt('next_due_at', now.toISOString())
          .order('next_due_at', { ascending: true }),

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

        // Total counts for getting started
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

      setStats({
        servicedThisWeek: servicedRes.count || 0,
        overduePools: overdueRes.data?.length || 0,
        activeJobs: jobsRes.count || 0,
        pendingQuotes: quotesRes.count || 0,
      })

      setCounts({
        clients: clientCountRes.count || 0,
        pools: poolCountRes.count || 0,
        services: serviceCountRes.count || 0,
      })

      setTodayPools(dueTodayRes.data || [])
      setOverduePools(overdueRes.data || [])
      setRecentActivity(activityRes.data || [])
      setLoading(false)
    }

    fetchDashboard()
  }, [business?.id])

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Dashboard" />
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
      <Header title="Dashboard" />
      <PageWrapper>
        {/* Hero Welcome */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-brand p-5 mb-6 shadow-elevated shadow-pool-500/10">
          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />

          <div className="relative">
            <p className="text-pool-100 text-sm font-medium">{greeting()}</p>
            <h2 className="text-xl font-bold text-white mt-0.5">
              {business?.name || 'Welcome'}
            </h2>
            <p className="text-pool-200 text-sm mt-1">
              {formatDate(new Date())}
            </p>
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
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: 'Serviced', value: stats.servicedThisWeek, sub: 'this week', color: 'text-gray-900', to: '/route' },
            { label: 'Overdue', value: stats.overduePools, sub: 'pools', color: stats.overduePools > 0 ? 'text-red-600' : 'text-gray-900', to: '/route' },
            { label: 'Active Jobs', value: stats.activeJobs, sub: 'in progress', color: 'text-gray-900', to: '/jobs' },
            { label: 'Quotes', value: stats.pendingQuotes, sub: 'pending', color: 'text-gray-900', to: '/jobs' },
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

        {/* Ready to Service */}
        {todayPools.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title">Ready to Service</h3>
              <button
                onClick={() => navigate('/route')}
                className="text-xs text-pool-600 font-semibold min-h-tap flex items-center hover:text-pool-700"
              >
                View all
                <svg className="w-3.5 h-3.5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="space-y-2.5">
              {todayPools.map(pool => {
                const days = daysOverdue(pool.next_due_at)
                const isOverdue = days > 0
                return (
                  <Card key={pool.id} className="p-3.5">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                        isOverdue ? 'bg-red-50' : 'bg-emerald-50'
                      )}>
                        <div className={cn('w-2.5 h-2.5 rounded-full', isOverdue ? 'bg-red-500' : 'bg-emerald-500')} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{pool.clients?.name}</p>
                        <p className="text-xs text-gray-500 truncate">{pool.address}</p>
                        {isOverdue && (
                          <p className="text-[11px] text-red-500 font-semibold mt-0.5">{days}d overdue</p>
                        )}
                      </div>
                      <Button
                        className="text-xs px-4 py-2 min-h-[36px] rounded-xl shadow-sm"
                        onClick={() => navigate(`/pools/${pool.id}/service`)}
                      >
                        Service
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {/* Overdue Pools */}
        {overduePools.length > 0 && (
          <section className="mb-6">
            <h3 className="section-title mb-3">Overdue Pools</h3>
            <div className="space-y-2.5">
              {overduePools.map((pool) => {
                const days = daysOverdue(pool.next_due_at)
                const status = getOverdueStatus(pool.next_due_at)
                const badgeVariant = status === 'red' ? 'danger' : 'warning'

                return (
                  <Card
                    key={pool.id}
                    onClick={() => navigate(`/pools/${pool.id}`)}
                    className="flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900 truncate text-sm">
                        {pool.clients?.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {pool.address}
                      </p>
                    </div>
                    <Badge variant={badgeVariant} className="ml-3 shrink-0">
                      {days}d overdue
                    </Badge>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <section className="mb-6">
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
      </PageWrapper>
    </>
  )
}
