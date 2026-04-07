import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, daysOverdue, getOverdueStatus } from '../lib/utils'

export default function Dashboard() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()

  const [stats, setStats] = useState({
    servicedThisWeek: 0,
    overduePools: 0,
    activeJobs: 0,
    pendingQuotes: 0,
  })
  const [overduePools, setOverduePools] = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!business?.id) return

    async function fetchDashboard() {
      setLoading(true)

      const now = new Date()
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      startOfWeek.setHours(0, 0, 0, 0)

      const [
        servicedRes,
        overdueRes,
        jobsRes,
        quotesRes,
        activityRes,
      ] = await Promise.all([
        // Pools serviced this week
        supabase
          .from('service_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('serviced_at', startOfWeek.toISOString()),

        // Overdue pools (next_due_at in the past)
        supabase
          .from('pools')
          .select('id, name, address, next_due_at, clients(name)')
          .eq('business_id', business.id)
          .lt('next_due_at', now.toISOString())
          .order('next_due_at', { ascending: true }),

        // Active jobs
        supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'active'),

        // Pending quotes
        supabase
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'pending'),

        // Recent activity - last 5 service records
        supabase
          .from('service_records')
          .select('id, serviced_at, technician, pools(name)')
          .eq('business_id', business.id)
          .order('serviced_at', { ascending: false })
          .limit(5),
      ])

      setStats({
        servicedThisWeek: servicedRes.count || 0,
        overduePools: overdueRes.data?.length || 0,
        activeJobs: jobsRes.count || 0,
        pendingQuotes: quotesRes.count || 0,
      })

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

        {/* Stat cards 2x2 */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Serviced this week</p>
            <p className="text-2xl font-bold text-pool-600 mt-1">
              {stats.servicedThisWeek}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Overdue</p>
            <p className={`text-2xl font-bold mt-1 ${stats.overduePools > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {stats.overduePools}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Active jobs</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {stats.activeJobs}
            </p>
          </Card>

          <Card className="p-4">
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
                        {pool.address || pool.name}
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
                      {record.pools?.name || 'Pool'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {record.technician && `${record.technician} · `}
                      {formatDate(record.serviced_at)}
                    </p>
                  </div>
                  <Badge variant="success" className="ml-3 shrink-0">Serviced</Badge>
                </div>
              ))}
            </Card>
          </section>
        )}

        {/* Empty state when nothing is overdue and no activity */}
        {overduePools.length === 0 && recentActivity.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No activity yet. Start by adding clients and pools.</p>
          </div>
        )}
      </PageWrapper>
    </>
  )
}
