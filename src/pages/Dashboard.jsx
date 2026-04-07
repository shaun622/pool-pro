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

  // Getting Started checklist - show when setup is incomplete
  const steps = [
    { label: 'Create your business', done: true, action: null },
    { label: 'Add your first client', done: counts.clients > 0, action: () => navigate('/clients'), actionLabel: 'Add Client' },
    { label: 'Add a pool to a client', done: counts.pools > 0, action: () => navigate('/clients'), actionLabel: 'Add Pool' },
    { label: 'Complete your first service', done: counts.services > 0, action: () => navigate('/route'), actionLabel: 'Start Service' },
  ]
  const allDone = steps.every(s => s.done)
  const completedSteps = steps.filter(s => s.done).length

  return (
    <>
      <Header title="Dashboard" />
      <PageWrapper>
        {/* Welcome */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-900">
            {business?.name || 'Welcome'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatDate(new Date())}
          </p>
        </div>

        {/* Getting Started - show until all steps complete */}
        {!allDone && (
          <section className="mb-6">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Getting Started</h3>
                <span className="text-xs text-gray-500">{completedSteps}/{steps.length}</span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 bg-gray-100 rounded-full mb-4">
                <div
                  className="h-2 bg-pool-500 rounded-full transition-all"
                  style={{ width: `${(completedSteps / steps.length) * 100}%` }}
                />
              </div>
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-medium',
                      step.done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                    )}>
                      {step.done ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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
                        className="text-xs text-pool-500 font-medium min-h-tap flex items-center px-2"
                      >
                        {step.actionLabel}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Quick Service Section */}
        {todayPools.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Ready to Service
              </h3>
              <button
                onClick={() => navigate('/route')}
                className="text-xs text-pool-500 font-medium min-h-tap flex items-center"
              >
                View all
              </button>
            </div>
            <div className="space-y-2">
              {todayPools.map(pool => {
                const days = daysOverdue(pool.next_due_at)
                const isOverdue = days > 0
                return (
                  <Card key={pool.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', isOverdue ? 'bg-red-500' : 'bg-green-500')} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{pool.clients?.name}</p>
                        <p className="text-xs text-gray-500 truncate">{pool.address}</p>
                      </div>
                      <Button
                        className="text-xs px-3 py-2 min-h-[36px]"
                        onClick={() => navigate(`/pools/${pool.id}/service`)}
                      >
                        Service
                      </Button>
                    </div>
                    {isOverdue && (
                      <p className="text-xs text-red-600 font-medium ml-5 mt-1">{days}d overdue</p>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {/* Stat cards 2x2 */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="p-4" onClick={() => navigate('/route')}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Serviced this week</p>
            <p className="text-2xl font-bold text-pool-600 mt-1">
              {stats.servicedThisWeek}
            </p>
          </Card>

          <Card className="p-4" onClick={() => navigate('/route')}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Overdue</p>
            <p className={`text-2xl font-bold mt-1 ${stats.overduePools > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {stats.overduePools}
            </p>
          </Card>

          <Card className="p-4" onClick={() => navigate('/jobs')}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Active jobs</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {stats.activeJobs}
            </p>
          </Card>

          <Card className="p-4" onClick={() => navigate('/jobs')}>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Pending quotes</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {stats.pendingQuotes}
            </p>
          </Card>
        </div>

        {/* Overdue Pools */}
        {overduePools.length > 0 && (
          <section className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Overdue Pools
            </h3>
            <div className="space-y-2">
              {overduePools.map((pool) => {
                const days = daysOverdue(pool.next_due_at)
                const status = getOverdueStatus(pool.next_due_at)
                const badgeVariant = status === 'red' ? 'danger' : 'warning'

                return (
                  <Card
                    key={pool.id}
                    onClick={() => navigate(`/pools/${pool.id}`)}
                    className="flex items-center justify-between p-4 min-h-tap"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        {pool.clients?.name}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
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
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Recent Activity
            </h3>
            <Card className="divide-y divide-gray-100">
              {recentActivity.map((record) => (
                <div key={record.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {record.pools?.address || 'Pool'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {record.technician_name && `${record.technician_name} · `}
                      {formatDate(record.serviced_at)}
                    </p>
                  </div>
                  <Badge variant="success" className="ml-3 shrink-0">Serviced</Badge>
                </div>
              ))}
            </Card>
          </section>
        )}
      </PageWrapper>
    </>
  )
}
