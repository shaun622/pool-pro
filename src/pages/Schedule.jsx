import { useState, useEffect, useMemo, useRef } from 'react'
import { useToast } from '../contexts/ToastContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import PageHero from '../components/layout/PageHero'
import PageWrapper from '../components/layout/PageWrapper'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import StopDetailModal from '../components/ui/StopDetailModal'
import AddRecurringModal from '../components/ui/AddRecurringModal'
import Modal from '../components/ui/Modal'
import OneOffVisitPicker from '../components/ui/OneOffVisitPicker'
// `Map` is aliased to MapIcon — lucide's Map icon clashes with the global
// Map constructor we use in the day-bucket useMemo (`new Map()`).
import { AlertCircle, CalendarClock, ChevronLeft, ChevronRight, Map as MapIcon, Phone, Plus, Users, X } from 'lucide-react'
import { useBusiness } from '../hooks/useBusiness'
import { useBranches } from '../hooks/useBranches'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../lib/mapbox'
import { occurrencesInRange, isProfileActive, isOccurrenceInRange } from '../lib/recurringScheduling'

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

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1)
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
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
  // Legacy multi-day rules (bi_weekly/tri_weekly) were removed but a
  // pool's denormalised `schedule_frequency` may still carry the string
  // until the migration runs. Returning null suppresses path-2 projection
  // for these — path 3 will pick them up after the migration flips them
  // to weekly.
  if (f === 'bi_weekly' || f === 'tri_weekly') return null
  const n = parseInt(f, 10)
  if (!isNaN(n) && n > 0) return n
  return null
}

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
  unable_to_service: {
    label: 'Unable to service',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    accent: 'border-l-orange-500 dark:border-l-orange-400',
    cardBg: 'bg-orange-50/70 hover:bg-orange-100/70 dark:bg-orange-950/20 dark:hover:bg-orange-950/40',
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
  const { branches } = useBranches()
  const [view, setView] = useState('month') // 'month' | 'week' | 'day' | 'map'
  const [oneOffOpen, setOneOffOpen] = useState(false) // "Service a one-off visit" picker
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()))
  const [monthAnchor, setMonthAnchor] = useState(() => new Date()) // any date in the displayed month
  const [allJobs, setAllJobs] = useState([])
  const [allPools, setAllPools] = useState([])
  const [allProfiles, setAllProfiles] = useState([])
  const [allStaff, setAllStaff] = useState([])
  // Recent service_records — used both to (a) suppress raw pool
  // projections on days when a pool was already serviced (defensive
  // dedupe even if next_due_at didn't advance) and (b) emit a
  // dimmed "completed" stop on the day a service actually happened
  // so the operator can see what's been done at a glance instead of
  // it just disappearing from the schedule.
  const [serviceDays, setServiceDays] = useState(new Set()) // "<pool_id>:<ymd>" keys
  const [serviceRecords, setServiceRecords] = useState([])  // {pool_id, serviced_at}
  const [loading, setLoading] = useState(true)
  const [selectedStop, setSelectedStop] = useState(null)
  const [overdueListOpen, setOverdueListOpen] = useState(false)
  const toast = useToast()
  const hasLoadedRef = useRef(false)   // spinner only on the FIRST load, not refetches
  const fetchAbortRef = useRef(null)   // latest-request-wins + abort-on-supersede
  const [recurEditProfile, setRecurEditProfile] = useState(null) // recurring profile being edited from a stop
  const [recurModalOpen, setRecurModalOpen] = useState(false)
  const [jobTypes, setJobTypes] = useState([])
  // The desktop week grid caps each day column at MAX_VISIBLE_STOPS_PER_DAY
  // rows. Clicking a day header or the "+N more" link sets this state,
  // which flips the bottom "Today" section into a "selected day"
  // section showing every stop for that day with no cap. Default null
  // means show today (current behaviour). Mobile WeekStack lists every
  // day inline so it doesn't need this.
  const [focusedDay, setFocusedDay] = useState(null)

  // Scroll the bottom day section into view when the operator picks a
  // day from the grid — without this, on a tall page they might not
  // notice the section updating below the fold.
  function focusDay(day) {
    setFocusedDay(day)
    requestAnimationFrame(() => {
      document.getElementById('schedule-day-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  // Filter the grid + today list to a single tech (or 'unassigned') —
  // toggled by clicking a pill in the "On service / Crew" card.
  // null = no filter (show everyone).
  // Crew multi-select: a Set of crew ids ('unassigned' = no crew) that are
  // UNCHECKED/hidden. Empty = all crews shown. A stop renders when its crew
  // isn't hidden. '__all__' clears the set (show all).
  const [hiddenCrews, setHiddenCrews] = useState(() => new Set())
  const toggleCrew = (id) => setHiddenCrews(prev => {
    if (id === '__all__') return new Set()
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Branch multi-select — same shape as the crew filter above. A Set of branch
  // ids ('none' = no branch) that are hidden. Empty = all branches shown.
  const [hiddenBranches, setHiddenBranches] = useState(() => new Set())
  const toggleBranch = (id) => setHiddenBranches(prev => {
    if (id === '__all__') return new Set()
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Job-type templates for the recurring edit modal's picker (same source as
  // the client profile's edit flow).
  useEffect(() => {
    if (!business?.id) return
    supabase
      .from('job_type_templates')
      .select('id, name, color, default_tasks, estimated_duration_minutes, default_price')
      .eq('business_id', business.id).eq('is_active', true)
      .then(({ data }) => setJobTypes(data || []))
  }, [business?.id])

  // Open the SAME recurring-edit modal the client profile uses, in place over
  // the Schedule. Close the Job Details popup, fetch the full profile row, open.
  async function handleEditRecurring(profileId) {
    if (!profileId) return
    setSelectedStop(null)
    const { data, error } = await supabase
      .from('recurring_job_profiles')
      .select('*, pools(name, address)')
      .eq('id', profileId)
      .single()
    if (error || !data) return
    setRecurEditProfile(data)
    setRecurModalOpen(true)
  }

  async function fetchData() {
    if (!business?.id) return
    // Latest-request-wins: abort any in-flight refetch so a slow/hung one can
    // neither clobber newer data nor wedge future refetches.
    if (fetchAbortRef.current) fetchAbortRef.current.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    // Spinner ONLY on the first load. A focus/visibility/nav refetch updates
    // silently — never flash the spinner over already-loaded data (that "refetch
    // flips loading true then hangs" is exactly the circling-loading bug).
    const isInitial = !hasLoadedRef.current
    if (isInitial) setLoading(true)

    // Wide window so prev/next week navigation is cached.
    const from = new Date(); from.setDate(from.getDate() - 60)
    const to = new Date(); to.setDate(to.getDate() + 120)
    const runQueries = () => Promise.all([
      supabase
        .from('jobs')
        .select('*, clients(name, email, phone, branch_id), pools(name, address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .gte('scheduled_date', ymd(from))
        .lte('scheduled_date', ymd(to))
        .order('scheduled_date')
        .order('scheduled_time')
        .abortSignal(controller.signal),
      supabase
        .from('pools')
        .select('*, clients(name, email, phone, branch_id), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .abortSignal(controller.signal),
      supabase
        .from('recurring_job_profiles')
        .select('*, clients(name, email, phone, branch_id), pools(name, address, latitude, longitude), staff:staff_members!assigned_staff_id(id, name, photo_url)')
        .eq('business_id', business.id)
        .eq('is_active', true)
        .abortSignal(controller.signal),
      supabase
        .from('staff_members')
        .select('id, name, photo_url, is_active')
        .eq('business_id', business.id)
        .eq('is_active', true)
        .abortSignal(controller.signal),
      // Completed/unable services in the window — suppress pool projections on
      // serviced days and emit the dim/orange stop; record id lets StopDetailModal
      // hard-delete a completed stop.
      supabase
        .from('service_records')
        .select('id, pool_id, serviced_at, status, unable_reason, recurring_profile_id, occurrence_date, is_one_off')
        .eq('business_id', business.id)
        .in('status', ['completed', 'unable_to_service'])
        .gte('serviced_at', from.toISOString())
        .lte('serviced_at', to.toISOString())
        .abortSignal(controller.signal),
    ])

    const started = Date.now()
    try {
      let res
      try {
        res = await runQueries()
      } catch (err) {
        if (fetchAbortRef.current !== controller) throw err // superseded — let outer catch ignore
        // Fast blip on a BACKGROUND refetch → one silent retry. A slow (~timeout)
        // failure is NOT retried — another 30s is worse than showing stale data.
        if (!isInitial && Date.now() - started < 5000) res = await runQueries()
        else throw err
      }
      if (fetchAbortRef.current !== controller) return // a newer refetch owns the state now
      const [jobsRes, poolsRes, profilesRes, staffRes, servicesRes] = res
      setAllJobs(jobsRes.data || [])
      setAllPools(poolsRes.data || [])
      setAllProfiles(profilesRes.data || [])
      setAllStaff(staffRes.data || [])
      setServiceRecords(servicesRes.data || [])
      // Build a set of "<pool_id>:<ymd>" keys for fast lookup in the projector.
      const days = new Set()
      for (const r of servicesRes.data || []) {
        if (!r.pool_id || !r.serviced_at) continue
        const d = new Date(r.serviced_at)
        if (isNaN(d.getTime())) continue
        days.add(`${r.pool_id}:${ymd(d)}`)
      }
      setServiceDays(days)
      hasLoadedRef.current = true
    } catch (err) {
      if (fetchAbortRef.current !== controller) return // superseded/aborted — ignore silently
      if (isInitial) {
        console.warn('Schedule load failed:', err?.message || err)
      } else {
        // A real background-refetch failure → keep the last-loaded data, tell the
        // operator quietly. Never an infinite spinner (isInitial is false here).
        toast.error('Couldn’t refresh — showing last loaded data.')
      }
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null
      if (isInitial) setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [business?.id, location.key])

  // Refetch when the tab comes back into focus. Owner is in another tab
  // while a tech completes a service; coming back here should show the
  // updated schedule without a manual reload.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') fetchData()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id])

  // Build a Map<ymdKey, Stop[]> for the visible 7-day window.
  // Active date range — the visible week (week/day views) or the month grid
  // (month view: a Monday-aligned 6-week block). The projection runs over this.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === 'month') {
      const gridStart = getMondayOfWeek(startOfMonth(monthAnchor))
      return { rangeStart: gridStart, rangeEnd: addDays(gridStart, 41) }
    }
    return { rangeStart: weekStart, rangeEnd: addDays(weekStart, 6) }
  }, [view, weekStart, monthAnchor])

  const stopsByDay = useMemo(() => {
    // Alias the active range onto the projection's existing week vars so the
    // body below is unchanged whether we're showing a week or a month.
    const weekStart = rangeStart
    const weekEnd = rangeEnd
    weekEnd.setHours(23, 59, 59, 999)

    // Today (midnight local) — used by path 3 to flag missed in-grid occurrences
    // red on their own day, and by path 4's day-view catch-up.
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const byDay = new Map()
    const ensure = (d) => {
      const key = ymd(d)
      if (!byDay.has(key)) byDay.set(key, { date: new Date(d), stops: [] })
      return byDay.get(key)
    }
    for (let d = new Date(weekStart); d <= weekEnd; d = addDays(d, 1)) ensure(new Date(d))

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

    // Identity: which occurrences each profile has already fulfilled (a
    // completed/unable record carrying recurring_profile_id + occurrence_date).
    // Path 1b renders these on their occurrence day; paths 3/4 suppress them.
    const fulfilledByProfile = new Map()
    for (const r of serviceRecords) {
      if (!r.recurring_profile_id || !r.occurrence_date) continue
      const k = String(r.occurrence_date).split('T')[0]
      if (!fulfilledByProfile.has(r.recurring_profile_id)) fulfilledByProfile.set(r.recurring_profile_id, new Set())
      fulfilledByProfile.get(r.recurring_profile_id).add(k)
    }

    // 1. Real jobs
    for (const j of allJobs) {
      if (!j.scheduled_date) continue
      const d = new Date(j.scheduled_date + 'T00:00:00')
      if (d < weekStart || d > weekEnd) continue
      ensure(d).stops.push(jobToStop(j))
      coverPool(d, j.pool_id)
    }

    // 1b. Completed / unable-to-service records. Emitted BEFORE the pool and
    // profile projections (paths 2/3) so a serviced or unable day wins over
    // their "already serviced — suppress" coverage. Otherwise the stop the
    // operator wants to SEE (dim completed / orange unable) gets pre-empted
    // by that coverage and the day renders blank. Skipped only when a real
    // job (path 1) already covered the pool for that day.
    const poolById = new Map()
    for (const p of allPools) poolById.set(p.id, p)
    for (const r of serviceRecords) {
      if (!r.pool_id) continue
      // Render on the OCCURRENCE day for recurring records — a visit serviced
      // early/late stays on its scheduled day (one occurrence, one visual).
      // Ad-hoc records (no occurrence_date) render on the actual serviced day.
      const renderYmd = r.occurrence_date
        ? String(r.occurrence_date).split('T')[0]
        : (r.serviced_at ? ymd(new Date(r.serviced_at)) : null)
      if (!renderYmd) continue
      const d = new Date(renderYmd + 'T00:00:00')
      if (isNaN(d.getTime())) continue
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      if (dayStart < weekStart || dayStart > weekEnd) continue
      // A one-off / ad-hoc record (null occurrence identity) fulfils no occurrence:
      // it must neither be hidden by, nor hide, a recurring stop on the same day.
      // So it always renders and never participates in coverage. Only an
      // identity-bearing (recurring) record dedupes against / contributes to coverage.
      const hasIdentity = !!r.recurring_profile_id
      if (hasIdentity && isPoolCovered(dayStart, r.pool_id)) continue
      const pool = poolById.get(r.pool_id)
      if (!pool) continue
      // Unable records render orange (and stay prominent); completed render dim.
      const isUnable = r.status === 'unable_to_service'
      const stop = poolToStop(
        { ...pool, next_due_at: d.toISOString() }, /* single-writer-ok: in-memory projection to poolToStop, not a DB write */
        {
          isUnable,
          isCompleted: !isUnable,
          serviceRecordId: r.id,
          recurringProfileId: r.recurring_profile_id || null,
          occurrenceDate: r.occurrence_date ? String(r.occurrence_date).split('T')[0] : null,
          servicedAt: r.serviced_at || null,
          isOneOff: !!r.is_one_off,
        }
      )
      ensure(dayStart).stops.push(stop)
      if (hasIdentity) coverPool(dayStart, r.pool_id)
    }

    // 2. (Removed.) Legacy pool-level projection — pools.next_due_at +
    // schedule_frequency projected independently of any profile — is gone.
    // Pools no longer carry their own schedule; every schedule is a recurring
    // profile (projected by path 3), and an overdue profiled pool surfaces
    // from the next_due_at cache via path 4.

    // 3. Recurring job profile projections
    const takenByProfile = new Map()
    // jobs.replaces_recurring_date carries the link from a moved job
    // back to the original projection date it replaced. Build a per-
    // profile set of those dates so the projector skips them — that's
    // what makes "moving an occurrence" not duplicate, and "deleting
    // the moved job" naturally restores the original date (the job's
    // replaces_recurring_date is gone with it).
    const replacedByProfile = new Map()
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
      if (j.recurring_profile_id && j.replaces_recurring_date) {
        // DB date columns come back as 'YYYY-MM-DD' strings via PostgREST.
        const dateStr = typeof j.replaces_recurring_date === 'string'
          ? j.replaces_recurring_date.split('T')[0]
          : null
        if (dateStr) {
          if (!replacedByProfile.has(j.recurring_profile_id)) replacedByProfile.set(j.recurring_profile_id, new Set())
          replacedByProfile.get(j.recurring_profile_id).add(dateStr)
        }
      }
    }
    for (const profile of allProfiles) {
      if (!isProfileActive(profile)) continue

      // occurrencesInRange covers two rule shapes:
      //   - cadence interval (weekly / fortnightly / 6_weekly / quarterly /
      //     legacy monthly / custom): walks anchor by interval days
      //   - monthly with monthly_week_of_month: computes Nth weekday of
      //     each month touching the range
      const occurrences = occurrencesInRange(profile, weekStart, weekEnd)
      const fulfilled = fulfilledByProfile.get(profile.id)
      let occurrenceIdx = 0
      for (const cursor of occurrences) {
        if (!isOccurrenceInRange(profile, cursor, occurrenceIdx)) break
        const key = ymd(cursor)
        const taken = takenByProfile.get(profile.id)
        const replaced = replacedByProfile.get(profile.id)
        const isReplaced = replaced && replaced.has(key)
        if (!isReplaced && (!taken || !taken.has(key))) {
          if (!isPoolCovered(cursor, profile.pool_id)) {
            if (fulfilled && fulfilled.has(key)) {
              // Already fulfilled (completed/unable) — path 1b renders it on this
              // day as the completed/unable stop, so suppress the due projection.
              coverPool(cursor, profile.pool_id)
            } else {
              // An unfulfilled occurrence whose day is already past = a MISSED
              // visit — render it red on its own day (not relocated to today).
              const cStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
              const overdueOpts = cStart < startOfToday
                ? { isOverdue: true, daysOverdue: Math.max(Math.round((startOfToday - cStart) / 86400000), 1) }
                : undefined
              ensure(cursor).stops.push(profileToStop(profile, cursor, overdueOpts))
              coverPool(cursor, profile.pool_id)
            }
          }
        }
        occurrenceIdx++
      }
    }

    // 4. Overdue — per active profile, the earliest PAST occurrence that isn't
    // fulfilled (identity), skipped (occurrencesInRange already drops those),
    // moved (replaced) or already materialized (taken). One stop per profile,
    // surfaced under today — so stacked profiles overdue on different days each
    // surface. Derived from ENUMERATION, never from the next_due_at cache.
    // Only the DAY work-list (a flat list with nowhere else to surface an old
    // miss) stacks overdue under today. Month & Week are calendars — their misses
    // now render red in place via path 3, so relocating to today would double up.
    if (view === 'day' && startOfToday >= weekStart && startOfToday <= weekEnd) {
      const todayGroup = byDay.get(ymd(now))
      if (todayGroup) {
        const overdueFrom = new Date(startOfToday); overdueFrom.setDate(overdueFrom.getDate() - 365)
        // Profiles already represented today (due / completed / unable) — don't double.
        const shownToday = new Set(todayGroup.stops.filter(s => s.recurring_profile_id).map(s => s.recurring_profile_id))
        for (const profile of allProfiles) {
          if (!isProfileActive(profile) || !profile.pool_id) continue
          if (shownToday.has(profile.id)) continue
          const fulfilled = fulfilledByProfile.get(profile.id)
          const taken = takenByProfile.get(profile.id)
          const replaced = replacedByProfile.get(profile.id)
          let overdueOcc = null
          for (const cursor of occurrencesInRange(profile, overdueFrom, weekStart)) {
            const cs = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
            if (cs >= weekStart) break // only occurrences BEFORE the visible week — in-week ones already render via path 3
            const key = ymd(cursor)
            if ((fulfilled && fulfilled.has(key)) || (taken && taken.has(key)) || (replaced && replaced.has(key))) continue
            overdueOcc = cursor; break // earliest unfulfilled past occurrence
          }
          if (!overdueOcc) continue
          const pool = poolById.get(profile.pool_id)
          if (!pool) continue
          const occStart = new Date(overdueOcc.getFullYear(), overdueOcc.getMonth(), overdueOcc.getDate())
          const daysOver = Math.max(Math.round((startOfToday - occStart) / 86400000), 1)
          todayGroup.stops.unshift(poolToStop(pool, {
            isOverdue: true,
            daysOverdue: daysOver,
            recurringProfileId: profile.id,
            occurrenceDate: ymd(overdueOcc),
          }))
          shownToday.add(profile.id)
        }
      }
    }

    // (Completed / unable-to-service service-record stops are projected as
    // path 1b above, before the pool/profile projections.)

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
  }, [allJobs, allPools, allProfiles, rangeStart, rangeEnd, serviceDays, serviceRecords, view])

  // ARCHITECTURAL INVARIANT: an occurrence is overdue iff it has no covering service
  // record (completed OR unable, matched by coverage) — never by the next_due_at cache.
  //
  // Individual overdue VISITS (occurrences), grid-independent. An occurrence is
  // overdue iff it has no COVERING service record — completed OR unable, matched by
  // the same path-1b coverage the calendar uses (render on occurrence_date, else
  // serviced_at), NOT by the next_due_at cache. That's what lets a marked-unable day
  // drop off even when its record lost its occurrence_date (audit #3). Look-back is
  // capped to fetchData's loaded window (today−60d) — coverage data doesn't exist
  // beyond it, so a visit overdue by >60d is deliberately not surfaced here.
  const overdueVisits = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const from = new Date(today); from.setDate(from.getDate() - 60)

    // pool-day coverage from identity-bearing service records (mirrors path 1b).
    const coveredDayPool = new Set()
    for (const r of serviceRecords) {
      if (!r.pool_id || !r.recurring_profile_id) continue
      const ry = r.occurrence_date
        ? String(r.occurrence_date).split('T')[0]
        : (r.serviced_at ? ymd(new Date(r.serviced_at)) : null)
      if (ry) coveredDayPool.add(`${ry}|${r.pool_id}`)
    }
    // jobs materialized from a profile occupy / move that occurrence (mirrors path 3).
    const takenByProfile = new Map()
    const replacedByProfile = new Map()
    for (const j of allJobs) {
      if (j.recurring_profile_id && j.scheduled_date) {
        if (!takenByProfile.has(j.recurring_profile_id)) takenByProfile.set(j.recurring_profile_id, new Set())
        takenByProfile.get(j.recurring_profile_id).add(j.scheduled_date)
      }
      if (j.recurring_profile_id && j.replaces_recurring_date) {
        const ds = typeof j.replaces_recurring_date === 'string' ? j.replaces_recurring_date.split('T')[0] : null
        if (ds) {
          if (!replacedByProfile.has(j.recurring_profile_id)) replacedByProfile.set(j.recurring_profile_id, new Set())
          replacedByProfile.get(j.recurring_profile_id).add(ds)
        }
      }
    }

    const rows = []
    for (const profile of allProfiles) {
      if (!isProfileActive(profile) || !profile.pool_id) continue
      const taken = takenByProfile.get(profile.id)
      const replaced = replacedByProfile.get(profile.id)
      let idx = 0
      for (const cursor of occurrencesInRange(profile, from, today)) {
        if (!isOccurrenceInRange(profile, cursor, idx)) break
        const cs = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
        if (cs < today) {
          const key = ymd(cursor)
          const excluded = (replaced && replaced.has(key))
            || (taken && taken.has(key))
            || coveredDayPool.has(`${key}|${profile.pool_id}`)
          if (!excluded) {
            rows.push({ profile, occurrenceDate: cursor, daysOverdue: Math.max(Math.round((today - cs) / 86400000), 1) })
          }
        }
        idx++
      }
    }
    rows.sort((a, b) => b.daysOverdue - a.daysOverdue)
    return rows
  }, [allProfiles, allJobs, serviceRecords])

  // Days in the active range (7 for week/day, ~42 for the month grid).
  const periodDays = useMemo(() => {
    const days = []
    for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) days.push(new Date(d))
    return days
  }, [rangeStart, rangeEnd])

  const today = new Date()
  const todayStops = stopsByDay.get(ymd(today)) || []

  // All stops across the visible 7-day window — flat array, used for the
  // week-scope "Crew this week" tally.
  const allWeekStops = useMemo(() => {
    const out = []
    for (const stops of stopsByDay.values()) out.push(...stops)
    return out
  }, [stopsByDay])

  // Apply the crew checkboxes to the grid + today list. The crew card always
  // sees the unfiltered set so every crew stays toggleable.
  // A stop is hidden when its crew's checkbox is unchecked.
  const stopMatchesFilter = (s) =>
    !hiddenCrews.has(s.assigned_staff_id || 'unassigned') &&
    !hiddenBranches.has(s.branch_id || 'none')
  const filteredStopsByDay = useMemo(() => {
    if (hiddenCrews.size === 0 && hiddenBranches.size === 0) return stopsByDay
    const filtered = new Map()
    for (const [k, stops] of stopsByDay.entries()) {
      filtered.set(k, stops.filter(stopMatchesFilter))
    }
    return filtered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsByDay, hiddenCrews, hiddenBranches])
  const filteredTodayStops = useMemo(
    () => todayStops.filter(stopMatchesFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayStops, hiddenCrews, hiddenBranches],
  )

  const weekEnd = addDays(weekStart, 6)
  const isThisWeek = sameYMD(weekStart, getMondayOfWeek(new Date()))

  // Always open the StopDetailModal — including for real jobs. The
  // older behaviour routed real jobs to /work-orders/:id, but that
  // surfaced as a bug when an operator moved a recurring projection
  // (which materialises into a real job): clicking the same card on
  // the new date suddenly navigated away instead of opening the
  // familiar quick-edit modal. The modal handles real jobs fine —
  // Edit Job + Delete + the same field set as a projected stop. If
  // the operator wants the full work-order surface, they still go
  // there explicitly via Work Orders in the nav.
  function handleStopSelect(stop) {
    // Unable-to-service markers go straight to the read-only service detail
    // (reason, photos, customer contact) — there's nothing to reschedule
    // here, and the edit modal doesn't apply to a synthetic unable stop.
    if (stop?.isUnable && stop.service_record_id) {
      navigate(`/services/${stop.service_record_id}`)
      return
    }
    setSelectedStop(stop)
  }

  // Eyebrow + title vary by view
  const eyebrowLabel = view === 'map' ? 'Map view' : view === 'day' ? 'Day view' : view === 'month' ? 'Month view' : 'Week view'
  const heroTitle = view === 'day'
    ? today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : view === 'month'
      ? monthAnchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
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
                isCurrent={view === 'month' ? isSameMonth(monthAnchor, new Date()) : isThisWeek}
                label={view === 'month' ? 'This month' : 'This week'}
                onPrev={view === 'month' ? () => setMonthAnchor(d => addMonths(d, -1)) : () => setWeekStart(d => addDays(d, -7))}
                onCurrent={view === 'month' ? () => setMonthAnchor(new Date()) : () => setWeekStart(getMondayOfWeek(new Date()))}
                onNext={view === 'month' ? () => setMonthAnchor(d => addMonths(d, 1)) : () => setWeekStart(d => addDays(d, 7))}
              />
            )}
            <ViewToggle view={view} setView={setView} />
          </div>
        }
      />
      <OneOffVisitPicker open={oneOffOpen} onClose={() => setOneOffOpen(false)} />

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Button variant="primary" size="md" leftIcon={Plus} onClick={() => setOneOffOpen(true)} className="w-full sm:w-auto">
          Service a one-off visit
        </Button>
        {(view === 'month' || view === 'week') && overdueVisits.length > 0 && (
          <button
            type="button"
            onClick={() => setOverdueListOpen(true)}
            title="View overdue visits"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/50 px-3 py-1.5 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {overdueVisits.length} overdue visit{overdueVisits.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {view === 'map' ? (
        <MapView pools={allPools} onSelect={handleStopSelect} />
      ) : loading ? (
        <LoadingSpinner />
      ) : view === 'day' ? (
        <>
          {todayStops.length > 0 && (
            <TechsOnService stops={todayStops} allStaff={allStaff} scope="day" hiddenCrews={hiddenCrews} onToggle={toggleCrew} />
          )}
          {todayStops.length > 0 && branches.length > 0 && (
            <BranchFilter stops={todayStops} branches={branches} scope="day" hiddenBranches={hiddenBranches} onToggle={toggleBranch} />
          )}
          <TodayList stops={filteredTodayStops} onStopSelect={handleStopSelect} variant="standalone" />
        </>
      ) : view === 'month' ? (
        <>
          <MonthGrid
            monthDays={periodDays}
            monthAnchor={monthAnchor}
            stopsByDay={filteredStopsByDay}
            onStopSelect={handleStopSelect}
            onDrillToWeek={(day) => { setWeekStart(getMondayOfWeek(day)); setView('week') }}
          />
          {allWeekStops.length > 0 && (
            <TechsOnService stops={allWeekStops} allStaff={allStaff} scope="month" hiddenCrews={hiddenCrews} onToggle={toggleCrew} />
          )}
          {allWeekStops.length > 0 && branches.length > 0 && (
            <BranchFilter stops={allWeekStops} branches={branches} scope="month" hiddenBranches={hiddenBranches} onToggle={toggleBranch} />
          )}
        </>
      ) : (
        <>
          {/* Desktop: 7-column grid */}
          <div className="hidden md:block">
            <WeekGrid weekDays={periodDays} stopsByDay={filteredStopsByDay} onStopSelect={handleStopSelect} onFocusDay={focusDay} />
          </div>
          {/* Mobile: stacked-by-day list */}
          <div className="md:hidden">
            <WeekStack weekDays={periodDays} stopsByDay={filteredStopsByDay} onStopSelect={handleStopSelect} />
          </div>
          {allWeekStops.length > 0 && (
            <TechsOnService stops={allWeekStops} allStaff={allStaff} scope="week" hiddenCrews={hiddenCrews} onToggle={toggleCrew} />
          )}
          {allWeekStops.length > 0 && branches.length > 0 && (
            <BranchFilter stops={allWeekStops} branches={branches} scope="week" hiddenBranches={hiddenBranches} onToggle={toggleBranch} />
          )}
          {/* Selected-day list. Default = today; clicking a day header
              or "+N more" in the week grid flips this section to that
              day instead so all its stops are visible inline (no cap,
              no modal). Mobile's WeekStack already lists everything
              by day so this section stays desktop-only. */}
          <div className="hidden md:block" id="schedule-day-section">
            {(() => {
              const today = new Date()
              const isFocusedToday = focusedDay && sameYMD(focusedDay, today)
              const showDay = focusedDay || today
              const showStops = focusedDay
                ? (filteredStopsByDay.get(ymd(focusedDay)) || [])
                : filteredTodayStops
              const heading = focusedDay && !isFocusedToday
                ? showDay.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })
                : 'Today'
              const emptyText = focusedDay && !isFocusedToday
                ? `Nothing scheduled for ${showDay.toLocaleDateString('en-AU', { weekday: 'long' })}.`
                : undefined
              return (
                <TodayList
                  stops={showStops}
                  onStopSelect={handleStopSelect}
                  heading={heading}
                  emptyText={emptyText}
                  onClearFocus={focusedDay && !isFocusedToday ? () => setFocusedDay(null) : null}
                />
              )
            })()}
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
        branches={branches}
        onEditRecurring={handleEditRecurring}
      />

      <Modal open={overdueListOpen} onClose={() => setOverdueListOpen(false)} title="Overdue visits" size="sm">
        <div className="space-y-2">
          {overdueVisits.map(({ profile, occurrenceDate, daysOverdue }) => (
            <button
              key={`${profile.id}-${ymd(occurrenceDate)}`}
              type="button"
              onClick={() => { setOverdueListOpen(false); handleStopSelect(profileToStop(profile, occurrenceDate, { isOverdue: true, daysOverdue })) }}
              className="w-full text-left rounded-xl border border-gray-100 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{profile.clients?.name || 'Client'}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {(profile.pools?.name || 'Pool')} · {occurrenceDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded-full px-2.5 py-1">
                {daysOverdue}d overdue
              </span>
            </button>
          ))}
        </div>
      </Modal>

      <AddRecurringModal
        open={recurModalOpen}
        onClose={() => { setRecurModalOpen(false); setRecurEditProfile(null) }}
        business={business}
        staff={allStaff}
        jobTypes={jobTypes}
        editProfile={recurEditProfile}
        onCreated={() => { setRecurModalOpen(false); setRecurEditProfile(null); fetchData() }}
      />
    </PageWrapper>
  )
}

// ─── Prev / This week / Next — three separate rounded-full pills ──────
function NavPills({ isCurrent, label = 'This week', onPrev, onCurrent, onNext }) {
  const pillBase = 'inline-flex items-center gap-1 px-3.5 h-9 rounded-full text-sm font-medium transition-colors border'
  const idle = 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-card'
  const activeNow = 'bg-pool-50 dark:bg-pool-950/40 border-pool-200/70 dark:border-pool-800/40 text-pool-700 dark:text-pool-300 shadow-card'
  return (
    <div className="inline-flex items-center gap-2 shrink-0">
      <button onClick={onPrev} className={cn(pillBase, idle)}>
        <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        Prev
      </button>
      <button onClick={onCurrent} className={cn(pillBase, isCurrent ? activeNow : idle)}>
        {label}
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
      <button onClick={() => setView('month')} className={cn(base, view === 'month' ? active : inactive)} aria-pressed={view === 'month'}>
        Month
      </button>
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

// Each desktop day column renders at most this many stops inline; the
// rest sit behind a "+N more" link that opens the focused day modal.
// 8 was chosen so a day with one extra stop (9) still gets the link
// (preferring "+1 more" over forcing the +1 to wrap into the column
// and balloon every column's height by one row).
const MAX_VISIBLE_STOPS_PER_DAY = 8

// ─── Week grid (7 day columns) ─────────────────
function WeekGrid({ weekDays, stopsByDay, onStopSelect, onFocusDay }) {
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
              onFocusDay={onFocusDay}
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
  // Client name leads the title (see TodayRow). Address goes in subtitle.
  const titleText = stop.client_name
    ? `${stop.client_name} · ${stop.title}`
    : stop.title
  const isDone = stop.status === 'completed'
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors border-l-[3px]',
        meta.accent,
        isDone && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <p className="tabular-nums text-[12px] font-semibold text-pool-700 dark:text-pool-400 w-12 shrink-0 leading-tight pt-0.5">
          {time || '—'}
        </p>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate',
            (stop.status === 'cancelled' || isDone) && 'line-through text-gray-500',
          )}>
            {titleText}
          </p>
          {stop.pool_name && (
            <p className={cn(
              'text-[11.5px] font-medium text-gray-600 dark:text-gray-300 truncate mt-0.5',
              isDone && 'line-through',
            )}>
              {stop.pool_name}
            </p>
          )}
          {stop.address && (
            <p className={cn(
              'text-[11.5px] text-gray-500 dark:text-gray-400 truncate mt-0.5',
              isDone && 'line-through',
            )}>
              {stop.address}
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

function DayColumn({ day, stops, isToday, onStopSelect, onFocusDay }) {
  const dow = day.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()
  // Slice for inline rendering. If there's exactly one extra stop past
  // the cap, prefer "+1 more" over showing 9 inline — keeps every
  // column the same max height regardless of the busy day.
  const visible = stops.slice(0, MAX_VISIBLE_STOPS_PER_DAY)
  const hiddenCount = Math.max(0, stops.length - visible.length)
  const stopCount = stops.length
  return (
    <div className="min-h-[220px] flex flex-col">
      {/* Header is a button when there are stops, so clicking the date
          opens the focused day view directly. Plain div when empty so
          we don't dangle a useless click target. */}
      {stopCount > 0 ? (
        <button
          type="button"
          onClick={() => onFocusDay?.(day)}
          className={cn(
            'text-left px-3 py-2 border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50',
            isToday && 'bg-pool-50/60 dark:bg-pool-950/20',
          )}
          aria-label={`Open all ${stopCount} stops for ${day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              'text-[10px] font-semibold uppercase tracking-wider',
              isToday ? 'text-pool-700 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500'
            )}>{dow}</p>
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-bold tabular-nums text-gray-600 dark:text-gray-400">
              {stopCount}
            </span>
          </div>
          <p className={cn(
            'text-2xl font-bold leading-none mt-0.5',
            isToday ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100'
          )}>
            {day.getDate()}
          </p>
        </button>
      ) : (
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
      )}
      <div className="p-1.5 space-y-1 flex-1">
        {visible.length === 0 ? (
          <p className="text-center text-gray-300 dark:text-gray-700 text-sm py-6 select-none">—</p>
        ) : (
          <>
            {visible.map(stop => (
              <EventCard key={stop.id} stop={stop} onClick={() => onStopSelect(stop)} />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => onFocusDay?.(day)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-semibold text-pool-600 dark:text-pool-400 hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors"
              >
                +{hiddenCount} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Month grid (6-week Monday-aligned block) ──
// Compact: each day shows up to 3 stops as "name · pool" chips; click a chip to
// open the stop, click the day number / "+N more" to drill into that week.
function MonthChip({ stop, onClick }) {
  const meta = statusMeta(stop)
  const isDone = stop.status === 'completed'
  return (
    <button
      onClick={onClick}
      title={`${stop.client_name || stop.title}${stop.pool_name ? ' · ' + stop.pool_name : ''}`}
      className={cn(
        'block w-full text-left rounded border-l-2 px-1.5 py-0.5 text-[10.5px] leading-tight truncate',
        meta.accent, meta.cardBg, isDone && 'opacity-50 line-through',
      )}
    >
      <span className="font-semibold text-gray-900 dark:text-gray-100">{stop.client_name || stop.title}</span>
      {stop.pool_name && <span className="text-gray-500 dark:text-gray-400"> · {stop.pool_name}</span>}
    </button>
  )
}

function MonthGrid({ monthDays, monthAnchor, stopsByDay, onStopSelect, onDrillToWeek }) {
  const curMonth = monthAnchor.getMonth()
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const CAP = 3
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-card border border-gray-100 dark:border-gray-800 overflow-hidden mb-4">
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800">
        {dows.map(d => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthDays.map(day => {
          const stops = stopsByDay.get(ymd(day)) || []
          const inMonth = day.getMonth() === curMonth
          const isToday = sameYMD(day, new Date())
          return (
            <div
              key={ymd(day)}
              className={cn(
                'min-h-[96px] p-1.5 border-b border-r border-gray-100 dark:border-gray-800',
                !inMonth && 'bg-gray-50/60 dark:bg-gray-900/40',
              )}
            >
              <button
                onClick={() => onDrillToWeek && onDrillToWeek(day)}
                className={cn(
                  'mb-1 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-semibold transition-colors',
                  isToday ? 'bg-pool-500 text-white hover:bg-pool-600'
                    : inMonth ? 'text-gray-700 dark:text-gray-300 hover:bg-pool-50 dark:hover:bg-pool-950/40'
                    : 'text-gray-300 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800',
                )}
              >
                {day.getDate()}
              </button>
              <div className="space-y-1">
                {stops.slice(0, CAP).map(s => (
                  <MonthChip key={s.id} stop={s} onClick={() => onStopSelect(s)} />
                ))}
                {stops.length > CAP && (
                  <button
                    onClick={() => onDrillToWeek && onDrillToWeek(day)}
                    className="block px-1 text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-pool-500"
                  >
                    +{stops.length - CAP} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EventCard({ stop, onClick }) {
  const meta = statusMeta(stop)
  const time = stop.scheduled_time ? stop.scheduled_time.slice(0, 5) : null
  // Client name leads the title (see TodayRow / StackRow). Address —
  // the most operationally useful info — falls into the subtitle.
  const titleText = stop.client_name
    ? `${stop.client_name} · ${stop.title}`
    : stop.title
  const sub = stop.address || (stop.client_name ? null : null)
  const isDone = stop.status === 'completed'
  // For a recurring visit serviced off its scheduled day, note the actual day.
  const servedNote = (() => {
    if (!stop.serviced_at || !stop.occurrence_date) return null
    const sd = new Date(stop.serviced_at)
    if (isNaN(sd.getTime())) return null
    const sdYmd = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`
    const occ = String(stop.occurrence_date).split('T')[0]
    if (occ === sdYmd) return null
    return `serviced ${sdYmd < occ ? 'early' : 'late'}: ${sd.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`
  })()
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full text-left rounded-md border-l-[3px] px-2 py-1.5 transition-colors',
        meta.accent,
        meta.cardBg,
        // Completed stops dim out so the day's done work fades into
        // the background and what's outstanding stays prominent.
        isDone && 'opacity-50',
      )}
    >
      {time && (
        <p className="tabular-nums text-[10.5px] text-gray-600 dark:text-gray-400 leading-none">{time}</p>
      )}
      <p className={cn(
        'text-[12px] font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate mt-0.5',
        (stop.status === 'cancelled' || isDone) && 'line-through text-gray-500 dark:text-gray-500',
      )}>
        {titleText}
      </p>
      {stop.pool_name && (
        <p className={cn(
          'text-[10.5px] font-medium text-gray-600 dark:text-gray-300 leading-tight truncate',
          isDone && 'line-through',
        )}>{stop.pool_name}</p>
      )}
      {servedNote && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">{servedNote}</p>
      )}
      {stop.is_one_off && (
        <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 leading-tight truncate">Extra visit</p>
      )}
      {sub && (
        <p className={cn(
          'text-[10.5px] text-gray-500 dark:text-gray-400 leading-tight truncate',
          isDone && 'line-through',
        )}>{sub}</p>
      )}
    </button>
  )
}

// ─── Crew filter (multi-select checkboxes) ──
// Lists every active crew + a "No crew" row, each with a checkbox + stop count
// for the active period (today / week / month). Unchecking hides that crew's
// stops from the grid + lists. Default: all checked. hiddenCrews / onToggle drive it.
function TechsOnService({ stops, allStaff = [], scope = 'day', hiddenCrews, onToggle }) {
  const counts = new Map()
  let unassigned = 0
  for (const stop of stops) {
    if (stop.assigned_staff_id) counts.set(stop.assigned_staff_id, (counts.get(stop.assigned_staff_id) || 0) + 1)
    else unassigned += 1
  }
  // List every technician created in settings (so any can be toggled even with
  // no stops this period); plus an "Unassigned" row. Busiest first, then by name.
  const crews = allStaff
    .filter(s => s.is_active !== false)
    .map(s => ({ id: s.id, name: s.name || 'Tech', photo: s.photo_url, count: counts.get(s.id) || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  if (crews.length === 0 && unassigned === 0) return null

  const totalStops = stops.length
  const eyebrowLabel = scope === 'week' ? 'Technicians this week' : scope === 'month' ? 'Technicians this month' : 'Technicians today'

  function CrewItem({ id, name, count, avatar, amber }) {
    const checked = !hiddenCrews.has(id)
    return (
      <label className={cn(
        'inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border cursor-pointer transition-colors select-none',
        checked
          ? 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700'
          : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 opacity-55',
      )}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(id)}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500/30"
        />
        {avatar || <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', amber ? 'bg-amber-400' : 'bg-gray-300')} />}
        <span className="text-sm font-semibold leading-none text-gray-900 dark:text-gray-100">{name}</span>
        <span className="text-xs tabular-nums leading-none text-gray-500 dark:text-gray-400">· {count}</span>
      </label>
    )
  }

  return (
    <Card className="!p-0 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
          <Users className="w-3.5 h-3.5" strokeWidth={2.5} />
          {eyebrowLabel}
        </p>
        <div className="flex items-center gap-2">
          {hiddenCrews.size > 0 && (
            <button
              onClick={() => onToggle('__all__')}
              className="px-2 h-6 rounded-full bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 text-[10.5px] font-semibold uppercase tracking-wider hover:bg-pool-100 transition-colors"
            >
              Show all
            </button>
          )}
          <span className="inline-flex items-center justify-center min-w-[24px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
            {totalStops}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2">
        {crews.map(c => (
          <CrewItem key={c.id} id={c.id} name={c.name.split(' ')[0]} count={c.count} avatar={<TechAvatar photo={c.photo} name={c.name} />} />
        ))}
        <CrewItem id="unassigned" name="Unassigned" count={unassigned} amber />
      </div>
    </Card>
  )
}

// ─── Branch filter (multi-select checkboxes) ──
// Mirrors TechsOnService: one row per branch + a "No branch" row, each with a
// checkbox + stop count for the active period. Unchecking hides that branch's
// stops. Only shown when the business has at least one branch.
function BranchFilter({ stops, branches = [], scope = 'day', hiddenBranches, onToggle }) {
  const counts = new Map()
  let none = 0
  for (const stop of stops) {
    if (stop.branch_id) counts.set(stop.branch_id, (counts.get(stop.branch_id) || 0) + 1)
    else none += 1
  }
  const rows = branches
    .map(b => ({ id: b.id, name: b.name || 'Branch', count: counts.get(b.id) || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  if (rows.length === 0) return null

  const totalStops = stops.length
  const eyebrowLabel = scope === 'week' ? 'Branches this week' : scope === 'month' ? 'Branches this month' : 'Branches today'

  function BranchItem({ id, name, count }) {
    const checked = !hiddenBranches.has(id)
    return (
      <label className={cn(
        'inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border cursor-pointer transition-colors select-none',
        checked
          ? 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700'
          : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 opacity-55',
      )}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(id)}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500/30"
        />
        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-pool-400" />
        <span className="text-sm font-semibold leading-none text-gray-900 dark:text-gray-100">{name}</span>
        <span className="text-xs tabular-nums leading-none text-gray-500 dark:text-gray-400">· {count}</span>
      </label>
    )
  }

  return (
    <Card className="!p-0 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
          <MapIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
          {eyebrowLabel}
        </p>
        <div className="flex items-center gap-2">
          {hiddenBranches.size > 0 && (
            <button
              onClick={() => onToggle('__all__')}
              className="px-2 h-6 rounded-full bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 text-[10.5px] font-semibold uppercase tracking-wider hover:bg-pool-100 transition-colors"
            >
              Show all
            </button>
          )}
          <span className="inline-flex items-center justify-center min-w-[24px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
            {totalStops}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2">
        {rows.map(r => (
          <BranchItem key={r.id} id={r.id} name={r.name} count={r.count} />
        ))}
        <BranchItem id="none" name="No branch" count={none} />
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
// `heading` defaults to "Today". When the operator clicks a day in the
// week grid, Schedule.jsx flips this section to that day instead and
// passes onClearFocus so a "Back to today" affordance can return them.
// emptyText too so the empty state reads right for the day they're on.
function TodayList({ stops, onStopSelect, variant = 'attached', heading = 'Today', emptyText, onClearFocus }) {
  const fallbackEmpty = variant === 'standalone' ? 'Nothing scheduled today.' : 'Nothing scheduled.'
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5" strokeWidth={2.5} />
          {heading}
        </p>
        <div className="flex items-center gap-2">
          {onClearFocus && (
            <button
              type="button"
              onClick={onClearFocus}
              className="text-[11px] font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300"
            >
              Back to today
            </button>
          )}
          <span className="inline-flex items-center justify-center min-w-[24px] px-2 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
            {stops.length}
          </span>
        </div>
      </div>
      {stops.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {emptyText || fallbackEmpty}
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
  // Client name leads the title — most stops are titled "Pool Service"
  // so the client is the differentiating identifier. Address goes in
  // the subtitle since the operator usually navigates by address.
  const titleText = stop.client_name
    ? `${stop.client_name} · ${stop.title}`
    : stop.title
  const isDone = stop.status === 'completed'
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors',
        isDone && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-4">
        <p className="tabular-nums text-sm text-pool-700 dark:text-pool-400 w-12 shrink-0">
          {time || '—'}
        </p>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-1',
            (stop.status === 'cancelled' || isDone) && 'line-through text-gray-500'
          )}>
            {titleText}
          </p>
          {stop.pool_name && (
            <p className={cn(
              'text-xs font-medium text-gray-600 dark:text-gray-300 line-clamp-1 mt-0.5',
              isDone && 'line-through',
            )}>
              {stop.pool_name}
            </p>
          )}
          {stop.address && (
            <p className={cn(
              'text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5',
              isDone && 'line-through',
            )}>
              {stop.address}
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
      next_due_at: p.next_due_at, schedule_frequency: p.schedule_frequency, /* single-writer-ok: in-memory stop object */
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
                    {pool.name && (
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '2px', lineHeight: 1.3 }}>
                        {pool.name}
                      </div>
                    )}
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
    pool_name: j.pools?.name || null,
    address: j.pools?.address || null,
    status: j.status,
    scheduled_date: j.scheduled_date,
    // Occurrence identity for a materialized RECURRING job (so completing it
    // fulfils its occurrence, not "today"). A moved job fulfils the ORIGINAL
    // occurrence it replaced; an unmoved one fulfils its scheduled date.
    recurring_profile_id: j.recurring_profile_id || null,
    occurrence_date: j.recurring_profile_id
      ? (String(j.replaces_recurring_date || j.scheduled_date || '').split('T')[0] || null)
      : null,
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
    branch_id: j.clients?.branch_id ?? null,
  }
}

function profileToStop(profile, occurrenceDate, { isOverdue = false, daysOverdue = 0 } = {}) {
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
    pool_name: profile.pools?.name || null,
    address: profile.pools?.address || null,
    status: 'scheduled',
    isOverdue,
    daysOverdue,
    scheduled_date: ymd(occurrenceDate),
    recurring_profile_id: profile.id,
    occurrence_date: ymd(occurrenceDate),
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
    branch_id: profile.clients?.branch_id ?? null,
  }
}

function poolToStop(p, { isOverdue = false, daysOverdue = 0, isCompleted = false, isUnable = false, serviceRecordId = null, recurringProfileId = null, occurrenceDate = null, servicedAt = null, isOneOff = false } = {}) {
  const due = p.next_due_at ? new Date(p.next_due_at) : null
  const hh = due ? String(due.getHours()).padStart(2, '0') : null
  const mm = due ? String(due.getMinutes()).padStart(2, '0') : null
  const sortTime = hh && mm ? `${hh}:${mm}` : '09:00'
  // Status precedence: unable > completed > overdue > due. EventCard / row
  // renderers check status === 'completed' for the dim + strike-through
  // styling; 'unable_to_service' renders orange and stays prominent.
  const status = isUnable ? 'unable_to_service' : (isCompleted ? 'completed' : (isOverdue ? 'overdue' : 'due'))
  return {
    type: 'pool',
    // Keyed on the service_record id (when present) so two same-day visits on one
    // pool — e.g. two one-offs, or a one-off alongside a recurring completion —
    // get distinct React keys instead of colliding and dropping one.
    id: isUnable
      ? `unable-${serviceRecordId || `${p.id}-${due ? due.toISOString().slice(0, 10) : ''}`}`
      : (isCompleted ? `completed-${serviceRecordId || `${p.id}-${due ? due.toISOString().slice(0, 10) : ''}`}` : p.id),
    pool_id: p.id,
    client_id: p.client_id,
    title: 'Pool Service',
    client_name: p.clients?.name,
    pool_name: p.name || null,
    address: p.address,
    status,
    next_due_at: p.next_due_at, /* single-writer-ok: in-memory stop object */
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
    isCompleted,
    isUnable,
    service_record_id: serviceRecordId,
    recurring_profile_id: recurringProfileId,
    occurrence_date: occurrenceDate,
    serviced_at: servicedAt,
    tech_name: p.staff?.name || null,
    tech_photo: p.staff?.photo_url || null,
    assigned_staff_id: p.assigned_staff_id || null,
    branch_id: p.clients?.branch_id ?? null,
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
