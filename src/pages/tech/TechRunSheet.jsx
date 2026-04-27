import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn, formatDate } from '../../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../../lib/mapbox'
import { Calendar, Check, Clock, MapPin, Phone } from 'lucide-react'

// ─── Helpers ───────────────────────────────────
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sameYMD(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDateLong(d) {
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatTimeRange(start, durationMin) {
  if (!start) return null
  const [h, m] = start.split(':').map(Number)
  const startD = new Date()
  startD.setHours(h || 0, m || 0, 0, 0)
  const endD = new Date(startD.getTime() + (durationMin || 60) * 60000)
  const fmt = (x) => x.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${fmt(startD)} – ${fmt(endD)}`
}

function profileIntervalDays(profile) {
  if (!profile) return null
  const rule = profile.recurrence_rule
  if (rule === 'custom') return Number(profile.custom_interval_days) || 7
  const map = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }
  return map[rule] || 7
}

function isProfileActive(profile) {
  if (profile.status === 'completed' || profile.status === 'cancelled' || profile.status === 'paused') return false
  if (profile.duration_type === 'num_visits' && profile.total_visits && (profile.completed_visits || 0) >= profile.total_visits) return false
  if (profile.duration_type === 'until_date' && profile.end_date && new Date(profile.end_date) < new Date()) return false
  return true
}

// Numbered pin
function numberedIcon(n, color = '#0CA5EB') {
  return L.divIcon({
    className: 'numbered-pin',
    html: `<div style="background:${color};color:white;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-weight:700;font-size:13px;"><span style="transform:rotate(45deg);">${n}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  })
}

function FitBounds({ stops }) {
  const map = useMap()
  useEffect(() => {
    if (!stops.length) return
    const coords = stops.filter(s => s.lat != null && s.lng != null).map(s => [s.lat, s.lng])
    if (!coords.length) return
    if (coords.length === 1) map.setView(coords[0], 14)
    else map.fitBounds(coords, { padding: [40, 40] })
  }, [stops, map])
  return null
}

