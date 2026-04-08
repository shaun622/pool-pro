import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, daysOverdue, FREQUENCY_LABELS, cn } from '../lib/utils'

// ─── ROUTE TAB ─────────────────────────────────────
function RouteTab({ business }) {
  const navigate = useNavigate()
  const [pools, setPools] = useState([])
  const [allPools, setAllPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('due')

  useEffect(() => {
    if (!business?.id) return
    async function fetch() {
      setLoading(true)
      const endOfToday = new Date()
      endOfToday.setHours(23, 59, 59, 999)
      const [dueRes, allRes] = await Promise.all([
        supabase.from('pools').select('*, clients(name, email, phone)')
          .eq('business_id', business.id).lte('next_due_at', endOfToday.toISOString())
          .order('route_order', { ascending: true }),
        supabase.from('pools').select('*, clients(name, email, phone)')
          .eq('business_id', business.id).order('route_order', { ascending: true }),
      ])
      setPools(dueRes.data || [])
      setAllPools(allRes.data || [])
      setLoading(false)
    }
    fetch()
  }, [business?.id])

  if (loading) return <LoadingSpinner />

  const displayPools = filter === 'due' ? pools : allPools

  return (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">{formatDate(new Date())}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{pools.length} pool{pools.length !== 1 ? 's' : ''} due today</p>
      </div>

      <div className="flex gap-2 mb-5">
        {[
          { key: 'due', label: `Due Today (${pools.length})` },
          { key: 'all', label: `All Pools (${allPools.length})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn('px-4 py-2 rounded-xl text-sm font-semibold min-h-tap transition-all duration-200',
              filter === f.key ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
            {f.label}
          </button>
        ))}
      </div>

      {displayPools.length === 0 ? (
        <EmptyState
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
          title={filter === 'due' ? 'No pools due today' : 'No pools yet'}
          description={filter === 'due' ? 'All pools are up to date!' : 'Add clients and pools to get started.'}
        />
      ) : (
        <div className="space-y-3">
          {displayPools.map((pool, idx) => {
            const days = daysOverdue(pool.next_due_at)
            const isOverdue = days > 0
            const isDueToday = pool.next_due_at && !isOverdue && new Date(pool.next_due_at) <= new Date(new Date().setHours(23,59,59,999))
            return (
              <Card key={pool.id} className="overflow-hidden animate-slide-up" style={{ animationDelay: `${idx * 50}ms` }}>
                <div className="flex items-start gap-3.5 cursor-pointer" onClick={() => navigate(`/pools/${pool.id}`)}>
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                    isOverdue ? 'bg-red-50' : isDueToday ? 'bg-amber-50' : 'bg-emerald-50')}>
                    <div className={cn('w-3 h-3 rounded-full', isOverdue ? 'bg-red-500' : isDueToday ? 'bg-amber-500' : 'bg-emerald-500')} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-900 truncate">{pool.clients?.name}</p>
                      <Badge variant={pool.type || 'default'} className="shrink-0">{pool.type}</Badge>
                    </div>
                    <p className="text-sm text-gray-500 truncate">{pool.address}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {pool.schedule_frequency && <span className="text-xs text-gray-400">{FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}</span>}
                      {pool.last_serviced_at && <span className="text-xs text-gray-400">Last: {formatDate(pool.last_serviced_at)}</span>}
                      {isOverdue && <span className="text-xs font-semibold text-red-500">{days}d overdue</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-3.5 pt-3 border-t border-gray-100">
                  <Button variant="primary" className="w-full min-h-tap" onClick={(e) => { e.stopPropagation(); navigate(`/pools/${pool.id}/service`) }}>
                    Start Service
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

// ─── CALENDAR TAB ──────────────────────────────────
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function CalendarTab({ business }) {
  const navigate = useNavigate()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [jobs, setJobs] = useState([])
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('month') // 'month' | 'week'

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  useEffect(() => {
    if (!business?.id) return
    async function fetch() {
      setLoading(true)
      // Get start/end of visible range (month with padding)
      const start = new Date(year, month, 1)
      start.setDate(start.getDate() - start.getDay() + 1) // Monday
      const end = new Date(year, month + 1, 0)
      end.setDate(end.getDate() + (7 - end.getDay()))

      const [jobsRes, poolsRes] = await Promise.all([
        supabase.from('jobs').select('*, clients(name), pools(address)')
          .eq('business_id', business.id)
          .gte('scheduled_date', start.toISOString().split('T')[0])
          .lte('scheduled_date', end.toISOString().split('T')[0])
          .order('scheduled_date'),
        supabase.from('pools').select('id, address, next_due_at, schedule_frequency, clients(name)')
          .eq('business_id', business.id)
          .gte('next_due_at', start.toISOString())
          .lte('next_due_at', end.toISOString()),
      ])
      setJobs(jobsRes.data || [])
      setPools(poolsRes.data || [])
      setLoading(false)
    }
    fetch()
  }, [business?.id, year, month])

  function prevMonth() { setCurrentDate(new Date(year, month - 1, 1)) }
  function nextMonth() { setCurrentDate(new Date(year, month + 1, 1)) }

  // Build calendar grid
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7 // Monday = 0
  const totalDays = lastDay.getDate()
  const weeks = []
  let week = []
  for (let i = 0; i < startOffset; i++) week.push(null)
  for (let d = 1; d <= totalDays; d++) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week) }

  // Events for a given date
  function getEvents(day) {
    if (!day) return []
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dateObj = new Date(year, month, day)
    const dayJobs = jobs.filter(j => j.scheduled_date === dateStr)
    const dayPools = pools.filter(p => {
      if (!p.next_due_at) return false
      const due = new Date(p.next_due_at)
      return due.getFullYear() === year && due.getMonth() === month && due.getDate() === day
    })
    return [
      ...dayJobs.map(j => ({ type: 'job', label: j.clients?.name || j.title, status: j.status, id: j.id })),
      ...dayPools.map(p => ({ type: 'pool', label: p.clients?.name || p.address, id: p.id })),
    ]
  }

  const today = new Date()
  const isToday = (d) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
  const isSelected = (d) => d && selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === d

  const selectedEvents = getEvents(selectedDate.getMonth() === month && selectedDate.getFullYear() === year ? selectedDate.getDate() : null)

  const JOB_STATUS_COLORS = {
    scheduled: 'bg-blue-500', in_progress: 'bg-amber-500', completed: 'bg-green-500', on_hold: 'bg-gray-400',
  }

  return (
    <>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-gray-900">{MONTH_NAMES[month]} {year}</h2>
        <button onClick={nextMonth} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-gray-400 uppercase py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden mb-4">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
            {week.map((day, di) => {
              const events = getEvents(day)
              return (
                <button
                  key={di}
                  disabled={!day}
                  onClick={() => day && setSelectedDate(new Date(year, month, day))}
                  className={cn(
                    'relative flex flex-col items-center py-2 min-h-[52px] transition-all',
                    day ? 'hover:bg-pool-50/50 cursor-pointer' : 'cursor-default',
                    isSelected(day) && 'bg-pool-50',
                    isToday(day) && !isSelected(day) && 'bg-amber-50/50',
                  )}
                >
                  {day && (
                    <>
                      <span className={cn(
                        'text-sm w-7 h-7 flex items-center justify-center rounded-full',
                        isToday(day) ? 'bg-pool-500 text-white font-bold' :
                        isSelected(day) ? 'bg-pool-100 text-pool-700 font-bold' :
                        'text-gray-700'
                      )}>
                        {day}
                      </span>
                      {events.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {events.slice(0, 3).map((e, i) => (
                            <div key={i} className={cn('w-1.5 h-1.5 rounded-full',
                              e.type === 'job' ? (JOB_STATUS_COLORS[e.status] || 'bg-blue-500') : 'bg-pool-400')} />
                          ))}
                          {events.length > 3 && <span className="text-[8px] text-gray-400">+{events.length - 3}</span>}
                        </div>
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Selected day events */}
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gray-500 mb-2">
          {selectedDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        {selectedEvents.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No jobs or services scheduled</p>
        ) : (
          <div className="space-y-1.5">
            {selectedEvents.map((event, i) => (
              <Card key={i}
                onClick={() => event.type === 'job' ? navigate(`/jobs/${event.id}`) : navigate(`/pools/${event.id}`)}
                className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className={cn('w-2.5 h-2.5 rounded-full shrink-0',
                    event.type === 'job' ? (JOB_STATUS_COLORS[event.status] || 'bg-blue-500') : 'bg-pool-400')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{event.label}</p>
                    <p className="text-[11px] text-gray-400">{event.type === 'job' ? 'Job' : 'Service Due'}</p>
                  </div>
                  {event.status && (
                    <Badge variant={event.status === 'completed' ? 'success' : event.status === 'in_progress' ? 'warning' : 'primary'} className="text-[10px]">
                      {event.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── SHARED ────────────────────────────────────────
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ─── MAIN COMPONENT ────────────────────────────────
export default function Route() {
  const { business, loading: bizLoading } = useBusiness()
  const [activeTab, setActiveTab] = useState('route')

  if (bizLoading) {
    return (
      <>
        <Header title="Route" />
        <PageWrapper><LoadingSpinner /></PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title={activeTab === 'route' ? 'Route' : 'Calendar'} />
      <PageWrapper>
        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          {[
            { key: 'route', label: 'Route' },
            { key: 'calendar', label: 'Calendar' },
          ].map(tab => (
            <button
              key={tab.key}
              className={cn(
                'flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all duration-200',
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'route' && <RouteTab business={business} />}
        {activeTab === 'calendar' && <CalendarTab business={business} />}
      </PageWrapper>
    </>
  )
}
