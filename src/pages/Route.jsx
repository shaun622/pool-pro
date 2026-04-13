import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { Select, TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import StopDetailModal from '../components/ui/StopDetailModal'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../components/PoolFormFields'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION, getRoute, haversineKm } from '../lib/mapbox'

const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: '6_weekly', label: 'Every 6 Weeks' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'custom', label: 'Custom' },
]

const DAY_OPTIONS = [
  { value: '', label: 'No preference' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
]

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

// Check if a recurring profile is still active (respects duration limits)
function isProfileActive(profile) {
  if (profile.status === 'completed' || profile.status === 'cancelled' || profile.status === 'paused') return false
  if (profile.duration_type === 'num_visits' && profile.total_visits && (profile.completed_visits || 0) >= profile.total_visits) return false
  if (profile.duration_type === 'until_date' && profile.end_date && new Date(profile.end_date) < new Date()) return false
  return true
}

// Check if a projected occurrence date is within the profile's duration
function isOccurrenceInRange(profile, occurrenceDate, occurrenceIndex) {
  if (profile.duration_type === 'until_date' && profile.end_date) {
    return occurrenceDate <= new Date(profile.end_date + 'T23:59:59')
  }
  if (profile.duration_type === 'num_visits' && profile.total_visits) {
    const remaining = profile.total_visits - (profile.completed_visits || 0)
    return occurrenceIndex < remaining
  }
  return true // ongoing
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
  const [allStaff, setAllStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStop, setSelectedStop] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null) // { distance_km, duration_min, coordinates }
  const [upcomingPage, setUpcomingPage] = useState(0) // 0 = next 5 jobs, 1 = following 5, etc.
  const [recurModalOpen, setRecurModalOpen] = useState(false)
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

    const [jobsRes, poolsRes, profilesRes, staffRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time'),
      // Load ALL pools (map needs all, stop builders check next_due_at themselves)
      supabase
        .from('pools')
        .select('*, clients(name, email, phone), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id),
      // Load active recurring job profiles so we can project future occurrences
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name, email, phone), pools(address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .eq('is_active', true),
      // Load staff for tech display on cards
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

  useEffect(() => { fetchData() }, [business?.id])

  // Build stops for the selected date — merges jobs, due pools, overdue pools, and recurring profiles.
  // Deduplicates: if a pool has a jobs row for the day, prefer the job.
  // If a pool is covered by a recurring profile, prefer the pool (real data).
  const stopsForDate = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const isViewingToday = sameYMD(selectedDate, now)

    // 1. Jobs for selected date (+ track which pool_ids are covered)
    const poolIdsCoveredByJob = new Set()
    const todayItems = []
    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (!sameYMD(d, selectedDate)) continue
      todayItems.push(jobToStop(j))
      if (j.pool_id) poolIdsCoveredByJob.add(j.pool_id)
    }

    // 2. Pools due on selected date (skip if already covered by a job)
    const poolIdsCovered = new Set(poolIdsCoveredByJob)
    for (const p of allPools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (!sameYMD(d, selectedDate)) continue
      if (poolIdsCovered.has(p.id)) continue
      todayItems.push(poolToStop(p))
      poolIdsCovered.add(p.id)
    }

    // 3. Recurring profile projections for selected date
    const takenByProfile = new Map()
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
    }
    const dateKey = ymd(selectedDate)
    const selStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
    for (const profile of allProfiles) {
      if (!isProfileActive(profile)) continue
      const intervalDays = profileIntervalDays(profile)
      if (!intervalDays) continue
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor)
      cursor.setHours(0, 0, 0, 0)
      while (cursor > selStart) cursor.setDate(cursor.getDate() - intervalDays)
      while (cursor < selStart) cursor.setDate(cursor.getDate() + intervalDays)
      if (sameYMD(cursor, selectedDate)) {
        if (!isOccurrenceInRange(profile, cursor, 0)) continue
        const taken = takenByProfile.get(profile.id)
        if (taken && taken.has(dateKey)) continue
        if (profile.pool_id && poolIdsCovered.has(profile.pool_id)) continue
        todayItems.push(profileToStop(profile, cursor))
        if (profile.pool_id) poolIdsCovered.add(profile.pool_id)
      }
    }

    todayItems.sort((a, b) => (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99'))

    // 4. Overdue pools (only when viewing today)
    const overdueItems = []
    if (isViewingToday) {
      for (const p of allPools) {
        if (!p.next_due_at) continue
        const d = new Date(p.next_due_at)
        if (d >= startOfToday) continue
        if (poolIdsCoveredByJob.has(p.id)) continue // has a job today already
        // Compare date-only (strip time) to avoid timezone edge cases
        const dueDate = new Date(d); dueDate.setHours(0, 0, 0, 0)
        const daysOver = Math.round((startOfToday - dueDate) / (1000 * 60 * 60 * 24))
        if (daysOver <= 0) {
          // Due today (timezone edge case where timestamp is just before midnight)
          todayItems.push(poolToStop(p, { isOverdue: false, daysOverdue: 0 }))
        } else {
          overdueItems.push(poolToStop(p, { isOverdue: true, daysOverdue: daysOver }))
        }
      }
      overdueItems.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0))
    }

    // Return overdue first, then today — flat array for map/routing/modal numbering
    return [...overdueItems, ...todayItems]
  }, [allJobs, allPools, allProfiles, selectedDate])

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
          ensure(cursor).stops.push(profileToStop(profile, cursor))
        }
        cursor.setDate(cursor.getDate() + intervalDays)
        occurrenceIdx++
      }
    }

    // Add overdue pools under today's group (spec: overdue appears under current day only)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
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

    const groups = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      const g = byDay.get(ymd(d))
      if (!g) continue
      // Sort: overdue first (by most overdue), then by time
      g.stops.sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1
        if (!a.isOverdue && b.isOverdue) return 1
        if (a.isOverdue && b.isOverdue) return (b.daysOverdue || 0) - (a.daysOverdue || 0)
        return (a.sortTime || '99:99').localeCompare(b.sortTime || '99:99')
      })
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
      if (!isProfileActive(profile)) continue
      const intervalDays = profileIntervalDays(profile)
      if (!intervalDays) continue
      const anchorStr = profile.next_generation_at || profile.last_generated_at
      const anchor = anchorStr ? new Date(anchorStr) : new Date()
      if (isNaN(anchor.getTime())) continue
      let cursor = new Date(anchor)
      cursor.setHours(0, 0, 0, 0)
      while (cursor > today) cursor.setDate(cursor.getDate() - intervalDays)
      while (cursor < today) cursor.setDate(cursor.getDate() + intervalDays)
      let occurrenceIdx = 0
      while (cursor <= horizonEnd) {
        if (!isOccurrenceInRange(profile, cursor, occurrenceIdx)) break
        const key = ymd(cursor)
        const taken = takenByProfile.get(profile.id)
        if (!taken || !taken.has(key)) {
          const stop = profileToStop(profile, cursor)
          allStops.push({ date: new Date(cursor), stop, sortTime: stop.sortTime || '99:99' })
        }
        cursor.setDate(cursor.getDate() + intervalDays)
        occurrenceIdx++
      }
    }

    // Overdue pools — show under today in upcoming
    const poolIdsInStops = new Set(allStops.filter(s => s.stop.pool_id).map(s => s.stop.pool_id))
    for (const p of allPools) {
      if (!p.next_due_at) continue
      const d = new Date(p.next_due_at)
      if (d >= today) continue // not overdue
      if (poolIdsInStops.has(p.id)) continue
      const dueDate = new Date(d); dueDate.setHours(0, 0, 0, 0)
      const daysOver = Math.max(Math.round((today - dueDate) / (1000 * 60 * 60 * 24)), 1)
      const stop = poolToStop(p, { isOverdue: true, daysOverdue: daysOver })
      allStops.push({ date: new Date(today), stop, sortTime: '00:00' }) // sort first under today
      poolIdsInStops.add(p.id)
    }

    // Sort chronologically (date, then time — overdue items sort first via '00:00')
    allStops.sort((a, b) => {
      const dc = a.date - b.date
      if (dc !== 0) return dc
      // overdue items first within a day
      if (a.stop.isOverdue && !b.stop.isOverdue) return -1
      if (!a.stop.isOverdue && b.stop.isOverdue) return 1
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

      {/* Add Recurring Service + Manage link */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setRecurModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-brand text-white shadow-md shadow-pool-500/20 text-sm font-semibold hover:shadow-lg active:scale-[0.98] transition-all min-h-tap"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Recurring Service
        </button>
        <button
          onClick={() => navigate('/recurring-jobs')}
          className="text-xs font-medium text-gray-400 hover:text-pool-600 transition-colors"
        >
          Manage Recurring
        </button>
      </div>

      {/* Total route card */}
      {routeInfo && stopsForDate.length > 1 && (
        <div className="bg-white rounded-2xl p-4 mb-4 shadow-card border border-gray-100 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-pool-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total Route</p>
            <p className="text-base font-bold text-gray-900">
              {routeInfo.distance_km.toFixed(1)} km · ~{Math.round(routeInfo.duration_min)} min travel
            </p>
            {routeInfo.coordinates && <p className="text-[11px] text-gray-400">via road network</p>}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : view === 'list' ? (
        <ListView stops={stopsForDate} onSelect={setSelectedStop} navigate={navigate} isViewingToday={sameYMD(selectedDate, new Date())} />
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
        <MapView pools={allPools} onSelect={setSelectedStop} staffList={allStaff} />
      )}

      <StopDetailModal
        open={!!selectedStop}
        onClose={() => setSelectedStop(null)}
        stop={selectedStop}
        stopNumber={selectedStop ? stopsForDate.findIndex(s => s.id === selectedStop.id && s.type === selectedStop.type) + 1 : 1}
        onUpdated={() => { fetchData(); setSelectedStop(null) }}
        staffList={allStaff}
      />

      <AddRecurringModal
        open={recurModalOpen}
        onClose={() => setRecurModalOpen(false)}
        business={business}
        staff={allStaff}
        onCreated={() => { fetchData(); setRecurModalOpen(false) }}
      />
    </>
  )
}

// ─── List view ────────────────────────────────
function ListView({ stops, onSelect, navigate, isViewingToday }) {
  const overdueStops = stops.filter(s => s.isOverdue)
  const todayStops = stops.filter(s => !s.isOverdue)

  // When viewing today, always show both sections
  if (isViewingToday) {
    let num = 0
    return (
      <div className="space-y-5">
        {/* Overdue section — always visible */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${overdueStops.length > 0 ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
            <h3 className={`text-xs font-bold uppercase tracking-wide ${overdueStops.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              Overdue {overdueStops.length > 0 ? `(${overdueStops.length})` : ''}
            </h3>
          </div>
          {overdueStops.length > 0 ? (
            <div className="space-y-2.5">
              {overdueStops.map(stop => {
                num++
                return (
                  <OverdueCard
                    key={`overdue-${stop.id}`}
                    stop={stop}
                    onService={() => navigate(`/pools/${stop.pool_id || stop.id}/service`)}
                    onClick={() => onSelect(stop)}
                  />
                )
              })}
            </div>
          ) : (
            <div className="bg-green-50/50 rounded-xl border border-green-100 px-4 py-3 flex items-center gap-2.5">
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-green-700">No overdue pools</p>
            </div>
          )}
        </section>

        {/* Today's Route — always visible */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${todayStops.length > 0 ? 'bg-pool-500' : 'bg-gray-300'}`} />
            <h3 className={`text-xs font-bold uppercase tracking-wide ${todayStops.length > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
              Today's Route {todayStops.length > 0 ? `(${todayStops.length})` : ''}
            </h3>
          </div>
          {todayStops.length > 0 ? (
            <div className="space-y-2.5">
              {todayStops.map((stop) => {
                num++
                return (
                  <StopCard key={`${stop.type}-${stop.id}`} stop={stop} number={num} onClick={() => onSelect(stop)} />
                )
              })}
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-2.5">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-gray-500">No stops scheduled for today</p>
            </div>
          )}
        </section>
      </div>
    )
  }

  // Non-today view — simple flat list
  if (!stops.length) {
    return (
      <EmptyState
        icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
        title="Nothing scheduled"
        description="No jobs or services scheduled for this day"
      />
    )
  }

  let num = 0
  return (
    <div className="space-y-2.5">
      {stops.map((stop) => {
        num++
        return (
          <StopCard key={`${stop.type}-${stop.id}`} stop={stop} number={num} onClick={() => onSelect(stop)} />
        )
      })}
    </div>
  )
}

// ─── Overdue card ─────────────────────────────
function OverdueCard({ stop, onService, onClick }) {
  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-card p-3.5" style={{ borderLeft: '4px solid #ef4444' }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 font-bold text-xs flex items-center justify-center shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0" onClick={onClick} role="button" tabIndex={0}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{stop.client_name || 'Pool Service'}</p>
              {stop.address && <p className="text-xs text-gray-500 mt-0.5 truncate">{stop.address}</p>}
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg shrink-0 whitespace-nowrap ${stop.daysOverdue === 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
              {stop.daysOverdue === 0 ? 'Due today' : `${stop.daysOverdue}d overdue`}
            </span>
          </div>
          {stop.phone && (
            <a href={`tel:${stop.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-pool-600 font-medium mt-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {stop.phone}
            </a>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onService() }}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-pool-600 hover:bg-pool-700 transition-colors shrink-0 min-h-tap flex items-center"
        >
          Service
        </button>
      </div>
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
function MapView({ pools, onSelect, staffList }) {
  const withCoords = pools.filter(p => p.latitude != null && p.longitude != null)

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
        title="No pool locations"
        description="Pools need a geocoded address to appear on the map"
      />
    )
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
    if (!pool.next_due_at) return { text: 'No schedule', color: 'text-gray-400' }
    const due = new Date(pool.next_due_at)
    const today = new Date(); today.setHours(0,0,0,0)
    if (due < today) {
      const dueDate = new Date(due); dueDate.setHours(0, 0, 0, 0)
      const days = Math.round((today - dueDate) / (1000 * 60 * 60 * 24))
      if (days <= 0) return { text: 'Due today', color: 'text-green-600' }
      return { text: `${days}d overdue`, color: 'text-red-600' }
    }
    if (due.toDateString() === today.toDateString()) return { text: 'Due today', color: 'text-green-600' }
    return { text: `Next: ${due.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`, color: 'text-pool-600' }
  }

  function poolToMapStop(p) {
    const due = p.next_due_at ? new Date(p.next_due_at) : null
    const today = new Date(); today.setHours(0,0,0,0)
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
      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Overdue</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Due Today</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pool-500" />Upcoming</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" />Unscheduled</span>
      </div>

      <div className="h-[520px] rounded-2xl overflow-hidden border border-gray-100 shadow-card">
        <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
          <FitBounds stops={withCoords.map(p => ({ lat: Number(p.latitude), lng: Number(p.longitude) }))} />
          {withCoords.map((pool, idx) => {
            const status = statusLabel(pool)
            const techName = pool.staff?.name || null
            const freq = pool.schedule_frequency
            return (
              <Marker
                key={pool.id}
                position={[Number(pool.latitude), Number(pool.longitude)]}
                icon={numberedIcon(idx + 1, pinColor(pool))}
              >
                <Popup className="pool-map-popup" closeButton={false} maxWidth={280} minWidth={240}>
                  <div style={{ fontFamily: 'inherit', padding: '2px 0' }}>
                    {/* Client name */}
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#111827', marginBottom: '2px', lineHeight: 1.3 }}>
                      {pool.clients?.name || 'Unknown Client'}
                    </div>

                    {/* Address */}
                    <div style={{ fontSize: '12px', color: '#0CA5EB', marginBottom: '8px', lineHeight: 1.3 }}>
                      {pool.address}
                    </div>

                    {/* Status + frequency */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600 }} className={status.color}>{status.text}</span>
                      {freq && (
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                          {freq === 'weekly' ? 'Weekly' : freq === 'fortnightly' ? 'Fortnightly' : freq === 'monthly' ? 'Monthly' : freq}
                        </span>
                      )}
                      {pool.type && (
                        <span style={{ fontSize: '10px', color: '#6b7280', background: '#f3f4f6', borderRadius: '6px', padding: '1px 6px', fontWeight: 500, textTransform: 'capitalize' }}>
                          {pool.type}
                        </span>
                      )}
                    </div>

                    {/* Phone */}
                    {pool.clients?.phone && (
                      <a href={`tel:${pool.clients.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#0CA5EB', fontWeight: 600, textDecoration: 'none', marginBottom: '4px' }}>
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        {pool.clients.phone}
                      </a>
                    )}

                    {/* Access notes */}
                    {pool.access_notes && (
                      <div style={{ fontSize: '11px', color: '#d97706', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                        {pool.access_notes}
                      </div>
                    )}

                    {/* Tech assigned */}
                    {techName && (
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
                        Tech: <span style={{ fontWeight: 600, color: '#374151' }}>{techName}</span>
                      </div>
                    )}

                    {/* View Details button */}
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
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      <p className="text-xs text-gray-400 text-center">
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

// ─── Tech avatar ─────────────────────────────
function TechBadge({ name, photo }) {
  if (!name) return null
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const firstName = name.split(' ')[0]
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {photo ? (
        <img src={photo} alt={name} className="w-6 h-6 rounded-full object-cover border border-gray-200" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-pool-100 text-pool-700 flex items-center justify-center text-[10px] font-bold border border-pool-200">
          {initials}
        </div>
      )}
      <span className="text-[11px] text-gray-500 font-medium">{firstName}</span>
    </div>
  )
}

// ─── Stop card ────────────────────────────────
function StopCard({ stop, number, onClick, compact = false }) {
  const color = stop.isOverdue ? '#ef4444' : stop.status === 'completed' ? '#10b981' : stop.status === 'in_progress' ? '#f59e0b' : '#0CA5EB'

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
              <div className="flex items-center gap-2 shrink-0">
                <TechBadge name={stop.tech_name} photo={stop.tech_photo} />
                {stop.time_display && (
                  <span className="text-xs text-gray-500">{stop.time_display.split(' – ')[0]}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              {stop.address && (
                <p className="text-xs text-pool-600 truncate">{stop.address}</p>
              )}
              {stop.phone && (
                <a href={`tel:${stop.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-0.5 text-[11px] text-pool-600 font-medium shrink-0">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {stop.phone}
                </a>
              )}
            </div>
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
            <div className="flex items-center gap-2 shrink-0">
              <TechBadge name={stop.tech_name} photo={stop.tech_photo} />
              <Badge variant={stop.status === 'completed' ? 'success' : stop.status === 'in_progress' ? 'warning' : 'primary'} className="shrink-0 capitalize">
                {String(stop.status || 'scheduled').replace('_', ' ')}
              </Badge>
            </div>
          </div>
          {stop.address && (
            <p className="text-xs text-pool-600 mt-1 truncate">{stop.address}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {stop.time_display && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{stop.time_display}</span>
              </div>
            )}
            {stop.phone && (
              <a href={`tel:${stop.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-pool-600 font-medium">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {stop.phone}
              </a>
            )}
          </div>
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
              <Card key={i} onClick={() => event.type === 'job' ? navigate(`/work-orders/${event.id}`) : navigate(`/pools/${event.id}`)} className="py-2.5">
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
    tech_name: j.staff?.name || null,
    tech_photo: j.staff?.photo_url || null,
    assigned_staff_id: j.assigned_staff_id || null,
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

// ─── Add Recurring Service Modal ─────────────
function AddRecurringModal({ open, onClose, business, staff, onCreated }) {
  const [step, setStep] = useState(1) // 1=client, 2=pool, 3=details, 4=confirm
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [clientPools, setClientPools] = useState([])
  const [poolId, setPoolId] = useState('')
  const [saving, setSaving] = useState(false)

  // New client inline
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientForm, setNewClientForm] = useState({ name: '', email: '', phone: '', address: '' })
  const [newClientSaving, setNewClientSaving] = useState(false)

  // New pool inline
  const [showNewPool, setShowNewPool] = useState(false)
  const [newPoolForm, setNewPoolForm] = useState(emptyPool)
  const [newPoolSaving, setNewPoolSaving] = useState(false)

  // Schedule details
  const [recurrenceRule, setRecurrenceRule] = useState('weekly')
  const [customDays, setCustomDays] = useState(7)
  const [preferredDay, setPreferredDay] = useState('')
  const [firstDate, setFirstDate] = useState(new Date().toISOString().split('T')[0])
  const [assignedStaffId, setAssignedStaffId] = useState('')
  const [notes, setNotes] = useState('')

  // Duration
  const [durationType, setDurationType] = useState('ongoing')
  const [endDate, setEndDate] = useState('')
  const [totalVisits, setTotalVisits] = useState('')

  // Fetch clients on open
  useEffect(() => {
    if (!open || !business?.id) return
    supabase.from('clients').select('id, name, address').eq('business_id', business.id).order('name')
      .then(({ data }) => setClients(data || []))
  }, [open, business?.id])

  // Fetch pools when client changes
  useEffect(() => {
    if (!clientId) { setClientPools([]); return }
    supabase.from('pools').select('id, address').eq('client_id', clientId)
      .then(({ data }) => {
        setClientPools(data || [])
        // Auto-select if single pool
        if (data?.length === 1) setPoolId(data[0].id)
      })
  }, [clientId])

  function reset() {
    setStep(1); setClientId(''); setPoolId(''); setRecurrenceRule('weekly')
    setCustomDays(7); setPreferredDay(''); setFirstDate(new Date().toISOString().split('T')[0])
    setAssignedStaffId(''); setNotes(''); setShowNewClient(false); setShowNewPool(false)
    setNewClientForm({ name: '', email: '', phone: '', address: '' })
    setNewPoolForm(emptyPool)
    setDurationType('ongoing'); setEndDate(''); setTotalVisits('')
  }

  function handleClose() { reset(); onClose() }

  async function handleCreateClient() {
    if (!newClientForm.name.trim()) return
    setNewClientSaving(true)
    try {
      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: newClientForm.name.trim(),
        email: newClientForm.email.trim() || null,
        phone: newClientForm.phone.trim() || null,
        address: newClientForm.address.trim() || null,
      }).select('id, name, address').single()
      if (error) throw error
      setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setClientId(data.id)
      setShowNewClient(false)
      setNewClientForm({ name: '', email: '', phone: '', address: '' })
    } catch (err) {
      alert(err?.message || 'Failed to create client')
    } finally { setNewClientSaving(false) }
  }

  async function handleCreatePool() {
    if (!newPoolForm.address.trim()) return
    setNewPoolSaving(true)
    try {
      const payload = await buildPoolPayload(newPoolForm)
      const { data, error } = await supabase.from('pools').insert({
        ...payload,
        client_id: clientId,
        business_id: business.id,
      }).select('id, address').single()
      if (error) throw error
      setClientPools(prev => [...prev, data])
      setPoolId(data.id)
      setShowNewPool(false)
      setNewPoolForm(emptyPool)
    } catch (err) {
      alert(err?.message || 'Failed to create pool')
    } finally { setNewPoolSaving(false) }
  }

  async function handleSubmit() {
    if (!clientId || !poolId) return
    setSaving(true)
    try {
      const freqLabel = recurrenceRule === 'custom' ? `Every ${customDays} days` : RECURRENCE_OPTIONS.find(o => o.value === recurrenceRule)?.label || recurrenceRule
      const { error } = await supabase.from('recurring_job_profiles').insert({
        business_id: business.id,
        client_id: clientId,
        pool_id: poolId,
        title: `Pool Service — ${freqLabel}`,
        recurrence_rule: recurrenceRule,
        custom_interval_days: recurrenceRule === 'custom' ? Number(customDays) : null,
        preferred_day_of_week: preferredDay ? Number(preferredDay) : null,
        assigned_staff_id: assignedStaffId || null,
        notes: notes.trim() || null,
        is_active: true,
        next_generation_at: firstDate,
        duration_type: durationType,
        end_date: durationType === 'until_date' ? endDate : null,
        total_visits: durationType === 'num_visits' ? Number(totalVisits) : null,
        completed_visits: 0,
        status: 'active',
      })
      if (error) throw error

      // Update pool frequency and next_due_at
      await supabase.from('pools').update({
        frequency: recurrenceRule === 'custom' ? `${customDays}` : recurrenceRule,
        next_due_at: firstDate,
      }).eq('id', poolId)

      onCreated()
      reset()
    } catch (err) {
      console.error('Error creating recurring service:', err)
      alert(err?.message || 'Failed to create recurring service')
    } finally { setSaving(false) }
  }

  const selectedClient = clients.find(c => c.id === clientId)
  const selectedPool = clientPools.find(p => p.id === poolId)
  const selectedTech = staff.find(s => s.id === assignedStaffId)
  const freqLabel = recurrenceRule === 'custom' ? `Every ${customDays} days` : RECURRENCE_OPTIONS.find(o => o.value === recurrenceRule)?.label
  const durationLabel = durationType === 'ongoing' ? 'Ongoing' : durationType === 'until_date' ? `Until ${endDate}` : `${totalVisits} visits`

  // Calculate estimated end date for num_visits
  const intervalDaysValue = recurrenceRule === 'custom' ? Number(customDays) : ({ weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }[recurrenceRule] || 7)
  const estimatedEndDate = durationType === 'num_visits' && totalVisits && firstDate
    ? (() => { const d = new Date(firstDate); d.setDate(d.getDate() + intervalDaysValue * (Number(totalVisits) - 1)); return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) })()
    : null

  const stepTitles = ['Select Client', 'Select Pool', 'Schedule Details', 'Confirm']

  return (
    <Modal open={open} onClose={handleClose} title={`Add Recurring Service — Step ${step}`}>
      {/* Progress */}
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className={cn('flex-1 h-1 rounded-full', s <= step ? 'bg-pool-500' : 'bg-gray-200')} />
        ))}
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{stepTitles[step - 1]}</p>

      {/* Step 1: Client */}
      {step === 1 && (
        <div className="space-y-3">
          {!showNewClient ? (
            <>
              <Select
                label="Client"
                value={clientId}
                onChange={e => { setClientId(e.target.value); setPoolId('') }}
                options={[{ value: '', label: 'Select a client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
              />
              <button type="button" onClick={() => setShowNewClient(true)}
                className="text-xs font-medium text-pool-600 hover:text-pool-700">
                + Add new client
              </button>
            </>
          ) : (
            <div className="space-y-3 p-3 rounded-lg border border-pool-200 bg-pool-50/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Client</span>
                <button type="button" onClick={() => setShowNewClient(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <Input label="Name" value={newClientForm.name} onChange={e => setNewClientForm(p => ({ ...p, name: e.target.value }))} required />
              <Input label="Phone" value={newClientForm.phone} onChange={e => setNewClientForm(p => ({ ...p, phone: e.target.value }))} />
              <Input label="Address" value={newClientForm.address} onChange={e => setNewClientForm(p => ({ ...p, address: e.target.value }))} />
              <button type="button" onClick={handleCreateClient} disabled={!newClientForm.name.trim() || newClientSaving}
                className="w-full py-2.5 rounded-lg bg-gradient-brand text-white text-sm font-semibold disabled:opacity-50">
                {newClientSaving ? 'Saving...' : 'Create Client'}
              </button>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setStep(2)} disabled={!clientId}
              className="px-5 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold disabled:opacity-50 min-h-tap">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Pool */}
      {step === 2 && (
        <div className="space-y-3">
          {clientPools.length > 0 && !showNewPool ? (
            <div className="space-y-2">
              {clientPools.map(p => (
                <button key={p.id} type="button" onClick={() => setPoolId(p.id)}
                  className={cn('w-full text-left p-3 rounded-xl border-2 transition-all', poolId === p.id ? 'border-pool-500 bg-pool-50' : 'border-gray-200 bg-white hover:border-gray-300')}>
                  <p className="text-sm font-medium text-gray-900 truncate">{p.address}</p>
                </button>
              ))}
            </div>
          ) : null}
          {!showNewPool ? (
            <button type="button" onClick={() => setShowNewPool(true)}
              className="text-xs font-medium text-pool-600 hover:text-pool-700">
              + Add new pool
            </button>
          ) : (
            <div className="space-y-3 p-3 rounded-lg border border-pool-200 bg-pool-50/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Pool</span>
                <button type="button" onClick={() => { setShowNewPool(false); setNewPoolForm(emptyPool) }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <PoolFormFields poolForm={newPoolForm} setPoolForm={setNewPoolForm} clientAddress={selectedClient?.address || ''} />
              <button type="button" onClick={handleCreatePool} disabled={!newPoolForm.address.trim() || newPoolSaving}
                className="w-full py-2.5 rounded-lg bg-gradient-brand text-white text-sm font-semibold disabled:opacity-50">
                {newPoolSaving ? 'Saving...' : 'Add Pool'}
              </button>
            </div>
          )}
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(1)} className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold min-h-tap">Back</button>
            <button type="button" onClick={() => setStep(3)} disabled={!poolId}
              className="px-5 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold disabled:opacity-50 min-h-tap">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Schedule Details */}
      {step === 3 && (
        <div className="space-y-4">
          <Select label="Frequency" value={recurrenceRule} onChange={e => setRecurrenceRule(e.target.value)}
            options={RECURRENCE_OPTIONS} />
          {recurrenceRule === 'custom' && (
            <Input label="Every ___ days" type="number" min="1" value={customDays}
              onChange={e => setCustomDays(e.target.value)} />
          )}
          <Select label="Preferred Day" value={preferredDay} onChange={e => setPreferredDay(e.target.value)}
            options={DAY_OPTIONS} />
          <Input label="First Service Date" type="date" value={firstDate}
            onChange={e => setFirstDate(e.target.value)} />

          {/* Duration */}
          <div className="border-t border-gray-100 pt-3">
            <label className="text-sm font-medium text-gray-700 mb-2 block">Duration</label>
            <div className="space-y-2">
              {[
                { value: 'ongoing', label: 'Ongoing', desc: 'Continues until you cancel it' },
                { value: 'until_date', label: 'Until a date', desc: 'Ends on a specific date' },
                { value: 'num_visits', label: 'Fixed visits', desc: 'Set number of services' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setDurationType(opt.value)}
                  className={cn('w-full text-left p-3 rounded-xl border-2 transition-all',
                    durationType === opt.value ? 'border-pool-500 bg-pool-50' : 'border-gray-200 bg-white hover:border-gray-300')}>
                  <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.desc}</p>
                </button>
              ))}
            </div>

            {durationType === 'until_date' && (
              <div className="mt-3 space-y-2">
                <Input label="End Date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                <div className="flex gap-2">
                  {[
                    { label: '3 months', months: 3 },
                    { label: '6 months', months: 6 },
                    { label: '12 months', months: 12 },
                  ].map(preset => (
                    <button key={preset.months} type="button"
                      onClick={() => {
                        const d = new Date(firstDate || new Date())
                        d.setMonth(d.getMonth() + preset.months)
                        setEndDate(d.toISOString().split('T')[0])
                      }}
                      className="flex-1 py-2 px-2 rounded-lg bg-gray-100 text-xs font-semibold text-gray-700 hover:bg-gray-200 active:scale-95 transition-all min-h-[36px]"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {durationType === 'num_visits' && (
              <div className="mt-3 space-y-2">
                <Input label="Number of Visits" type="number" min="1" value={totalVisits}
                  onChange={e => setTotalVisits(e.target.value)} placeholder="e.g. 12" />
                {estimatedEndDate && (
                  <p className="text-xs text-gray-500">
                    Approx. finishes <span className="font-semibold text-gray-700">{estimatedEndDate}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {staff.length > 0 && (
            <Select label="Assign Technician" value={assignedStaffId} onChange={e => setAssignedStaffId(e.target.value)}
              options={[{ value: '', label: 'Unassigned' }, ...staff.map(s => ({ value: s.id, label: s.name }))]} />
          )}
          <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Back gate code 1234" rows={2} />
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(2)} className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold min-h-tap">Back</button>
            <button type="button" onClick={() => setStep(4)}
              className="px-5 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold min-h-tap">
              Review
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Client</span>
              <span className="font-semibold text-gray-900">{selectedClient?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Pool</span>
              <span className="font-semibold text-gray-900 text-right truncate max-w-[60%]">{selectedPool?.address}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Frequency</span>
              <span className="font-semibold text-gray-900">{freqLabel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">First Service</span>
              <span className="font-semibold text-gray-900">{firstDate}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Duration</span>
              <span className="font-semibold text-gray-900">{durationLabel}</span>
            </div>
            {selectedTech && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Technician</span>
                <span className="font-semibold text-gray-900">{selectedTech.name}</span>
              </div>
            )}
            {notes && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Notes</span>
                <span className="text-gray-700 text-right max-w-[60%]">{notes}</span>
              </div>
            )}
          </div>
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => setStep(3)} className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold min-h-tap">Back</button>
            <button type="button" onClick={handleSubmit} disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold disabled:opacity-50 min-h-tap">
              {saving ? 'Creating...' : 'Create Recurring Service'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
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
