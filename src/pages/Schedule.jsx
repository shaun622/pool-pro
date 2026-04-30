import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import PageHero from '../components/layout/PageHero'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import StopDetailModal from '../components/ui/StopDetailModal'
// `Map` is aliased to MapIcon — lucide's Map icon clashes with the global
// Map constructor we use in the day-bucket useMemo (`new Map()`).
import { AlertCircle, CalendarClock, ChevronLeft, ChevronRight, Map as MapIcon, Phone, Users, X } from 'lucide-react'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../lib/mapbox'

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

function getMondayOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0=Sun..6=Sat
  const diffToMon = (dow + 6) % 7
  d.setDate(d.getDate() - diffToMon)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatRangeTitle(start, end) {
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear = start.getFullYear() === end.getFullYear()
  const startFmt = start.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: sameMonth ? undefined : 'short',
    year: sameYear ? undefined : 'numeric',
  })
  const endFmt = end.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${startFmt} — ${endFmt}`
}

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

function profileIntervalDays(profile) {
  if (!profile) return null
  if (profile.recurrence_rule === 'custom') return Number(profile.custom_interval_days) || 7
  return frequencyToDays(profile.recurrence_rule)
}

function isProfileActive(profile) {
  if (profile.status === 'completed' || profile.status === 'cancelled' || profile.status === 'paused') return false
  if (profile.duration_type === 'num_visits' && profile.total_visits && (profile.completed_visits || 0) >= profile.total_visits) return false
  if (profile.duration_type === 'until_date' && profile.end_date && new Date(profile.end_date) < new Date()) return false
  return true
}

function isOccurrenceInRange(profile, occurrenceDate, occurrenceIndex) {
  if (profile.duration_type === 'until_date' && profile.end_date) {
    return occurrenceDate <= new Date(profile.end_date + 'T23:59:59')
  }
  if (profile.duration_type === 'num_visits' && profile.total_visits) {
    const remaining = profile.total_visits - (profile.completed_visits || 0)
    return occurrenceIndex < remaining
  }
  return true
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

// Status → display + classes for badges and accent borders.
const STATUS_META = {
  scheduled: {
    label: 'Scheduled',
    badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    accent: 'border-l-pool-400 dark:border-l-pool-500/70',
    cardBg: 'bg-pool-50/70 hover:bg-pool-100/70 dark:bg-pool-950/20 dark:hover:bg-pool-950/40',
  },
  in_progress: {
    label: 'In progress',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    accent: 'border-l-pool-500 dark:border-l-pool-400',
    cardBg: 'bg-pool-50/70 hover:bg-pool-100/70 dark:bg-pool-950/20 dark:hover:bg-pool-950/40',
  },
  completed: {
    label: 'Done',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    accent: 'border-l-blue-500 dark:border-l-blue-400',
    cardBg: 'bg-blue-50/70 hover:bg-blue-100/70 dark:bg-blue-950/20 dark:hover:bg-blue-950/40',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-500',
    accent: 'border-l-gray-300 dark:border-l-gray-600',
    cardBg: 'bg-gray-50/70 hover:bg-gray-100/70 dark:bg-gray-900/40 dark:hover:bg-gray-800/60',
  },
  due: {
    label: 'Due',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    accent: 'border-l-amber-500 dark:border-l-amber-400',
    cardBg: 'bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-950/20 dark:hover:bg-amber-950/40',
  },
  overdue: {
    label: 'Overdue',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    accent: 'border-l-red-500 dark:border-l-red-400',
    cardBg: 'bg-red-50/70 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/40',
  },
}
function statusMeta(stop) {
  if (stop.isOverdue) return STATUS_META.overdue
  return STATUS_META[stop.status] || STATUS_META.scheduled
}

// ─── Numbered pin icon (for Map view) ──────────
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

// ─── Top-level page ────────────────────────────
export default function Route() {
  const { business, loading: bizLoading } = useBusiness()
  if (bizLoading) return <LoadingPage />
  return <Schedule business={business} />
}

function Schedule({ business }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = useState('week') // 'week' | 'day' | 'map'
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()))
  const [allJobs, setAllJobs] = useState([])
  const [allPools, setAllPools] = useState([])
  const [allProfiles, setAllProfiles] = useState([])
  const [allStaff, setAllStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStop, setSelectedStop] = useState(null)
  // Filter the grid + today list to a single tech (or 'unassigned') —
  // toggled by clicking a pill in the "On service / Crew" card.
  // null = no filter (show everyone).
  const [techFilter, setTechFilter] = useState(null)

  async function fetchData() {
    if (!business?.id) return
    setLoading(true)
    // Wide window so prev/next week navigation is cached.
    const from = new Date(); from.setDate(from.getDate() - 60)
    const to = new Date(); to.setDate(to.getDate() + 120)
    const [jobsRes, poolsRes, profilesRes, staffRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      supabase
        .from('pools')
        .select('*, clients(name, email, phone), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id),
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .eq('is_active', true),
      supabase
        .from('staff_members')
        .select('id, name, photo_url')
        .eq('business_id', business.id)
        .eq('is_active', true),
    ])
    setAllJobs(jobsRes.data || [])
    setAllPools(poolsRes.data || [])
    setAllProfiles(profilesRes.data || [])
    setAllStaff(staffRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [business?.id, location.key])

  // Build a Map<ymdKey, Stop[]> for the visible 7-day window.
  const stopsByDay = useMemo(() => {
    const weekEnd = addDays(weekStart, 6)
    weekEnd.setHours(23, 59, 59, 999)

    const byDay = new Map()
    const ensure = (d) => {
      const key = ymd(d)
      if (!byDay.has(key)) byDay.set(key, { date: new Date(d), stops: [] })
      return byDay.get(key)
    }
    for (let i = 0; i < 7; i++) ensure(addDays(weekStart, i))

    // Track which pool_ids are covered per day to dedupe profile/pool projections.
    const poolIdsCoveredByDay = new Map()
    const coverPool = (d, poolId) => {
      if (!poolId) return
      const key = ymd(d)
      if (!poolIdsCoveredByDay.has(key)) poolIdsCoveredByDay.set(key, new Set())
      poolIdsCoveredByDay.get(key).add(poolId)
    }
    const isPoolCovered = (d, poolId) => {
      if (!poolId) return false
      const covered = poolIdsCoveredByDay.get(ymd(d))
      return covered ? covered.has(poolId) : false
    }

    // 1. Real jobs
    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < weekStart || d > weekEnd) continue
      ensure(d).stops.push(jobToStop(j))
      coverPool(d, j.pool_id)
    }

    // 2. Pools with next_due_at in range — project at frequency
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
        if (isPoolCovered(occ, p.id)) continue
        ensure(occ).stops.push(poolToStop({ ...p, next_due_at: occ.toISOString() }))
        coverPool(occ, p.id)
      }
    }

    // 3. Recurring job profile projections
    const takenByProfile = new Map()
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
    }
    for (const profile of allProfiles) {
      if (!isProfileActive(profile)) continue
      const intervalDays = profileIntervalDays(profile)
      if (!intervalDays) continue
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor)
      cursor.setHours(0, 0, 0, 0)
      while (cursor > weekEnd) cursor.setDate(cursor.getDate() - intervalDays)
      while (cursor < weekStart) cursor.setDate(cursor.getDate() + intervalDays)
      let occurrenceIdx = 0
      while (cursor <= weekEnd) {
        if (!isOccurrenceInRange(profile, cursor, occurrenceIdx)) break
        const key = ymd(cursor)
        const taken = takenByProfile.get(profile.id)
        if (!taken || !taken.has(key)) {
          if (!isPoolCovered(cursor, profile.pool_id)) {
            ensure(cursor).stops.push(profileToStop(profile, cursor))
            coverPool(cursor, profile.pool_id)
          }
        }
        cursor.setDate(cursor.getDate() + intervalDays)
        occurrenceIdx++
      }
    }

    // 4. Overdue pools — surface under today's column
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (startOfToday >= weekStart && startOfToday <= weekEnd) {
      const todayKey = ymd(now)
      const todayGroup = byDay.get(todayKey)
      if (todayGroup) {
        const poolIdsInToday = new Set(todayGroup.stops.filter(s => s.pool_id).map(s => s.pool_id))
        for (const p of allPools) {
          if (!p.next_due_at) continue
          const d = new Date(p.next_due_at)
          if (d >= startOfToday) continue
          if (poolIdsInToday.has(p.id)) continue
          const dueDate = new Date(d); dueDate.setHours(0, 0, 0, 0)
          const daysOver = Math.round((startOfToday - dueDate) / (1000 * 60 * 60 * 24))
          todayGroup.stops.unshift(poolToStop(p, { isOverdue: true, daysOverdue: Math.max(daysOver, 1) }))
          poolIdsInToday.add(p.id)
        }
      }
    }

    // Sort each day strictly by time (overdue stops are styled with the
    // overdue badge but no longer jump to the top — they slot in at their
    // own scheduled time so the day reads chronologically).
    for (const group of byDay.values()) {
      group.stops.sort((a, b) =>
        (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99')
      )
    }

    // Return as flat ymd→stops Map for cheap day-column lookup
    const flat = new Map()
    for (const [k, v] of byDay.entries()) flat.set(k, v.stops)
    return flat
  }, [allJobs, allPools, allProfiles, weekStart])

  const weekDays = useMemo(() => {
    const days = []
    for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i))
    return days
  }, [weekStart])

  const today = new Date()
  const todayStops = stopsByDay.get(ymd(today)) || []

  // All stops across the visible 7-day window — flat array, used for the
  // week-scope "Crew this week" tally.
  const allWeekStops = useMemo(() => {
    const out = []
    for (const stops of stopsByDay.values()) out.push(...stops)
    return out
  }, [stopsByDay])

  // Apply techFilter to the grid + today list. The "On service" card
  // always sees the unfiltered set so the user can switch between techs.
  const stopMatchesFilter = (s) => {
    if (!techFilter) return true
    if (techFilter === 'unassigned') return !s.assigned_staff_id
    return s.assigned_staff_id === techFilter
  }
  const filteredStopsByDay = useMemo(() => {
    if (!techFilter) return stopsByDay
    const filtered = new Map()
    for (const [k, stops] of stopsByDay.entries()) {
      filtered.set(k, stops.filter(stopMatchesFilter))
    }
    return filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsByDay, techFilter])
  const filteredTodayStops = useMemo(
    () => todayStops.filter(stopMatchesFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayStops, techFilter],
  )

  const weekEnd = addDays(weekStart, 6)
  const isThisWeek = sameYMD(weekStart, getMondayOfWeek(new Date()))

  // Real jobs route to /work-orders/:id; everything else opens detail modal.
  function handleStopSelect(stop) {
    if (stop.type === 'job' && !stop.projected) {
      navigate(`/work-orders/${stop.id}`)
    } else {
      setSelectedStop(stop)
    }
  }

  // Eyebrow + title vary by view
  const eyebrowLabel = view === 'map' ? 'Map view' : view === 'day' ? 'Day view' : 'Week view'
  const heroTitle = view === 'day'
    ? today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : formatRangeTitle(weekStart, weekEnd)

  return (
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="w-3.5 h-3.5" strokeWidth={2.5} />
            {eyebrowLabel}
          </span>
        }
        title={heroTitle}
        subtitle={null}
        action={
          <div className="flex items-center gap-2 flex-wrap md:justify-end">
            {view !== 'map' && (
              <NavPills
                isThisWeek={isThisWeek}
                onPrev={() => setWeekStart(d => addDays(d, -7))}
                onThisWeek={() => setWeekStart(getMondayOfWeek(new Date()))}
                onNext={() => setWeekStart(d => addDays(d, 7))}
              />
            )}
            <ViewToggle view={view} setView={setView} />
          </div>
        }
      />

      {view === 'map' ? (
        <MapView pools={allPools} onSelect={handleStopSelect} />
      ) : loading ? (
        <LoadingSpinner />
      ) : view === 'day' ? (
        <>
          {todayStops.length > 0 && (
            <TechsOnService
              stops={todayStops}
              scope="day"
              activeFilter={techFilter}
              onSelect={(id) => setTechFilter(prev => prev === id ? null : id)}
            />
          )}
          <TodayList stops={filteredTodayStops} onStopSelect={handleStopSelect} variant="standalone" />
        </>
      ) : (
        <>
          {/* Desktop: 7-column grid */}
          <div className="hidden md:block">
            <WeekGrid weekDays={weekDays} stopsByDay={filteredStopsByDay} onStopSelect={handleStopSelect} />
          </div>
          {/* Mobile: stacked-by-day list */}
          <div className="md:hidden">
            <WeekStack weekDays={weekDays} stopsByDay={filteredStopsByDay} onStopSelect={handleStopSelect} />
          </div>
          {allWeekStops.length > 0 && (
            <TechsOnService
              stops={allWeekStops}
              scope="week"
              activeFilter={techFilter}
              onSelect={(id) => setTechFilter(prev => prev === id ? null : id)}
            />
          )}
          {/* TodayList only on desktop — mobile already shows today inline in the stack */}
          <div className="hidden md:block">
            <TodayList stops={filteredTodayStops} onStopSelect={handleStopSelect} />
          </div>
        </>
      )}

      <StopDetailModal
        open={!!selectedStop}
        onClose={() => setSelectedStop(null)}
        stop={selectedStop}
        stopNumber={1}
        onUpdated={() => { fetchData(); setSelectedStop(null) }}
        staffList={allStaff}
      />
    </PageWrapper>
  )
}

// ─── Prev / This week / Next — three separate rounded-full pills ──────
function NavPills({ isThisWeek, onPrev, onThisWeek, onNext }) {
  const pillBase = 'inline-flex items-center gap-1 px-3.5 h-9 rounded-full text-sm font-medium transition-colors border'
  const idle = 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-card'
  const activeNow = 'bg-pool-50 dark:bg-pool-950/40 border-pool-200/70 dark:border-pool-800/40 text-pool-700 dark:text-pool-300 shadow-card'
  return (
    <div className="inline-flex items-center gap-2 shrink-0">
      <button onClick={onPrev} className={cn(pillBase, idle)}>
        <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        Prev
      </button>
      <button onClick={onThisWeek} className={cn(pillBase, isThisWeek ? activeNow : idle)}>
        This week
      </button>
      <button onClick={onNext} className={cn(pillBase, idle)}>
        Next
        <ChevronRight className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  )
}

// ─── View toggle (Week / Day / Map) — typography-driven, active = solid pill
function ViewToggle({ view, setView }) {
  const base = 'inline-flex items-center px-3.5 h-9 rounded-full text-sm font-medium transition-colors'
  const active = 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
  const inactive = 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      <button onClick={() => setView('week')} className={cn(base, view === 'week' ? active : inactive)} aria-pressed={view === 'week'}>
        Week
      </button>
      <button onClick={() => setView('day')} className={cn(base, view === 'day' ? active : inactive)} aria-pressed={view === 'day'}>
        Day
      </button>
      <button onClick={() => setView('map')} className={cn(base, view === 'map' ? active : inactive)} aria-pressed={view === 'map'}>
        Map
      </button>
    </div>
  )
}

// ─── Week grid (7 day columns) ─────────────────
function WeekGrid({ weekDays, stopsByDay, onStopSelect }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
      <div className="grid grid-cols-7 divide-x divide-gray-100 dark:divide-gray-800">
        {weekDays.map(day => {
          const stops = stopsByDay.get(ymd(day)) || []
          const isToday = sameYMD(day, new Date())
          return (
            <DayColumn
              key={ymd(day)}
              day={day}
              stops={stops}
              isToday={isToday}
              onStopSelect={onStopSelect}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Mobile: stacked-by-day list (one section per day) ──
// Each day renders an inline header (DOW + date + stop count) and the stops
// list below it. Past days collapse to a single "no stops" line if empty.
function WeekStack({ weekDays, stopsByDay, onStopSelect }) {
  return (
    <div className="space-y-3 mb-4">
      {weekDays.map(day => {
        const stops = stopsByDay.get(ymd(day)) || []
        const isToday = sameYMD(day, new Date())
        const dow = day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
        return (
          <div key={ymd(day)}>
            <div className="flex items-center gap-2 px-1 mb-1.5">
              <p className={cn(
                'text-[11px] font-semibold uppercase tracking-wider',
                isToday ? 'text-pool-600 dark:text-pool-400' : 'text-gray-500 dark:text-gray-400',
              )}>
                {isToday ? 'Today' : dow}
              </p>
              <div className={cn(
                'flex-1 h-px',
                isToday ? 'bg-pool-200/70 dark:bg-pool-800/50' : 'bg-gray-100 dark:bg-gray-800',
              )} />
              {stops.length > 0 && (
                <span className="text-[10px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                  {stops.length}
                </span>
              )}
            </div>
            {stops.length === 0 ? (
              <p className="text-[12px] text-gray-400 dark:text-gray-600 px-1 italic">No stops</p>
            ) : (
              <Card className="!p-0 overflow-hidden">
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {stops.map(stop => (
                    <li key={stop.id}>
                      <StackRow stop={stop} onClick={() => onStopSelect(stop)} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StackRow({ stop, onClick }) {
  const meta = statusMeta(stop)
  const time = stop.scheduled_time ? stop.scheduled_time.slice(0, 5) : null
  const sub = stop.address || stop.client_name
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors border-l-[3px]',
        meta.accent,
      )}
    >
      <div className="flex items-start gap-3">
        <p className="tabular-nums text-[12px] font-semibold text-pool-700 dark:text-pool-400 w-12 shrink-0 leading-tight pt-0.5">
          {time || '—'}
        </p>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate',
            stop.status === 'cancelled' && 'line-through text-gray-500',
          )}>
            {stop.title}
          </p>
          {sub && (
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {sub}{stop.client_name && stop.address ? ` · ${stop.client_name}` : ''}
            </p>
          )}
        </div>
        <span className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 self-center',
          meta.badge,
        )}>
          {meta.label}
        </span>
      </div>
    </button>
  )
}

function DayColumn({ day, stops, isToday, onStopSelect }) {
  const dow = day.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()
  return (
    <div className="min-h-[220px] flex flex-col">
      <div className={cn(
        'px-3 py-2 border-b border-gray-100 dark:border-gray-800',
        isToday && 'bg-pool-50/60 dark:bg-pool-950/20'
      )}>
        <p className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          isToday ? 'text-pool-700 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500'
        )}>{dow}</p>
        <p className={cn(
          'text-2xl font-bold leading-none mt-0.5',
          isToday ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100'
        )}>
          {day.getDate()}
        </p>
      </div>
      <div className="p-1.5 space-y-1 flex-1">
        {stops.length === 0 ? (
          <p className="text-center text-gray-300 dark:text-gray-700 text-sm py-6 select-none">—</p>
        ) : (
          stops.map(stop => (
            <EventCard key={stop.id} stop={stop} onClick={() => onStopSelect(stop)} />
          ))
        )}
      </div>
    </div>
  )
}

function EventCard({ stop, onClick }) {
  const meta = statusMeta(stop)
  const time = stop.scheduled_time ? stop.scheduled_time.slice(0, 5) : null
  const sub = stop.client_name || stop.address || null
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full text-left rounded-md border-l-[3px] px-2 py-1.5 transition-colors',
        meta.accent,
        meta.cardBg,
      )}
    >
      {time && (
        <p className="tabular-nums text-[10.5px] text-gray-600 dark:text-gray-400 leading-none">{time}</p>
      )}
      <p className={cn(
        'text-[12px] font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate mt-0.5',
        stop.status === 'cancelled' && 'line-through text-gray-500 dark:text-gray-500',
      )}>
        {stop.title}
      </p>
      {sub && (
        <p className="text-[10.5px] text-gray-500 dark:text-gray-400 leading-tight truncate">{sub}</p>
      )}
    </button>
  )
}

// ─── On service today / Crew this week ──
// scope='week' → "Crew this week" + counts across the visible 7-day window
// scope='day'  → "On service today" + counts for today only
// Click a pill to filter the grid + today list to that tech (or 'unassigned').
// Click again to clear. activeFilter / onSelect drive that.
function TechsOnService({ stops, scope = 'day', activeFilter, onSelect }) {
  const byTech = new Map()
  let unassigned = 0
  for (const stop of stops) {
    if (stop.assigned_staff_id) {
      const key = stop.assigned_staff_id
      if (!byTech.has(key)) {
        byTech.set(key, {
          id: key,
          name: stop.tech_name || 'Tech',
          photo: stop.tech_photo,
          count: 0,
        })
      }
      byTech.get(key).count += 1
    } else {
      unassigned += 1
    }
  }
  const techs = Array.from(byTech.values()).sort((a, b) => b.count - a.count)
  const totalStops = stops.length

  if (techs.length === 0 && unassigned === 0) return null

  const eyebrowLabel = scope === 'week' ? 'Crew this week' : 'On service today'

  return (
    <Card className="!p-0 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
          <Users className="w-3.5 h-3.5" strokeWidth={2.5} />
          {eyebrowLabel}
        </p>
        <div className="flex items-center gap-2">
          {activeFilter && (
            <button
              onClick={() => onSelect && onSelect(activeFilter)}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-full bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 text-[10.5px] font-semibold uppercase tracking-wider hover:bg-pool-100 transition-colors"
              title="Clear filter"
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
              Clear
            </button>
          )}
          <span className="inline-flex items-center justify-center min-w-[24px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
            {totalStops}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2">
        {techs.map(t => {
          const active = activeFilter === t.id
          return (
            <button
              key={t.id}
              onClick={() => onSelect && onSelect(t.id)}
              className={cn(
                'inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-colors',
                active
                  ? 'bg-pool-50 dark:bg-pool-950/40 border-pool-200 dark:border-pool-800/40 ring-1 ring-pool-300/60 dark:ring-pool-700/40'
                  : 'bg-gray-50 dark:bg-gray-800/60 border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              <TechAvatar photo={t.photo} name={t.name} />
              <span className={cn(
                'text-sm font-semibold leading-none',
                active ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100',
              )}>
                {t.name.split(' ')[0]}
              </span>
              <span className={cn(
                'text-xs tabular-nums leading-none',
                active ? 'text-pool-600 dark:text-pool-400' : 'text-gray-500 dark:text-gray-400',
              )}>
                · {t.count} stop{t.count !== 1 ? 's' : ''}
              </span>
            </button>
          )
        })}
        {unassigned > 0 && (
          <button
            onClick={() => onSelect && onSelect('unassigned')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold transition-colors',
              activeFilter === 'unassigned'
                ? 'bg-amber-100 dark:bg-amber-950/50 border-amber-300/70 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 ring-1 ring-amber-300/60'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100/70',
            )}
          >
            <AlertCircle className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span className="tabular-nums">{unassigned}</span> unassigned
          </button>
        )}
      </div>
    </Card>
  )
}

function TechAvatar({ photo, name }) {
  const initials = (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className="w-7 h-7 rounded-full object-cover ring-1 ring-white dark:ring-gray-900 shrink-0"
      />
    )
  }
  return (
    <span className="w-7 h-7 rounded-full bg-pool-100 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 flex items-center justify-center text-[10px] font-bold ring-1 ring-white dark:ring-gray-900 shrink-0">
      {initials}
    </span>
  )
}

// ─── Today list (below week grid; also stand-alone for Day view) ──
function TodayList({ stops, onStopSelect, variant = 'attached' }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5" strokeWidth={2.5} />
          Today
        </p>
        <span className="inline-flex items-center justify-center min-w-[24px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
          {stops.length}
        </span>
      </div>
      {stops.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {variant === 'standalone' ? 'Nothing scheduled today.' : 'Nothing scheduled.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {stops.map(stop => (
            <li key={stop.id}>
              <TodayRow stop={stop} onClick={() => onStopSelect(stop)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TodayRow({ stop, onClick }) {
  const meta = statusMeta(stop)
  const time = stop.scheduled_time ? stop.scheduled_time.slice(0, 5) : null
  const sub = stop.address || stop.client_name
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
    >
      <div className="flex items-center gap-4">
        <p className="tabular-nums text-sm text-pool-700 dark:text-pool-400 w-12 shrink-0">
          {time || '—'}
        </p>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-1',
            stop.status === 'cancelled' && 'line-through text-gray-500'
          )}>
            {stop.title}
          </p>
          {sub && (
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
              {sub}{stop.client_name && stop.address ? ` · ${stop.client_name}` : ''}
            </p>
          )}
        </div>
        <span className={cn(
          'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0',
          meta.badge
        )}>
          {meta.label}
        </span>
      </div>
    </button>
  )
}

// ─── Map view (kept) ──────────────────────────
function MapView({ pools, onSelect }) {
  const withCoords = pools.filter(p => p.latitude != null && p.longitude != null)

  if (!MAPBOX_TILE_URL) {
    return (
      <EmptyState
        icon={<MapIcon className="w-10 h-10" strokeWidth={1.5} />}
        title="Map not configured"
        description="Add VITE_MAPBOX_TOKEN to your environment"
      />
    )
  }
  if (!withCoords.length) {
    return (
      <EmptyState
        icon={<MapIcon className="w-10 h-10" strokeWidth={1.5} />}
        title="No pool locations"
        description="Pools need a geocoded address to appear on the map"
      />
    )
  }

  function pinColor(pool) {
    if (!pool.next_due_at) return '#9ca3af'
    const due = new Date(pool.next_due_at)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (due < today) return '#ef4444'
    if (due.toDateString() === today.toDateString()) return '#10b981'
    return '#0CA5EB'
  }

  function statusLabel(pool) {
    if (!pool.next_due_at) return { text: 'No schedule', color: 'text-gray-400 dark:text-gray-500' }
    const due = new Date(pool.next_due_at)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (due < today) {
      const dueDate = new Date(due); dueDate.setHours(0, 0, 0, 0)
      const days = Math.round((today - dueDate) / (1000 * 60 * 60 * 24))
      if (days <= 0) return { text: 'Due today', color: 'text-green-600 dark:text-green-400' }
      return { text: `${days}d overdue`, color: 'text-red-600 dark:text-red-400' }
    }
    if (due.toDateString() === today.toDateString()) return { text: 'Due today', color: 'text-green-600 dark:text-green-400' }
    return { text: `Next: ${due.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`, color: 'text-pool-600 dark:text-pool-400' }
  }

  function poolToMapStop(p) {
    const due = p.next_due_at ? new Date(p.next_due_at) : null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const isOverdue = due && due < today
    const dueDate = due ? new Date(due) : null
    if (dueDate) dueDate.setHours(0, 0, 0, 0)
    const daysOverdue = isOverdue ? Math.max(Math.round((today - dueDate) / (1000 * 60 * 60 * 24)), 1) : 0
    return {
      type: 'pool', id: p.id, pool_id: p.id, client_id: p.client_id,
      title: 'Pool Service', client_name: p.clients?.name,
      address: p.address, status: isOverdue ? 'overdue' : due ? 'due' : 'scheduled',
      next_due_at: p.next_due_at, schedule_frequency: p.schedule_frequency,
      access_notes: p.access_notes, frequency: p.schedule_frequency,
      phone: p.clients?.phone, email: p.clients?.email,
      lat: Number(p.latitude), lng: Number(p.longitude),
      isOverdue, daysOverdue,
      tech_name: p.staff?.name || null, tech_photo: p.staff?.photo_url || null,
      assigned_staff_id: p.assigned_staff_id || null,
    }
  }

  const center = [Number(withCoords[0].latitude), Number(withCoords[0].longitude)]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Due Today</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pool-500" />Upcoming</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" />Unscheduled</span>
      </div>

      <div className="h-[420px] md:h-[560px] rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-card">
        <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
          <FitBounds stops={withCoords.map(p => ({ lat: Number(p.latitude), lng: Number(p.longitude) }))} />
          {withCoords.map((pool, idx) => {
            const status = statusLabel(pool)
            const techName = pool.staff?.name || null
            return (
              <Marker
                key={pool.id}
                position={[Number(pool.latitude), Number(pool.longitude)]}
                icon={numberedIcon(idx + 1, pinColor(pool))}
              >
                <Popup className="pool-map-popup" closeButton={false} maxWidth={280} minWidth={240}>
                  <div style={{ fontFamily: 'inherit', padding: '2px 0' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827', marginBottom: '2px', lineHeight: 1.3 }}>
                      {pool.clients?.name || 'Unknown Client'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#0CA5EB', marginBottom: '8px', lineHeight: 1.3 }}>
                      {pool.address}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600 }} className={status.color}>{status.text}</span>
                    </div>
                    {pool.clients?.phone && (
                      <a href={`tel:${pool.clients.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#0CA5EB', fontWeight: 600, textDecoration: 'none', marginBottom: '4px' }}>
                        <Phone className="w-4 h-4" strokeWidth={2} />
                        {pool.clients.phone}
                      </a>
                    )}
                    {techName && (
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                        Tech: <span style={{ fontWeight: 600, color: '#374151' }}>{techName}</span>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelect(poolToMapStop(pool)) }}
                      style={{
                        width: '100%', marginTop: '6px', padding: '8px 0',
                        background: 'linear-gradient(135deg, #0CA5EB, #0B8EC9)',
                        color: 'white', border: 'none', borderRadius: '10px',
                        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      }}
                    >
                      View Details
                      <ChevronRight className="w-4 h-4" strokeWidth={2} />
                    </button>
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
            · {pools.length - withCoords.length} missing location
          </span>
        )}
      </p>
    </div>
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
    tech_name: j.staff?.name || null,
    tech_photo: j.staff?.photo_url || null,
    assigned_staff_id: j.assigned_staff_id || null,
  }
}

