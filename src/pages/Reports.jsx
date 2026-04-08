import { useState, useEffect, useMemo } from 'react'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'

const DATE_RANGES = [
  { label: 'This Week', value: 'week' },
  { label: 'This Month', value: 'month' },
  { label: 'This Quarter', value: 'quarter' },
  { label: 'This Year', value: 'year' },
  { label: 'All Time', value: 'all' },
]

const PIE_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

function getDateRange(range) {
  const now = new Date()
  let start

  switch (range) {
    case 'week': {
      start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    }
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start = new Date(now.getFullYear(), qMonth, 1)
      break
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1)
      break
    }
    default:
      start = null
  }

  return start ? start.toISOString() : null
}

function KPICard({ label, value, subtext, gradient }) {
  return (
    <div className={cn('rounded-2xl p-4 text-white shadow-lg', gradient)}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtext && <p className="text-xs mt-1 opacity-70">{subtext}</p>}
    </div>
  )
}

export default function Reports() {
  const { business } = useBusiness()
  const [dateRange, setDateRange] = useState('month')
  const [loading, setLoading] = useState(true)

  // Data state
  const [revenue, setRevenue] = useState(0)
  const [jobsCompleted, setJobsCompleted] = useState(0)
  const [avgRating, setAvgRating] = useState(0)
  const [activeClients, setActiveClients] = useState(0)
  const [revenueByMonth, setRevenueByMonth] = useState([])
  const [jobsByStatus, setJobsByStatus] = useState([])
  const [chemicalUsage, setChemicalUsage] = useState([])
  const [staffPerformance, setStaffPerformance] = useState([])

  const rangeStart = useMemo(() => getDateRange(dateRange), [dateRange])

  useEffect(() => {
    if (!business?.id) return
    fetchReportData()
  }, [business?.id, rangeStart])

  async function fetchReportData() {
    setLoading(true)

    try {
      // Build base queries with optional date filter
      const dateFilter = (query, col = 'created_at') => {
        if (rangeStart) return query.gte(col, rangeStart)
        return query
      }

      // 1. Revenue from paid invoices
      const revenueQuery = dateFilter(
        supabase
          .from('invoices')
          .select('total, paid_date, status')
          .eq('business_id', business.id)
          .eq('status', 'paid'),
        'paid_date'
      )

      // 2. Jobs / service records
      const jobsQuery = dateFilter(
        supabase
          .from('service_records')
          .select('id, created_at, assigned_to')
          .eq('business_id', business.id)
      )

      // 3. Survey ratings
      const ratingsQuery = dateFilter(
        supabase
          .from('surveys')
          .select('rating')
          .eq('business_id', business.id)
          .not('rating', 'is', null)
      )

      // 4. Active clients (clients with services in range)
      const clientsQuery = dateFilter(
        supabase
          .from('service_records')
          .select('pool_id, pools!inner(client_id)')
          .eq('business_id', business.id)
      )

      // 5. All invoices for revenue chart (always full year)
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
      const chartQuery = supabase
        .from('invoices')
        .select('total, paid_date')
        .eq('business_id', business.id)
        .eq('status', 'paid')
        .gte('paid_date', yearStart)

      // 6. Jobs by status
      const statusQuery = supabase
        .from('jobs')
        .select('status')
        .eq('business_id', business.id)

      // 7. Chemicals added
      const chemQuery = dateFilter(
        supabase
          .from('chemicals_added')
          .select('chemical_name, quantity')
          .eq('business_id', business.id)
      )

      // 8. Staff members for performance
      const staffQuery = supabase
        .from('staff_members')
        .select('id, name')
        .eq('business_id', business.id)

      const [
        revenueRes, jobsRes, ratingsRes, clientsRes,
        chartRes, statusRes, chemRes, staffRes,
      ] = await Promise.all([
        revenueQuery, jobsQuery, ratingsQuery, clientsRes,
        chartQuery, statusQuery, chemQuery, staffQuery,
      ].map(q => q.then ? q : q))

      // Process revenue
      const revenueData = revenueRes.data || []
      setRevenue(revenueData.reduce((sum, inv) => sum + (inv.total || 0), 0))

      // Process jobs
      const jobsData = jobsRes.data || []
      setJobsCompleted(jobsData.length)

      // Process ratings
      const ratingsData = ratingsRes.data || []
      if (ratingsData.length > 0) {
        const avg = ratingsData.reduce((sum, s) => sum + s.rating, 0) / ratingsData.length
        setAvgRating(Math.round(avg * 10) / 10)
      } else {
        setAvgRating(0)
      }

      // Process active clients
      const clientData = clientsRes?.data || []
      const uniqueClients = new Set(clientData.map(r => r.pools?.client_id).filter(Boolean))
      setActiveClients(uniqueClients.size)

      // Process revenue by month chart
      const chartData = chartRes.data || []
      const monthlyRevenue = {}
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      monthNames.forEach(m => { monthlyRevenue[m] = 0 })
      chartData.forEach(inv => {
        if (inv.paid_date) {
          const d = new Date(inv.paid_date)
          const month = monthNames[d.getMonth()]
          monthlyRevenue[month] += inv.total || 0
        }
      })
      setRevenueByMonth(monthNames.map(name => ({ name, revenue: monthlyRevenue[name] })))

      // Process jobs by status
      const statusData = statusRes.data || []
      const statusCounts = {}
      statusData.forEach(j => {
        statusCounts[j.status] = (statusCounts[j.status] || 0) + 1
      })
      setJobsByStatus(
        Object.entries(statusCounts).map(([name, value]) => ({ name, value }))
      )

      // Process chemical usage
      const chemData = chemRes.data || []
      const chemCounts = {}
      chemData.forEach(c => {
        const name = c.chemical_name || 'Unknown'
        chemCounts[name] = (chemCounts[name] || 0) + (c.quantity || 1)
      })
      const sortedChems = Object.entries(chemCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }))
      setChemicalUsage(sortedChems)

      // Process staff performance
      const staffData = staffRes.data || []
      const staffJobCounts = {}
      jobsData.forEach(j => {
        if (j.assigned_to) {
          staffJobCounts[j.assigned_to] = (staffJobCounts[j.assigned_to] || 0) + 1
        }
      })
      setStaffPerformance(
        staffData.map(s => ({
          name: s.name,
          jobs: staffJobCounts[s.id] || 0,
        })).sort((a, b) => b.jobs - a.jobs)
      )
    } catch (err) {
      console.error('Error fetching report data:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Header title="Reports" />
      <PageWrapper>
        {/* Date range selector */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          {DATE_RANGES.map(range => (
            <button
              key={range.value}
              onClick={() => setDateRange(range.value)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-tap',
                dateRange === range.value
                  ? 'bg-pool-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              )}
            >
              {range.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <KPICard
                label="Total Revenue"
                value={formatCurrency(revenue)}
                gradient="bg-gradient-to-br from-pool-500 to-pool-700"
              />
              <KPICard
                label="Jobs Completed"
                value={jobsCompleted}
                gradient="bg-gradient-to-br from-emerald-500 to-emerald-700"
              />
              <KPICard
                label="Avg Rating"
                value={avgRating > 0 ? `${avgRating} / 5` : 'N/A'}
                gradient="bg-gradient-to-br from-amber-500 to-orange-600"
              />
              <KPICard
                label="Active Clients"
                value={activeClients}
                gradient="bg-gradient-to-br from-violet-500 to-purple-700"
              />
            </div>

            {/* Revenue Chart */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Revenue (This Year)
              </h3>
              {revenueByMonth.some(d => d.revenue > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={revenueByMonth}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={v => `$${v}`} />
                    <Tooltip
                      formatter={(value) => [formatCurrency(value), 'Revenue']}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      fill="url(#revenueGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No revenue data yet</p>
              )}
            </Card>

            {/* Jobs by Status */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Jobs by Status
              </h3>
              {jobsByStatus.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={jobsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {jobsByStatus.map((_, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No job data yet</p>
              )}
              {jobsByStatus.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-2 justify-center">
                  {jobsByStatus.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="capitalize">{entry.name}</span>
                      <span className="font-semibold">({entry.value})</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Chemical Usage */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Top Chemicals Used
              </h3>
              {chemicalUsage.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(180, chemicalUsage.length * 36)}>
                  <BarChart data={chemicalUsage} layout="vertical" margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      stroke="#9ca3af"
                      width={100}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No chemical data yet</p>
              )}
            </Card>

            {/* Staff Performance */}
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Staff Performance
              </h3>
              {staffPerformance.length > 0 ? (
                <div className="space-y-3">
                  {staffPerformance.map((staff, index) => {
                    const maxJobs = staffPerformance[0]?.jobs || 1
                    const pct = Math.round((staff.jobs / maxJobs) * 100)
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-medium text-gray-700">{staff.name}</span>
                          <span className="text-sm text-gray-500">{staff.jobs} jobs</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-gradient-brand h-2 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No staff data yet</p>
              )}
            </Card>
          </div>
        )}
      </PageWrapper>
    </>
  )
}
