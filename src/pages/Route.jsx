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

// Parse a pool's schedule_frequency to interval days.
// Supports: 'weekly', 'fortnightly', 'biweekly', 'monthly', 'every_2_weeks',
// 'every_3_weeks', 'every_4_weeks', numeric strings (days), or { days: n }.
function frequencyToDays(freq) {
  if (!freq) return null
  if (typeof freq === 'number') return freq
  const f = String(freq).toLowerCase().trim()
  if (f === 'weekly' || f === 'every_week' || f === '1w') return 7
  if (f === 'fortnightly' || f === 'biweekly' || f === 'every_2_weeks' || f === '2w') return 14
  if (f === 'every_3_weeks' || f === '3w') return 21
  if (f === 'every_4_weeks' || f === '4w') return 28
  if (f === 'monthly' || f === 'every_month' || f === '1m') return 30
  if (f === '6_weekly' || f === 'every_6_weeks' || f === '6w') return 42
  if (f === 'quarterly' || f === '3m') return 90
  const n = parseInt(f, 10)
  if (!isNaN(n) && n > 0) return n
  return null
}

// Interval for a recurring_job_profile (supports 'custom' via custom_interval_days).
function profileIntervalDays(profile) {
  if (!profile) return null
  if (profile.recurrence_rule === 'custom') return Number(profile.custom_interval_days) || 7
  return frequencyToDays(profile.recurrence_rule)
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
  const [view, setView] = useState('list') // 'list' | 'week' | 'upcoming' | 'map'
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
      <PageWrapper width="wide">
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
  const [allProfiles, setAllProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStop, setSelectedStop] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null) // { distance_km, duration_min, coordinates }
  const [upcomingPage, setUpcomingPage] = useState(0) // 0 = next 5 jobs, 1 = following 5, etc.
  const UPCOMING_PAGE_SIZE = 5
  const UPCOMING_HORIZON_DAYS = 180

  async function fetchData() {
    if (!business?.id) return
    setLoading(true)
    // Load a wide range — 60 days back and 60 forward
    const from = new Date()
    from.setDate(from.getDate() - 60)
    const to = new Date()
    to.setDate(to.getDate() + 60)

    const [jobsRes, poolsRes, profilesRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude)')
        .eq('business_id', business.id)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      // Load ALL pools with next_due_at — we project recurrences forward for Upcoming
      supabase
        .from('pools')
        .select('*, clients(name, email, phone)')
        .eq('business_id', business.id)
        .not('next_due_at', 'is', null),
      // Load active recurring job profiles so we can project future occurrences
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude)')
        .eq('business_id', business.id)
        .eq('is_active', true),
    ])
    setAllJobs(jobsRes.data || [])
    setAllPools(poolsRes.data || [])
    setAllProfiles(profilesRes.data || [])
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

  // Build week groups — Mon..Sun of the week containing selectedDate, with
  // recurring pool-service projections.
  const weekGroups = useMemo(() => {
    // Find Monday of the week containing selectedDate
    const weekStart = new Date(selectedDate)
    weekStart.setHours(0, 0, 0, 0)
    const dow = weekStart.getDay() // 0=Sun..6=Sat
    const diffToMon = (dow + 6) % 7 // days since Monday
    weekStart.setDate(weekStart.getDate() - diffToMon)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    const byDay = new Map()
    const ensure = (d) => {
      const key = ymd(d)
      if (!byDay.has(key)) byDay.set(key, { date: new Date(d), stops: [] })
      return byDay.get(key)
    }
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      ensure(d)
    }

    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < weekStart || d > weekEnd) continue
      ensure(d).stops.push(jobToStop(j))
    }

    for (const p of allPools) {
      if (!p.next_due_at) continue
      const intervalDays = frequencyToDays(p.schedule_frequency)
      const firstDue = new Date(p.next_due_at)
      if (isNaN(firstDue.getTime())) continue

      const occurrences = []
      if (!intervalDays) {
        if (firstDue >= weekStart && firstDue <= weekEnd) occurrences.push(firstDue)
      } else {
        let cursor = new Date(firstDue)
        while (cursor > weekEnd) cursor.setDate(cursor.getDate() - intervalDays)
        while (cursor < weekStart) cursor.setDate(cursor.getDate() + intervalDays)
        while (cursor <= weekEnd) {
          occurrences.push(new Date(cursor))
          cursor.setDate(cursor.getDate() + intervalDays)
        }
      }
      for (const occ of occurrences) {
        ensure(occ).stops.push(poolToStop({ ...p, next_due_at: occ.toISOString() }))
      }
    }

    // Recurring job profiles — project future occurrences across the week
    const takenByProfile = new Map() // profile_id -> Set of ymd that already have a real job row
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
    }
    for (const profile of allProfiles) {
      const intervalDays = profileIntervalDays(profile)
      if (!intervalDays) continue
      // Anchor: next_generation_at, falling back to last_generated_at, then today
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor)
      cursor.setHours(0, 0, 0, 0)
      while (cursor > weekEnd) cursor.setDate(cursor.getDate() - intervalDays)
      while (cursor < weekStart) cursor.setDate(cursor.getDate() + intervalDays)
      while (cursor <= weekEnd) {
        const key = ymd(cursor)
        const taken = takenByProfile.get(profile.id)
        if (!taken || !taken.has(key)) {
          ensure(cursor).stops.push(profileToStop(profile, cursor))
        }
        cursor.setDate(cursor.getDate() + intervalDays)
      }
    }

    const groups = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      const g = byDay.get(ymd(d))
      if (!g) continue
      g.stops.sort((a, b) => (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99'))
      groups.push(g)
    }
    return { weekStart, weekEnd, groups }
  }, [allJobs, allPools, allProfiles, selectedDate])

  // Build upcoming: collect all stops across the horizon, sort chronologically,
  // and paginate 5 at a time. Includes recurring projections of pool services.
  const { upcomingGroups, upcomingHasMore } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const horizonEnd = new Date(today)
    horizonEnd.setDate(horizonEnd.getDate() + UPCOMING_HORIZON_DAYS)
    horizonEnd.setHours(23, 59, 59, 999)

    const allStops = []

    // Jobs from today forward
    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < today || d > horizonEnd) continue
      const stop = jobToStop(j)
      allStops.push({ date: d, stop, sortTime: stop.sortTime || '99:99' })
    }

    // Pools: project recurring occurrences from today to horizon
    for (const p of allPools) {
      if (!p.next_due_at) continue
      const intervalDays = frequencyToDays(p.schedule_frequency)
      const firstDue = new Date(p.next_due_at)
      if (isNaN(firstDue.getTime())) continue

      const occurrences = []
      if (!intervalDays) {
        if (firstDue >= today && firstDue <= horizonEnd) occurrences.push(firstDue)
      } else {
        let cursor = new Date(firstDue)
        while (cursor > today) cursor.setDate(cursor.getDate() - intervalDays)
        while (cursor < today) cursor.setDate(cursor.getDate() + intervalDays)
        while (cursor <= horizonEnd) {
          occurrences.push(new Date(cursor))
          cursor.setDate(cursor.getDate() + intervalDays)
        }
      }

      for (const occ of occurrences) {
        const stop = poolToStop({ ...p, next_due_at: occ.toISOString() })
        allStops.push({ date: new Date(occ), stop, sortTime: stop.sortTime || '99:99' })
      }
    }

    // Recurring job profiles: project future occurrences
    const takenByProfile = new Map()
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
    }
    for (const profile of allProfiles) {
      const intervalDays = profileIntervalDays(profile)
      if (!intervalDays) continue
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor)
      cursor.setHours(0, 0, 0, 0)
      while (cursor > today) cursor.setDate(cursor.getDate() - intervalDays)
      while (cursor < today) cursor.setDate(cursor.getDate() + intervalDays)
      while (cursor <= horizonEnd) {
        const key = ymd(cursor)
        const taken = takenByProfile.get(profile.id)
        if (!taken || !taken.has(key)) {
          const stop = profileToStop(profile, cursor)
          allStops.push({ date: new Date(cursor), stop, sortTime: stop.sortTime || '99:99' })
        }
        cursor.setDate(cursor.getDate() + intervalDays)
      }
    }

    // Sort chronologically (date, then time)
    allStops.sort((a, b) => {
      const dc = a.date - b.date
      if (dc !== 0) return dc
      return a.sortTime.localeCompare(b.sortTime)
    })

    // Slice page
    const start = upcomingPage * UPCOMING_PAGE_SIZE
    const pageStops = allStops.slice(start, start + UPCOMING_PAGE_SIZE)
    const hasMore = allStops.length > start + UPCOMING_PAGE_SIZE

    // Group by day for the view
    const byKey = new Map()
    for (const { date, stop } of pageStops) {
      const key = ymd(date)
      if (!byKey.has(key)) byKey.set(key, { date: new Date(date), stops: [] })
      byKey.get(key).stops.push(stop)
    }
    const groups = [...byKey.values()]
    return { upcomingGroups: groups, upcomingHasMore: hasMore }
  }, [allJobs, allPools, allProfiles, upcomingPage])

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
          { key: 'list', label: 'Today' },
          { key: 'week', label: 'Week' },
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
      ) : view === 'week' ? (
        <WeekView
          weekStart={weekGroups.weekStart}
          weekEnd={weekGroups.weekEnd}
          groups={weekGroups.groups}
          selectedDate={selectedDate}
          onSelect={setSelectedStop}
          onPrev={() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
          onNext={() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
          onPickDay={(d) => setSelectedDate(d)}
        />
      ) : view === 'upcoming' ? (
        <UpcomingView
          groups={upcomingGroups}
          hasMore={upcomingHasMore}
          onSelect={setSelectedStop}
          page={upcomingPage}
          onPrev={() => setUpcomingPage(p => Math.max(0, p - 1))}
          onNext={() => setUpcomingPage(p => p + 1)}
        />
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

// ─── Week view ────────────────────────────────
function WeekView({ weekStart, weekEnd, groups, selectedDate, onSelect, onPrev, onNext, onPickDay }) {
  const fmt = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const totalStops = groups.reduce((s, g) => s + g.stops.length, 0)

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-card p-3">
        <button onClick={onPrev} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Week</p>
          <p className="text-sm font-bold text-gray-900">{fmt(weekStart)} – {fmt(weekEnd)}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{totalStops} stop{totalStops === 1 ? '' : 's'}</p>
        </div>
        <button onClick={onNext} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Day chip strip (Mon..Sun) */}
      <div className="grid grid-cols-7 gap-1.5">
        {groups.map((g, gi) => {
          const isSelected = sameYMD(g.date, selectedDate)
          const isToday = sameYMD(g.date, new Date())
          const dayShort = g.date.toLocaleDateString('en-AU', { weekday: 'short' }).slice(0, 3)
          return (
            <button
              key={gi}
              onClick={() => onPickDay(g.date)}
              className={cn(
                'flex flex-col items-center py-2 rounded-xl border transition-all',
                isSelected
                  ? 'bg-gradient-brand text-white border-transparent shadow-card'
                  : isToday
                    ? 'bg-pool-50 border-pool-200 text-pool-700'
                    : 'bg-white border-gray-100 text-gray-700'
              )}
            >
              <span className="text-[10px] font-bold uppercase opacity-80">{dayShort}</span>
              <span className="text-base font-bold leading-tight">{g.date.getDate()}</span>
              {g.stops.length > 0 && (
                <span className={cn(
                  'mt-0.5 text-[9px] font-bold px-1.5 rounded-full',
                  isSelected ? 'bg-white/25' : 'bg-pool-100 text-pool-700'
                )}>
                  {g.stops.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Day sections — start from the selected day, continue to end of week */}
      <div className="space-y-4">
        {groups.filter(g => g.date >= new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())).map((g, gi) => (
          <section key={gi}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
            </h3>
            {g.stops.length > 0 ? (
              <div className="space-y-2.5">
                {g.stops.map((stop, idx) => (
                  <StopCard key={`${stop.type}-${stop.id}-${gi}-${idx}`} stop={stop} number={idx + 1} onClick={() => onSelect(stop)} />
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-gray-400 pl-0.5">No services</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

// ─── Upcoming view ────────────────────────────
function UpcomingView({ groups, hasMore, onSelect, page, onPrev, onNext }) {
  const rangeLabel = (() => {
    if (!groups.length) return ''
    const first = groups[0].date
    const last = groups[groups.length - 1].date
    const fmt = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    if (sameYMD(first, last)) return fmt(first)
    return `${fmt(first)} – ${fmt(last)}`
  })()

  const hasAnyStops = groups.some(g => g.stops.length > 0)

  return (
    <div className="space-y-4">
      {/* Range header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
            {page === 0 ? 'Next 5 jobs' : `Jobs ${page * 5 + 1}–${page * 5 + 5}`}
          </p>
          <p className="text-sm font-semibold text-gray-900">{rangeLabel}</p>
        </div>
      </div>

      {!hasAnyStops ? (
        <EmptyState
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
          title="Nothing coming up"
          description="No jobs or recurring services in this range"
        />
      ) : (
        groups.map((g, gi) => (
          <section key={gi}>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">
              {sameYMD(g.date, new Date()) ? 'Today' : formatDateLong(g.date)}
            </h3>
            {g.stops.length === 0 ? (
              <p className="text-xs text-gray-400 italic pl-1">No jobs or services</p>
            ) : (
              <div className="space-y-2">
                {g.stops.map((stop, idx) => (
                  <StopCard key={`${stop.type}-${stop.id}-${gi}-${idx}`} stop={stop} number={idx + 1} onClick={() => onSelect(stop)} compact />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          onClick={onPrev}
          disabled={page === 0}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-tap',
            page === 0
              ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-card'
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasMore}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-tap',
            !hasMore
              ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-card'
          )}
        >
          Next
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
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
function StopCard({ stop, number, onClick, compact = false }) {
  const color = stop.status === 'completed' ? '#10b981' : stop.status === 'in_progress' ? '#f59e0b' : '#0CA5EB'

  if (compact) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-card px-3.5 py-2.5 hover:shadow-card-hover transition-shadow"
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-pool-50 text-pool-700 font-bold text-xs flex items-center justify-center shrink-0">
            {number}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {stop.title}
                {stop.client_name && <span className="text-gray-400 font-normal"> · {stop.client_name}</span>}
              </p>
              {stop.time_display && (
                <span className="text-xs text-gray-500 shrink-0">{stop.time_display.split(' – ')[0]}</span>
              )}
            </div>
            {stop.address && (
              <p className="text-xs text-pool-600 truncate mt-0.5">{stop.address}</p>
            )}
          </div>
        </div>
      </button>
    )
  }

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
    client_id: j.client_id,
    pool_id: j.pool_id,
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

// Build a stop from a recurring_job_profile projected onto a specific date.
function profileToStop(profile, occurrenceDate) {
  const duration = 60
  const time = profile.preferred_time ? String(profile.preferred_time).slice(0, 5) : null
  const timeDisp = time ? formatTimeRange(time, duration) : null
  return {
    type: 'job',
    // Prefix id so it's distinct from actual job rows, and unique per occurrence
    id: `profile-${profile.id}-${ymd(occurrenceDate)}`,
    title: profile.title || 'Recurring Job',
    client_id: profile.client_id,
    pool_id: profile.pool_id,
    client_name: profile.clients?.name,
    address: profile.pools?.address || null,
    status: 'scheduled',
    scheduled_date: ymd(occurrenceDate),
    scheduled_time: time,
    sortTime: time,
    time_display: timeDisp,
    duration,
    price: profile.price,
    notes: profile.notes,
    phone: profile.clients?.phone,
    email: profile.clients?.email,
    lat: profile.pools?.latitude ? Number(profile.pools.latitude) : null,
    lng: profile.pools?.longitude ? Number(profile.pools.longitude) : null,
    projected: true,
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