function profileToStop(profile, occurrenceDate) {
  const duration = 60
  const time = profile.preferred_time ? String(profile.preferred_time).slice(0, 5) : null
  const timeDisp = time ? formatTimeRange(time, duration) : null
  return {
    type: 'job',
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
    tech_name: profile.staff?.name || null,
    tech_photo: profile.staff?.photo_url || null,
    assigned_staff_id: profile.assigned_staff_id || null,
  }
}

function poolToStop(p, { isOverdue = false, daysOverdue = 0 } = {}) {
  const due = p.next_due_at ? new Date(p.next_due_at) : null
  const hh = due ? String(due.getHours()).padStart(2, '0') : null
  const mm = due ? String(due.getMinutes()).padStart(2, '0') : null
  const sortTime = hh && mm ? `${hh}:${mm}` : '09:00'
  return {
    type: 'pool',
    id: p.id,
    pool_id: p.id,
    client_id: p.client_id,
    title: 'Pool Service',
    client_name: p.clients?.name,
    address: p.address,
    status: isOverdue ? 'overdue' : 'due',
    next_due_at: p.next_due_at,
    schedule_frequency: p.schedule_frequency,
    access_notes: p.access_notes,
    frequency: p.schedule_frequency,
    sortTime,
    scheduled_time: sortTime,
    time_display: due ? formatTimeRange(sortTime, 45) : null,
    duration: 45,
    phone: p.clients?.phone,
    email: p.clients?.email,
    lat: p.latitude ? Number(p.latitude) : null,
    lng: p.longitude ? Number(p.longitude) : null,
    isOverdue,
    daysOverdue,
    tech_name: p.staff?.name || null,
    tech_photo: p.staff?.photo_url || null,
    assigned_staff_id: p.assigned_staff_id || null,
  }
}

// ─── Loading ──────────────────────────────────
function LoadingPage() {
  return (
    <PageWrapper>
      <PageHero title="Schedule" />
      <LoadingSpinner />
    </PageWrapper>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
