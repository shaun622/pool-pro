import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn, formatDate } from '../../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION, getRoute, haversineKm } from '../../lib/mapbox'

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
  const [view, setView] = useState('today')
  const [jobs, setJobs] = useState([])
  const [pools, setPools] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [routeInfo, setRouteInfo] = useState(null)

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
        .select('*, clients(name), pools(address, latitude, longitude, type, access_notes)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      supabase
        .from('pools')
        .select('*, clients(name)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .not('next_due_at', 'is', null),
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name), pools(address, latitude, longitude, type, access_notes)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffId)
        .eq('is_active', true),
    ])
    setJobs(jobsRes.data || [])
    setPools(poolsRes.data || [])
    setProfiles(profilesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [business?.id, staffId])

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
      const daysOver = Math.floor((startOfToday - d) / (1000 * 60 * 60 * 24))
      overdue.push(poolToStop(p, { isOverdue: true, daysOverdue: daysOver }))
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

  // Route for map
  useEffect(() => {
    const withCoords = todayStops.filter(s => s.lat != null && s.lng != null)
    if (withCoords.length < 2) { setRouteInfo(null); return }
    let cancelled = false
    getRoute(withCoords.map(s => ({ lat: s.lat, lng: s.lng }))).then(r => {
      if (cancelled) return
      setRouteInfo(r || null)
    })
    return () => { cancelled = true }
  }, [todayStops])

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
            <p className="text-xs font-semibold text-gray-500">{completedCount} of {totalCount} stops completed</p>
            <p className="text-xs font-bold text-pool-600">{totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%</p>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-brand rounded-full transition-all duration-500" style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
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
              view === t.key ? 'bg-white text-pool-700 shadow-card' : 'text-gray-500'
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
        <MapView stops={todayStops} routeInfo={routeInfo} navigate={navigate} />
      )}
    </div>
  )
}

// ─── Today view ──────────────────────────────
function TodayView({ stops, navigate, onRefresh }) {
  const overdue = stops.filter(s => s.isOverdue)
  const active = stops.filter(s => !s.isOverdue && s.status !== 'completed')
  const completed = stops.filter(s => s.status === 'completed')

  if (!stops.length) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
        title="No stops assigned for today"
        description="Check with your manager if you're expecting work today"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Overdue */}
      {overdue.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-red-600">Overdue ({overdue.length})</h3>
          </div>
          <div className="space-y-2.5">
            {overdue.map(stop => (
              <TechStopCard key={`o-${stop.id}`} stop={stop} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {/* Active stops */}
      {active.length > 0 && (
        <section>
          {overdue.length > 0 && (
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Today's Route ({active.length})</h3>
          )}
          <div className="space-y-2.5">
            {active.map((stop, idx) => (
              <TechStopCard key={`a-${stop.id}`} stop={stop} number={idx + 1} navigate={navigate} />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-green-600 mb-2 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
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
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
          </h3>
          {g.stops.length === 0 ? (
            <p className="text-xs italic text-gray-400 pl-0.5">No stops</p>
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
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
        title="Nothing coming up"
        description="No stops assigned for the next 4 weeks"
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <section key={gi}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">
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
function MapView({ stops, routeInfo, navigate }) {
  const withCoords = stops.filter(s => s.lat != null && s.lng != null && !s.isOverdue)
  const nextUnserviced = withCoords.find(s => s.status !== 'completed')

  if (!MAPBOX_TILE_URL) {
    return <EmptyState title="Map not configured" description="Add VITE_MAPBOX_TOKEN to your environment" />
  }

  if (!withCoords.length) {
    return <EmptyState title="No locations for today" description="Stops need a geocoded address to appear on the map" />
  }

  const center = [withCoords[0].lat, withCoords[0].lng]
  const polyline = routeInfo?.coordinates
    ? routeInfo.coordinates.map(([lng, lat]) => [lat, lng])
    : withCoords.map(s => [s.lat, s.lng])

  return (
    <div className="space-y-3">
      <div className="h-[420px] rounded-2xl overflow-hidden border border-gray-100 shadow-card">
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
          <FitBounds stops={withCoords} />
          {polyline.length > 1 && (
            <Polyline positions={polyline} pathOptions={{ color: '#0CA5EB', weight: 4, opacity: 0.8 }} />
          )}
          {withCoords.map((stop, idx) => (
            <Marker
              key={`${stop.id}`}
              position={[stop.lat, stop.lng]}
              icon={numberedIcon(idx + 1, stop.status === 'completed' ? '#10b981' : '#0CA5EB')}
            />
          ))}
        </MapContainer>
      </div>

      {/* Navigate to next stop */}
      {nextUnserviced && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(nextUnserviced.address || '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-brand text-white text-sm font-semibold shadow-md shadow-pool-500/20 active:scale-[0.98] transition-all min-h-tap"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Navigate to Next Stop
        </a>
      )}
    </div>
  )
}

// ─── Tech stop card ──────────────────────────
function TechStopCard({ stop, number, navigate, compact = false, completed = false }) {
  const color = stop.isOverdue ? '#ef4444' : completed ? '#10b981' : '#0CA5EB'

  return (
    <div
      className={cn(
        'bg-white rounded-2xl border shadow-card p-3.5 transition-shadow',
        completed ? 'border-green-200' : stop.isOverdue ? 'border-red-200' : 'border-gray-100'
      )}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-start gap-3">
        {number && !stop.isOverdue && (
          <div className={cn(
            'w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center shrink-0',
            completed ? 'bg-green-50 text-green-600' : 'bg-pool-50 text-pool-700'
          )}>
            {completed ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : number}
          </div>
        )}
        {stop.isOverdue && (
          <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{stop.client_name || 'Pool Service'}</p>
              {stop.address && <p className="text-xs text-pool-600 mt-0.5 truncate">{stop.address}</p>}
            </div>
            {stop.isOverdue && (
              <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-lg shrink-0">{stop.daysOverdue}d overdue</span>
            )}
            {stop.pool_type && !stop.isOverdue && (
              <Badge variant="default" className="text-[10px] shrink-0 capitalize">{stop.pool_type}</Badge>
            )}
          </div>

          {stop.time_display && !compact && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{stop.time_display}</span>
            </div>
          )}

          {stop.access_notes && !compact && (
            <p className="text-xs text-amber-600 mt-1 truncate">Access: {stop.access_notes}</p>
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
              className="px-4 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold active:scale-[0.98] transition-all min-h-tap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
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
    lat: j.pools?.latitude ? Number(j.pools.latitude) : null,
    lng: j.pools?.longitude ? Number(j.pools.longitude) : null,
  }
}

function poolToStop(p, { isOverdue = false, daysOverdue = 0 } = {}) {
  return {
    type: 'pool', id: p.id, pool_id: p.id, client_id: p.client_id,
    title: 'Pool Service', client_name: p.clients?.name,
    address: p.address, pool_type: p.type || null, access_notes: p.access_notes || null,
    status: isOverdue ? 'overdue' : 'due', sortTime: '09:00',
    time_display: null, isOverdue, daysOverdue,
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