// ─── Main component ────────────────────────────
export default function TechRunSheet() {
  const { business, staffRecord } = useBusiness()
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = useState('today')
  const [jobs, setJobs] = useState([])
  const [pools, setPools] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)

  const staffId = staffRecord?.id

  async function fetchData() {
    if (!business?.id || !staffId) return
    setLoading(true)
    const from = new Date()
    from.setDate(from.getDate() - 7)
    const to = new Date()
    to.setDate(to.getDate() + 60)

    const [jobsRes, poolsRes, profilesRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, phone, email), pools(address, latitude, longitude, type, access_notes)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      supabase
        .from('pools')
        .select('*, clients(name, phone, email)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .not('next_due_at', 'is', null),
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name, phone, email), pools(address, latitude, longitude, type, access_notes)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .eq('is_active', true),
    ])
    setJobs(jobsRes.data || [])
    setPools(poolsRes.data || [])
    setProfiles(profilesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [business?.id, staffId, location.key])

  // Build today's stops
  const todayStops = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayKey = ymd(now)

    const poolIdsCovered = new Set()
    const items = []

    // Jobs for today
    for (const j of jobs) {
      if (j.scheduled_date !== todayKey) continue
      items.push(jobToStop(j))
      if (j.pool_id) poolIdsCovered.add(j.pool_id)
    }

    // Due pools for today
    for (const p of pools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (!sameYMD(d, now)) continue
      if (poolIdsCovered.has(p.id)) continue
      items.push(poolToStop(p))
      poolIdsCovered.add(p.id)
    }

    // Recurring profiles for today
    const takenByProfile = new Map()
    for (const j of jobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
    }
    for (const profile of profiles) {
      if (!isProfileActive(profile)) continue
      const interval = profileIntervalDays(profile)
      if (!interval) continue
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor); cursor.setHours(0,0,0,0)
      while (cursor > startOfToday) cursor.setDate(cursor.getDate() - interval)
      while (cursor < startOfToday) cursor.setDate(cursor.getDate() + interval)
      if (sameYMD(cursor, now)) {
        const taken = takenByProfile.get(profile.id)
        if (taken && taken.has(todayKey)) continue
        if (profile.pool_id && poolIdsCovered.has(profile.pool_id)) continue
        items.push(profileToStop(profile, cursor))
        if (profile.pool_id) poolIdsCovered.add(profile.pool_id)
      }
    }

    items.sort((a, b) => (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99'))

    // Overdue
    const overdue = []
    for (const p of pools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (d >= startOfToday) continue
      if (poolIdsCovered.has(p.id)) continue
      const dueDate = new Date(d); dueDate.setHours(0, 0, 0, 0)
      const daysOver = Math.round((startOfToday - dueDate) / (1000 * 60 * 60 * 24))
      if (daysOver <= 0) {
        // Due today (timezone edge case where timestamp is just before midnight)
        items.push(poolToStop(p, { isOverdue: false, daysOverdue: 0 }))
      } else {
        overdue.push(poolToStop(p, { isOverdue: true, daysOverdue: daysOver }))
      }
    }
    overdue.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0))

    return [...overdue, ...items]
  }, [jobs, pools, profiles])

  // Week groups
  const weekGroups = useMemo(() => {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setHours(0,0,0,0)
    const dow = weekStart.getDay()
    weekStart.setDate(weekStart.getDate() - ((dow + 6) % 7))
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23,59,59,999)

    const byDay = new Map()
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      byDay.set(ymd(d), { date: new Date(d), stops: [] })
    }

    for (const j of jobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < weekStart || d > weekEnd) continue
      const key = ymd(d)
      byDay.get(key)?.stops.push(jobToStop(j))
    }

    for (const p of pools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (d < weekStart || d > weekEnd) continue
      byDay.get(ymd(d))?.stops.push(poolToStop(p))
    }

    // Overdue under today
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayGroup = byDay.get(ymd(now))
    if (todayGroup) {
      const ids = new Set(todayGroup.stops.filter(s => s.pool_id).map(s => s.pool_id))
      for (const p of pools) {
        if (!p.next_due_at) continue
        const d = new Date(p.next_due_at)
        if (d >= startOfToday) continue
        if (ids.has(p.id)) continue
        const daysOver = Math.floor((startOfToday - d) / (1000 * 60 * 60 * 24))
        todayGroup.stops.unshift(poolToStop(p, { isOverdue: true, daysOverdue: daysOver }))
        ids.add(p.id)
      }
    }

    return [...byDay.values()]
  }, [jobs, pools])

  // Upcoming (next 4 weeks)
  const upcomingGroups = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const horizon = new Date(today)
    horizon.setDate(horizon.getDate() + 28)

    const allStops = []
    for (const j of jobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < today || d > horizon) continue
      allStops.push({ date: d, stop: jobToStop(j) })
    }
    for (const p of pools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (d < today || d > horizon) continue
      allStops.push({ date: d, stop: poolToStop(p) })
    }

    allStops.sort((a, b) => a.date - b.date)

    const byKey = new Map()
    for (const { date, stop } of allStops) {
      const key = ymd(date)
      if (!byKey.has(key)) byKey.set(key, { date: new Date(date), stops: [] })
      byKey.get(key).stops.push(stop)
    }
    return [...byKey.values()]
  }, [jobs, pools])

  const completedCount = todayStops.filter(s => s.status === 'completed').length
  const totalCount = todayStops.length

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mt-4 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{completedCount} of {totalCount} stops completed</p>
            <p className="text-xs font-bold text-pool-600 dark:text-pool-400">{totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%</p>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-brand rounded-full transition-all duration-500" style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-4">
        {[
          { key: 'today', label: 'Today' },
          { key: 'week', label: 'Week' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'map', label: 'Map' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={cn(
              'flex-1 py-2.5 rounded-lg text-sm font-semibold text-center min-h-tap transition-all',
              view === t.key ? 'bg-white dark:bg-gray-900 text-pool-700 shadow-card' : 'text-gray-500 dark:text-gray-400'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {view === 'today' && (
        <TodayView stops={todayStops} navigate={navigate} onRefresh={fetchData} />
      )}
      {view === 'week' && (
        <WeekView groups={weekGroups} navigate={navigate} />
      )}
      {view === 'upcoming' && (
        <UpcomingView groups={upcomingGroups} navigate={navigate} />
      )}
      {view === 'map' && (
        <MapView pools={pools} navigate={navigate} />
      )}
    </div>
  )
}

// ─── Today view ──────────────────────────────
function TodayView({ stops, navigate, onRefresh }) {
  const overdue = stops.filter(s => s.isOverdue)
  const active = stops.filter(s => !s.isOverdue && s.status !== 'completed')
  const completed = stops.filter(s => s.status === 'completed')

  return (
    <div className="space-y-5">
      {/* Overdue — always visible */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${overdue.length > 0 ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wide ${overdue.length > 0 ? 'text-red-600' : 'text-gray-400 dark:text-gray-500'}`}>
            Overdue {overdue.length > 0 ? `(${overdue.length})` : ''}
          </h3>
        </div>
        {overdue.length > 0 ? (
          <div className="space-y-2.5">
            {overdue.map(stop => (
              <TechStopCard key={`o-${stop.id}`} stop={stop} navigate={navigate} />
            ))}
          </div>
        ) : (
          <div className="bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-100 px-4 py-3 flex items-center gap-2.5">
            <Check className="w-4 h-4 text-green-500 shrink-0" strokeWidth={2} />
            <p className="text-sm text-green-700">No overdue pools</p>
          </div>
        )}
      </section>

      {/* Today's Route — always visible */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${active.length > 0 ? 'bg-pool-500' : 'bg-gray-300'}`} />
          <h3 className={`text-xs font-bold uppercase tracking-wide ${active.length > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
            Today's Route {active.length > 0 ? `(${active.length})` : ''}
          </h3>
        </div>
        {active.length > 0 ? (
          <div className="space-y-2.5">
            {active.map((stop, idx) => (
              <TechStopCard key={`a-${stop.id}`} stop={stop} number={idx + 1} navigate={navigate} />
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-2.5">
            <Calendar className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={1.5} />
            <p className="text-sm text-gray-500 dark:text-gray-400">No stops scheduled for today</p>
          </div>
        )}
      </section>

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-green-600 dark:text-green-400 mb-2 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            Completed ({completed.length})
          </h3>
          <div className="space-y-2 opacity-70">
            {completed.map(stop => (
              <TechStopCard key={`c-${stop.id}`} stop={stop} navigate={navigate} completed />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Week view ───────────────────────────────
function WeekView({ groups, navigate }) {
  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <section key={gi}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
          </h3>
          {g.stops.length === 0 ? (
            <p className="text-xs italic text-gray-400 dark:text-gray-500 pl-0.5">No stops</p>
          ) : (
            <div className="space-y-2">
              {g.stops.map((stop, idx) => (
                <TechStopCard key={`w-${stop.id}-${gi}-${idx}`} stop={stop} number={idx + 1} navigate={navigate} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

// ─── Upcoming view ───────────────────────────
function UpcomingView({ groups, navigate }) {
  if (!groups.length) {
    return (
      <EmptyState
        icon={<Calendar className="w-10 h-10" strokeWidth={1.5} />}
        title="Nothing coming up"
        description="No stops assigned for the next 4 weeks"
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <section key={gi}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
          </h3>
          <div className="space-y-2">
            {g.stops.map((stop, idx) => (
              <TechStopCard key={`u-${stop.id}-${gi}-${idx}`} stop={stop} number={idx + 1} navigate={navigate} compact />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ─── Map view ────────────────────────────────
function MapView({ pools, navigate }) {
  const withCoords = pools.filter(p => p.latitude != null && p.longitude != null)

  if (!MAPBOX_TILE_URL) {
    return <EmptyState title="Map not configured" description="Add VITE_MAPBOX_TOKEN to your environment" />
  }

  if (!withCoords.length) {
    return <EmptyState title="No pool locations" description="Your assigned pools need a geocoded address to appear on the map" />
  }

  function pinColor(pool) {
    if (!pool.next_due_at) return '#9ca3af'
    const due = new Date(pool.next_due_at)
    const today = new Date(); today.setHours(0,0,0,0)
    if (due < today) return '#ef4444'
    if (due.toDateString() === today.toDateString()) return '#10b981'
    return '#0CA5EB'
  }

  function statusLabel(pool) {
    if (!pool.next_due_at) return { text: 'No schedule', color: 'text-gray-400 dark:text-gray-500' }
    const due = new Date(pool.next_due_at)
    const today = new Date(); today.setHours(0,0,0,0)
    if (due < today) {
      const dueDate = new Date(due); dueDate.setHours(0, 0, 0, 0)
      const days = Math.round((today - dueDate) / (1000 * 60 * 60 * 24))
      if (days <= 0) return { text: 'Due today', color: 'text-green-600 dark:text-green-400' }
      return { text: `${days}d overdue`, color: 'text-red-600 dark:text-red-400' }
    }
    if (due.toDateString() === today.toDateString()) return { text: 'Due today', color: 'text-green-600 dark:text-green-400' }
    return { text: `Next: ${due.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`, color: 'text-pool-600 dark:text-pool-400' }
  }

  // Find next due pool for navigate button
  const today = new Date(); today.setHours(0,0,0,0)
  const nextDue = withCoords.find(p => {
    if (!p.next_due_at) return false
    const due = new Date(p.next_due_at)
    return due <= new Date(today.getTime() + 86400000) // today or overdue
  })

  const center = [Number(withCoords[0].latitude), Number(withCoords[0].longitude)]

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Due Today</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pool-500" />Upcoming</span>
      </div>

      <div className="h-[420px] rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-card">
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
          <FitBounds stops={withCoords.map(p => ({ lat: Number(p.latitude), lng: Number(p.longitude) }))} />
          {withCoords.map((pool, idx) => {
            const status = statusLabel(pool)
            const freq = pool.schedule_frequency
            return (
              <Marker
                key={pool.id}
                position={[Number(pool.latitude), Number(pool.longitude)]}
                icon={numberedIcon(idx + 1, pinColor(pool))}
              >
                <Popup className="pool-map-popup" closeButton={false} maxWidth={260} minWidth={220}>
                  <div style={{ fontFamily: 'inherit', padding: '2px 0' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827', marginBottom: '2px', lineHeight: 1.3 }}>
                      {pool.clients?.name || 'Client'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#0CA5EB', marginBottom: '8px', lineHeight: 1.3 }}>
                      {pool.address}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600 }} className={status.color}>{status.text}</span>
                      {freq && (
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                          {freq === 'weekly' ? 'Weekly' : freq === 'fortnightly' ? 'Fortnightly' : freq === 'monthly' ? 'Monthly' : freq}
                        </span>
                      )}
                    </div>
                    {pool.clients?.phone && (
                      <a href={`tel:${pool.clients.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#0CA5EB', fontWeight: 600, textDecoration: 'none', marginBottom: '4px' }}>
                        <Phone className="w-5 h-5" strokeWidth={2} />
                        {pool.clients.phone}
                      </a>
                    )}
                    {pool.access_notes && (
                      <div style={{ fontSize: '11px', color: '#d97706', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                        {pool.access_notes}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        onClick={() => navigate(`/pools/${pool.id}/service`)}
                        style={{
                          flex: 1, padding: '8px 0',
                          background: 'linear-gradient(135deg, #0CA5EB, #0B8EC9)',
                          color: 'white', border: 'none', borderRadius: '10px',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Start Service
                      </button>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pool.address || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '8px 12px',
                          background: 'white', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '10px',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
                          display: 'flex', alignItems: 'center', gap: '3px',
                        }}
                      >
                        <MapPin className="w-5 h-5" strokeWidth={2} />
                        Nav
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        {withCoords.length} pool{withCoords.length !== 1 ? 's' : ''} on map
        {pools.length > withCoords.length && (
          <span className="text-amber-500 ml-1">
            · {pools.length - withCoords.length} missing location (update address with suburb)
          </span>
        )}
      </p>
    </div>
  )
}

// ─── Tech stop card ──────────────────────────
function TechStopCard({ stop, number, navigate, compact = false, completed = false }) {
  const color = stop.isOverdue ? '#ef4444' : completed ? '#10b981' : '#0CA5EB'

  return (
    <div
      className={cn(
        'bg-white dark:bg-gray-900 rounded-2xl border shadow-card p-3.5 transition-shadow',
        completed ? 'border-green-200' : stop.isOverdue ? 'border-red-200' : 'border-gray-100 dark:border-gray-800'
      )}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-start gap-3">
        {number && !stop.isOverdue && (
          <div className={cn(
            'w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center shrink-0',
            completed ? 'bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400' : 'bg-pool-50 dark:bg-pool-950/40 text-pool-700'
          )}>
            {completed ? (
              <Check className="w-4 h-4" strokeWidth={2.5} />
            ) : number}
          </div>
        )}
        {stop.isOverdue && (
          <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{stop.client_name || stop.title || 'Pool Service'}</p>
              {stop.client_name && stop.title && stop.title !== 'Pool Service' && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{stop.title}</p>
              )}
              {stop.address && <p className="text-xs text-pool-600 dark:text-pool-400 mt-0.5 truncate">{stop.address}</p>}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {stop.isOverdue && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${stop.daysOverdue === 0 ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40'}`}>{stop.daysOverdue === 0 ? 'Due today' : `${stop.daysOverdue}d overdue`}</span>
              )}
              {stop.pool_type && !stop.isOverdue && (
                <Badge variant="default" className="text-[10px] capitalize">{stop.pool_type}</Badge>
              )}
            </div>
          </div>

          {!compact && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              {stop.time_display && (
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <Clock className="w-3 h-3" strokeWidth={2} />
                  <span>{stop.time_display}</span>
                </div>
              )}
              {stop.phone && (
                <a href={`tel:${stop.phone}`} className="flex items-center gap-1 text-xs text-pool-600 dark:text-pool-400 font-medium" onClick={e => e.stopPropagation()}>
                  <Phone className="w-3 h-3" strokeWidth={2} />
                  {stop.phone}
                </a>
              )}
            </div>
          )}

          {stop.access_notes && !compact && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 truncate">Notes: {stop.access_notes}</p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {!completed && !compact && (
        <div className="flex gap-2 mt-3">
          {stop.pool_id && (
            <button
              onClick={() => navigate(`/pools/${stop.pool_id}/service`)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold shadow-md shadow-pool-500/20 active:scale-[0.98] transition-all min-h-tap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>
              Start Service
            </button>
          )}
          {stop.address && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold active:scale-[0.98] transition-all min-h-tap"
            >
              <MapPin className="w-4 h-4" strokeWidth={2} />
              Navigate
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Transformers ────────────────────────────
function jobToStop(j) {
  const duration = j.estimated_duration_minutes || 60
  const timeDisp = j.scheduled_time ? formatTimeRange(j.scheduled_time, duration) : null
  return {
    type: 'job', id: j.id, title: j.title || 'Job',
    client_id: j.client_id, pool_id: j.pool_id,
    client_name: j.clients?.name, address: j.pools?.address || null,
    pool_type: j.pools?.type || null, access_notes: j.pools?.access_notes || null,
    status: j.status, scheduled_date: j.scheduled_date,
    scheduled_time: j.scheduled_time, sortTime: j.scheduled_time,
    time_display: timeDisp, duration, price: j.price, notes: j.notes,
    phone: j.clients?.phone, email: j.clients?.email,
    lat: j.pools?.latitude ? Number(j.pools.latitude) : null,
    lng: j.pools?.longitude ? Number(j.pools.longitude) : null,
  }
}

function poolToStop(p, { isOverdue = false, daysOverdue = 0 } = {}) {
  const due = p.next_due_at ? new Date(p.next_due_at) : null
  const hh = due ? String(due.getHours()).padStart(2, '0') : null
  const mm = due ? String(due.getMinutes()).padStart(2, '0') : null
  const sortTime = hh && mm ? `${hh}:${mm}` : '09:00'
  return {
    type: 'pool', id: p.id, pool_id: p.id, client_id: p.client_id,
    title: 'Pool Service', client_name: p.clients?.name,
    address: p.address, pool_type: p.type || null, access_notes: p.access_notes || null,
    status: isOverdue ? 'overdue' : 'due', sortTime,
    time_display: due ? formatTimeRange(sortTime, 45) : null,
    duration: 45,
    phone: p.clients?.phone,
    email: p.clients?.email,
    frequency: p.schedule_frequency,
    isOverdue, daysOverdue,
    lat: p.latitude ? Number(p.latitude) : null,
    lng: p.longitude ? Number(p.longitude) : null,
  }
}

function profileToStop(profile, date) {
  const time = profile.preferred_time ? String(profile.preferred_time).slice(0, 5) : null
  return {
    type: 'job', id: `profile-${profile.id}-${ymd(date)}`,
    title: profile.title || 'Recurring Job',
    client_id: profile.client_id, pool_id: profile.pool_id,
    client_name: profile.clients?.name, address: profile.pools?.address || null,
    pool_type: profile.pools?.type || null, access_notes: profile.pools?.access_notes || null,
    status: 'scheduled', scheduled_date: ymd(date),
    scheduled_time: time, sortTime: time, time_display: time ? formatTimeRange(time, 60) : null,
    duration: 60, projected: true,
    lat: profile.pools?.latitude ? Number(profile.pools.latitude) : null,
    lng: profile.pools?.longitude ? Number(profile.pools.longitude) : null,
  }
}
