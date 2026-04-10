import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import StopDetailModal from '../components/ui/StopDetailModal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION, getRoute, haversineKm } from '../lib/mapbox'

// ─── Numbered pin icon ──────────────────────────
function numberedIcon(n, color = '#0CA5EB') {
  return L.divIcon({
    className: 'numbered-pin',
    html: `<div style="
      background:${color};color:white;width:34px;height:34px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
      border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-weight:700;font-size:13px;
    "><span style="transform:rotate(45deg);">${n}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  })
}

// ─── Helpers ───────────────────────────────────
function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

// ─── Fit bounds helper ─────────────────────────
function FitBounds({ stops }) {
  const map = useMap()
  useEffect(() => {
    if (!stops.length) return
    const coords = stops.filter(s => s.lat != null && s.lng != null).map(s => [s.lat, s.lng])
    if (coords.length === 0) return
    if (coords.length === 1) {
      map.setView(coords[0], 14)
    } else {
      map.fitBounds(coords, { padding: [40, 40] })
    }
  }, [stops, map])
  return null
}

// ─── Main page ─────────────────────────────────
export default function Route() {
  const { business, loading: bizLoading } = useBusiness()
  const [view, setView] = useState('list') // 'list' | 'upcoming' | 'map'
  const [showCalendar, setShowCalendar] = useState(false)

  if (bizLoading) return <LoadingPage />

  return (
    <>
      <Header
        title="Schedule"
        right={
          <button
            onClick={() => setShowCalendar(v => !v)}
            className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100"
            title="Calendar"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </button>
        }
      />
      <PageWrapper>
        {showCalendar ? (
          <CalendarView business={business} onClose={() => setShowCalendar(false)} />
        ) : (
          <ScheduleView business={business} view={view} setView={setView} />
        )}
      </PageWrapper>
    </>
  )
}

// ─── Schedule (List / Upcoming / Map) ──────────
function ScheduleView({ business, view, setView }) {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [allJobs, setAllJobs] = useState([])
  const [allPools, setAllPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStop, setSelectedStop] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null) // { distance_km, duration_min, coordinates }

  async function fetchData() {
    if (!business?.id) return
    setLoading(true)
    // Load a wide range — 60 days back and 60 forward
    const from = new Date()
    from.setDate(from.getDate() - 60)
    const to = new Date()
    to.setDate(to.getDate() + 60)

    const [jobsRes, poolsRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude)')
        .eq('business_id', business.id)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      supabase
        .from('pools')
        .select('*, clients(name, email, phone)')
        .eq('business_id', business.id)
        .not('next_due_at', 'is', null)
        .gte('next_due_at', from.toISOString())
        .lte('next_due_at', to.toISOString()),
    ])
    setAllJobs(jobsRes.data || [])
    setAllPools(poolsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [business?.id])

  // Build stops for the selected date
  const stopsForDate = useMemo(() => {
    const stops = []
    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (!sameYMD(d, selectedDate)) continue
      stops.push(jobToStop(j))
    }
    for (const p of allPools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (!sameYMD(d, selectedDate)) continue
      stops.push(poolToStop(p))
    }
    // Sort by time
    stops.sort((a, b) => (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99'))
    return stops
  }, [allJobs, allPools, selectedDate])

  // Fetch Mapbox route when stops change
  useEffect(() => {
    const withCoords = stopsForDate.filter(s => s.lat != null && s.lng != null)
    if (withCoords.length < 2) {
      if (withCoords.length === 0) {
        setRouteInfo(null)
      } else {
        setRouteInfo({ distance_km: 0, duration_min: 0, coordinates: null })
      }
      return
    }
    let cancelled = false
    getRoute(withCoords.map(s => ({ lat: s.lat, lng: s.lng }))).then(r => {
      if (cancelled) return
      if (r) {
        setRouteInfo(r)
      } else {
        // Fallback to straight line
        let total = 0
        for (let i = 0; i < withCoords.length - 1; i++) {
          total += haversineKm(withCoords[i], withCoords[i + 1])
        }
        setRouteInfo({ distance_km: total, duration_min: (total / 60) * 60, coordinates: null })
      }
    })
    return () => { cancelled = true }
  }, [stopsForDate])

  // Build upcoming groups (next 14 days including today)
  const upcomingGroups = useMemo(() => {
    const groups = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 0; i < 14; i++) {
      const day = new Date(today)
      day.setDate(day.getDate() + i)
      const stops = []
      for (const j of allJobs) {
        if (!j.scheduled_date) continue
        const d = new Date(j.scheduled_date + 'T00:00:00')
        if (sameYMD(d, day)) stops.push(jobToStop(j))
      }
      for (const p of allPools) {
        if (!p.next_due_at) continue
        const d = new Date(p.next_due_at)
        if (sameYMD(d, day)) stops.push(poolToStop(p))
      }
      stops.sort((a, b) => (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99'))
      if (stops.length) groups.push({ date: day, stops })
    }
    return groups
  }, [allJobs, allPools])

  function prevDay() { setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n }) }
  function nextDay() { setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n }) }
  function jumpToday() { setSelectedDate(new Date()) }

  const isToday = sameYMD(selectedDate, new Date())

  return (
    <>
      {/* Date navigator */}
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-3 mb-4">
        <div className="flex items-center justify-between">
          <button onClick={prevDay} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">
              {selectedDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            {!isToday && (
              <button onClick={jumpToday} className="text-xs font-semibold text-pool-600 mt-0.5 hover:text-pool-700">
                Jump to today
              </button>
            )}
          </div>
          <button onClick={nextDay} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
        {[
          { key: 'list', label: 'List' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'map', label: 'Map' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-semibold text-center min-h-tap transition-all',
              view === t.key ? 'bg-white text-pool-700 shadow-card' : 'text-gray-500'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Total route card */}
      {routeInfo && stopsForDate.length > 1 && (
        <div className="bg-gradient-brand rounded-2xl p-4 mb-4 shadow-card text-white flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Total Route</p>
            <p className="text-base font-bold">
              {routeInfo.distance_km.toFixed(1)} km · ~{Math.round(routeInfo.duration_min)} min travel
            </p>
            {routeInfo.coordinates && <p className="text-[11px] opacity-75">via road network</p>}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : view === 'list' ? (
        <ListView stops={stopsForDate} onSelect={setSelectedStop} />
      ) : view === 'upcoming' ? (
        <UpcomingView groups={upcomingGroups} onSelect={setSelectedStop} />
      ) : (
        <MapView stops={stopsForDate} routeInfo={routeInfo} onSelect={setSelectedStop} />
      )}

      <StopDetailModal
        open={!!selectedStop}
        onClose={() => setSelectedStop(null)}
        stop={selectedStop}
        stopNumber={selectedStop ? stopsForDate.findIndex(s => s.id === selectedStop.id && s.type === selectedStop.type) + 1 : 1}
        onUpdated={() => { fetchData(); setSelectedStop(null) }}
      />
    </>
  )
}

// ─── List view ────────────────────────────────
function ListView({ stops, onSelect }) {
  if (!stops.length) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
        title="Nothing scheduled"
        description="No jobs or services scheduled for this day"
      />
    )
  }
  return (
    <div className="space-y-2.5">
      {stops.map((stop, idx) => (
        <StopCard key={`${stop.type}-${stop.id}`} stop={stop} number={idx + 1} onClick={() => onSelect(stop)} />
      ))}
    </div>
  )
}

// ─── Upcoming view ────────────────────────────
function UpcomingView({ groups, onSelect }) {
  if (!groups.length) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
        title="Nothing coming up"
        description="Your next 14 days are clear"
      />
    )
  }
  return (
    <div className="space-y-5">
      {groups.map((g, gi) => (
        <section key={gi}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
          </h3>
          <div className="space-y-2.5">
            {g.stops.map((stop, idx) => (
              <StopCard key={`${stop.type}-${stop.id}`} stop={stop} number={idx + 1} onClick={() => onSelect(stop)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ─── Map view ─────────────────────────────────
function MapView({ stops, routeInfo, onSelect }) {
  const withCoords = stops.filter(s => s.lat != null && s.lng != null)

  if (!MAPBOX_TILE_URL) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
        title="Map not configured"
        description="Add VITE_MAPBOX_TOKEN to your environment"
      />
    )
  }

  if (!withCoords.length) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
        title="No locations for this day"
        description="Stops need a geocoded address to appear on the map"
      />
    )
  }

  const center = [withCoords[0].lat, withCoords[0].lng]
  const polyline = routeInfo?.coordinates
    ? routeInfo.coordinates.map(([lng, lat]) => [lat, lng])
    : withCoords.map(s => [s.lat, s.lng])

  return (
    <div className="h-[520px] rounded-2xl overflow-hidden border border-gray-100 shadow-card">
      <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
        <FitBounds stops={withCoords} />
        {polyline.length > 1 && (
          <Polyline positions={polyline} pathOptions={{ color: '#0CA5EB', weight: 4, opacity: 0.8 }} />
        )}
        {withCoords.map((stop, idx) => (
          <Marker
            key={`${stop.type}-${stop.id}`}
            position={[stop.lat, stop.lng]}
            icon={numberedIcon(stops.findIndex(s => s.id === stop.id && s.type === stop.type) + 1)}
            eventHandlers={{ click: () => onSelect(stop) }}
          />
        ))}
      </MapContainer>
    </div>
  )
}

// ─── Stop card ────────────────────────────────
function StopCard({ stop, number, onClick }) {
  const color = stop.status === 'completed' ? '#10b981' : stop.status === 'in_progress' ? '#f59e0b' : '#0CA5EB'
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-card p-3.5 hover:shadow-card-hover transition-shadow"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-pool-50 text-pool-700 font-bold text-sm flex items-center justify-center shrink-0">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{stop.title}</p>
              {stop.client_name && <p className="text-xs text-gray-500 mt-0.5">{stop.client_name}</p>}
            </div>
            <Badge variant={stop.status === 'completed' ? 'success' : stop.status === 'in_progress' ? 'warning' : 'primary'} className="shrink-0 capitalize">
              {String(stop.status || 'scheduled').replace('_', ' ')}
            </Badge>
          </div>
          {stop.address && (
            <p className="text-xs text-pool-600 mt-1 truncate">{stop.address}</p>
          )}
          {stop.time_display && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{stop.time_display}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Calendar view (kept as before, simplified) ─
function CalendarView({ business, onClose }) {
  const navigate = useNavigate()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [jobs, setJobs] = useState([])
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  useEffect(() => {
    if (!business?.id) return
    async function fetch() {
      setLoading(true)
      const start = new Date(year, month, 1)
      start.setDate(start.getDate() - start.getDay() + 1)
      const end = new Date(year, month + 1, 0)
      end.setDate(end.getDate() + (7 - end.getDay()))
      const [jobsRes, poolsRes] = await Promise.all([
        supabase.from('jobs').select('*, clients(name), pools(address)').eq('business_id', business.id)
          .gte('scheduled_date', ymd(start)).lte('scheduled_date', ymd(end)).order('scheduled_date'),
        supabase.from('pools').select('id, address, next_due_at, schedule_frequency, clients(name)').eq('business_id', business.id)
          .gte('next_due_at', start.toISOString()).lte('next_due_at', end.toISOString()),
      ])
      setJobs(jobsRes.data || [])
      setPools(poolsRes.data || [])
      setLoading(false)
    }
    fetch()
  }, [business?.id, year, month])

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalDays = lastDay.getDate()
  const weeks = []
  let week = []
  for (let i = 0; i < startOffset; i++) week.push(null)
  for (let d = 1; d <= totalDays; d++) {
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week) }

  function getEvents(day) {
    if (!day) return []
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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

  const selectedEvents = getEvents(
    selectedDate.getMonth() === month && selectedDate.getFullYear() === year ? selectedDate.getDate() : null
  )

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <button onClick={onClose} className="text-sm font-semibold text-pool-600">← Back to Schedule</button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-lg font-bold text-gray-900">{MONTH_NAMES[month]} {year}</h2>
        <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAY_NAMES.map(d => <div key={d} className="text-center text-[11px] font-semibold text-gray-400 uppercase py-1">{d}</div>)}
      </div>
      <div className="bg-white rounded-2xl shadow-card overflow-hidden mb-4">
        {weeks.map((w, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-0">
            {w.map((day, di) => {
              const events = getEvents(day)
              return (
                <button key={di} disabled={!day}
                  onClick={() => day && setSelectedDate(new Date(year, month, day))}
                  className={cn(
                    'relative flex flex-col items-center py-2 min-h-[52px] transition-all',
                    day ? 'hover:bg-pool-50/50 cursor-pointer' : 'cursor-default',
                    isSelected(day) && 'bg-pool-50',
                    isToday(day) && !isSelected(day) && 'bg-amber-50/50'
                  )}>
                  {day && (
                    <>
                      <span className={cn('text-sm w-7 h-7 flex items-center justify-center rounded-full',
                        isToday(day) ? 'bg-pool-500 text-white font-bold' :
                        isSelected(day) ? 'bg-pool-100 text-pool-700 font-bold' : 'text-gray-700')}>
                        {day}
                      </span>
                      {events.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {events.slice(0, 3).map((e, i) => (
                            <div key={i} className="w-1.5 h-1.5 rounded-full bg-pool-500" />
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
      <div>
        <h3 className="text-sm font-semibold text-gray-500 mb-2">{formatDateLong(selectedDate)}</h3>
        {selectedEvents.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No jobs or services scheduled</p>
        ) : (
          <div className="space-y-1.5">
            {selectedEvents.map((event, i) => (
              <Card key={i} onClick={() => event.type === 'job' ? navigate(`/jobs/${event.id}`) : navigate(`/pools/${event.id}`)} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-pool-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{event.label}</p>
                    <p className="text-[11px] text-gray-400">{event.type === 'job' ? 'Job' : 'Service Due'}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Transformers ─────────────────────────────
function jobToStop(j) {
  const duration = j.estimated_duration_minutes || 60
  const timeDisp = j.scheduled_time ? formatTimeRange(j.scheduled_time, duration) : null
  return {
    type: 'job',
    id: j.id,
    title: j.title || 'Job',
    client_name: j.clients?.name,
    address: j.pools?.address || null,
    status: j.status,
    scheduled_date: j.scheduled_date,
    scheduled_time: j.scheduled_time,
    sortTime: j.scheduled_time,
    time_display: timeDisp,
    duration,
    price: j.price,
    notes: j.notes,
    phone: j.clients?.phone,
    email: j.clients?.email,
    lat: j.pools?.latitude ? Number(j.pools.latitude) : null,
    lng: j.pools?.longitude ? Number(j.pools.longitude) : null,
  }
}

function poolToStop(p) {
  const due = p.next_due_at ? new Date(p.next_due_at) : null
  const hh = due ? String(due.getHours()).padStart(2, '0') : null
  const mm = due ? String(due.getMinutes()).padStart(2, '0') : null
  const sortTime = hh && mm ? `${hh}:${mm}` : '09:00'
  return {
    type: 'pool',
    id: p.id,
    title: 'Pool Service',
    client_name: p.clients?.name,
    address: p.address,
    status: 'due',
    next_due_at: p.next_due_at,
    schedule_frequency: p.schedule_frequency,
    access_notes: p.access_notes,
    frequency: p.schedule_frequency,
    sortTime,
    time_display: due ? formatTimeRange(sortTime, 45) : null,
    duration: 45,
    phone: p.clients?.phone,
    email: p.clients?.email,
    lat: p.latitude ? Number(p.latitude) : null,
    lng: p.longitude ? Number(p.longitude) : null,
  }
}

// ─── Misc ─────────────────────────────────────
function LoadingPage() {
  return (
    <>
      <Header title="Schedule" />
      <PageWrapper><LoadingSpinner /></PageWrapper>
    </>
  )
}
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
