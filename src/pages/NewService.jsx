import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import { createDraft, listDrafts } from '../lib/pendingDrafts'
import { kickOutbox } from '../lib/outboxProcessor'
import { appendCachedServiceRecord } from '../lib/offlineStore'
import { useBusiness } from '../hooks/useBusiness'
import { useLanguage, translateTaskName, translateUnableReason } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import Badge from '../components/ui/Badge'
import { useToast } from '../contexts/ToastContext'
import { Check, ClipboardList, Mail, Phone, Plus, X } from 'lucide-react'
import {
  getChemicalStatus,
  statusDot,
  formatDate,
  calculateNextDue,
  DEFAULT_TASKS,
  CHEMICAL_UNITS,
  CHEMICAL_LABELS,
  DEFAULT_TARGET_RANGES,
  FREQUENCY_LABELS,
  genId,
  cn,
} from '../lib/utils'

// Step 0 ("Arrival") gates the rest of the flow on a live, GPS+
// timestamp watermarked photo. The tech can't enter chemical readings
// until they've proven they're physically at the pool. Replaces the
// old "pool & test kit" photo that lived inside the chemicals step
// (the one photo we capture is now this arrival photo, taken with the
// test kit visible — same shot, earlier in the flow, and required).
// Flow order: Arrival → Current Readings → Chemicals Added → Tasks →
// Review. STEPS holds translation keys (not display text); the stepper
// renders t(`service.step.${key}`). The step===N render blocks below
// map: 0 arrival, 1 readings, 2 added, 3 tasks, 4 review.
const STEPS = ['arrival', 'readings', 'added', 'tasks', 'review']

const DEFAULT_READINGS = ['ph', 'total_chlorine']

// Free chlorine intentionally absent — the techs only ever record
// total chlorine on this pool round, so the field's been removed
// from the input UI. The CHEMICAL_LABELS entry stays in utils.js
// so historical service records that DO have free_chlorine values
// still render correctly on the detail / portal pages.
const ALL_READING_FIELDS = [
  { key: 'ph', rangeKey: 'ph' },
  { key: 'total_chlorine', rangeKey: 'total_cl' },
  { key: 'alkalinity', rangeKey: 'alk' },
  { key: 'stabiliser', rangeKey: 'stabiliser' },
  { key: 'calcium_hardness', rangeKey: 'calcium' },
  { key: 'salt', rangeKey: 'salt', saltOnly: true },
]

// Readings that render as a slider instead of a free-form number
// input. Constraining to a useful range and a 0.1 step matches what
// the operator actually reads off the test kit and is much faster
// on a phone with one hand. defaultPos is the visual thumb position
// when state is empty — readings stay '' until the operator
// interacts, so we never save a fake measurement.
const SLIDER_FIELDS = {
  ph:             { min: 6.8, max: 8.2, step: 0.1, defaultPos: 7.4 },
  total_chlorine: { min: 0,   max: 3.0, step: 0.1, defaultPos: 1.5 },
}

const UNIT_OPTIONS = CHEMICAL_UNITS.map(u => ({ value: u, label: u }))

// Canonical (English) reasons a tech can't service a pool. Stored as-is in
// service_records.unable_reason so the admin email/detail stay English; the
// on-screen chip is translated for display via translateUnableReason.
const UNABLE_REASONS = ['Locked gate', 'Pool room locked', 'Dog in yard', 'No access', 'Other']

export default function NewService() {
  const toast = useToast()
  const { id: poolId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { business, staffRecord, userRole } = useBusiness()
  const { t, lang } = useLanguage()

  // Occurrence identity for the visit being serviced. Carried via route state
  // from the clicked stop (profile + the occurrence's date) so completion/unable
  // fulfils EXACTLY that occurrence — not "today". Falls back to the pool's
  // single active profile + its current due occurrence when the tech opened the
  // pool directly (no specific stop).
  async function resolveOccurrence() {
    // One-off visit: NEVER fulfil or advance any recurring occurrence. Return
    // null identity BEFORE the single-active-profile fallback below — otherwise a
    // one-off on a pool that has a lone recurring profile would silently attach to
    // it. Shared by handleComplete AND handleUnable, so an "unable one-off" is inert too.
    if (location.state?.oneOff) return { recurringProfileId: null, occurrenceDate: null }
    let recurringProfileId = location.state?.recurringProfileId || null
    let occurrenceDate = location.state?.occurrenceDate || null
    if (!recurringProfileId) {
      const { data } = await supabase
        .from('recurring_job_profiles')
        .select('id, next_generation_at')
        .eq('pool_id', poolId)
        .eq('is_active', true)
        .in('status', ['active'])
      if (data && data.length === 1) {
        recurringProfileId = data[0].id
        if (!occurrenceDate) {
          occurrenceDate = data[0].next_generation_at ? String(data[0].next_generation_at).split('T')[0] : null
        }
      }
    }
    return { recurringProfileId, occurrenceDate }
  }

  const [pool, setPool] = useState(null)
  const [client, setClient] = useState(null)
  const [staffList, setStaffList] = useState([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(searchParams.get('done') === '1')
  const [lastReadings, setLastReadings] = useState(null)
  const [nextStop, setNextStop] = useState(null)
  const isTech = userRole === 'tech'
  const photoInputRef = useRef(null)
  const extraPhotoInputRef = useRef(null)
  const completionPhotoInputRef = useRef(null)
  const unablePhotoInputRef = useRef(null)

  // Pool photo
  const [servicePhoto, setServicePhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoMeta, setPhotoMeta] = useState(null) // { lat, lng, timestamp, address }
  const [capturingPhoto, setCapturingPhoto] = useState(false)
  // Optional photos on the TASKS step — up to 5 "things" shots (water
  // condition, equipment found dodgy, on-site issues, etc.). Not gated
  // on; each saved with tag='extra'. Each entry: { blob, preview, meta }.
  const MAX_EXTRA_PHOTOS = 5
  const [extraPhotos, setExtraPhotos] = useState([])
  const [capturingExtraPhoto, setCapturingExtraPhoto] = useState(false)
  // Optional completion photo on the review step — proof of departure
  // / "leaving the pool in a good state" shot. Same watermark
  // pipeline; saved with tag='completion' so it's distinguishable
  // from the arrival photo on report renderers.
  const [completionPhoto, setCompletionPhoto] = useState(null)
  const [completionPhotoPreview, setCompletionPhotoPreview] = useState(null)
  const [completionPhotoMeta, setCompletionPhotoMeta] = useState(null)
  const [capturingCompletionPhoto, setCapturingCompletionPhoto] = useState(false)
  // "Unable to Service" sub-flow (entered from the arrival screen). The tech
  // picks a reason, optionally adds a note + up to 5 watermarked photos
  // (tag='unable_access'), and submits — no service happens.
  // Entered from the run-sheet card's "Unable to Service" button via
  // ?unable=1 (the button lives on the card, not this screen, to avoid the
  // tech having to Start Service first).
  const [unableMode, setUnableMode] = useState(searchParams.get('unable') === '1')
  const [unableReason, setUnableReason] = useState('')
  const [unableNote, setUnableNote] = useState('')
  const [unablePhotos, setUnablePhotos] = useState([]) // { blob, preview, meta }
  const [capturingUnablePhoto, setCapturingUnablePhoto] = useState(false)
  const [unableSubmitted, setUnableSubmitted] = useState(false)
  // Failsafe against re-entry duplicates: if an unsent draft already exists for
  // this pool, the tech is (almost certainly) re-doing a visit that's already
  // saved and sending. Steer them back rather than let them create a duplicate.
  const [reentryPending, setReentryPending] = useState(null)
  const [ignoreReentry, setIgnoreReentry] = useState(false)
  const gpsRef = useRef(null) // pre-fetched GPS position

  // Detect an already-saved visit for this pool (IndexedDB only — no network, so
  // it can't hang). Best-effort; on any failure we simply show the normal form.
  useEffect(() => {
    if (completed || unableSubmitted) return
    let cancelled = false
    ;(async () => {
      try {
        const drafts = await listDrafts()
        const match = drafts.find(d => d.poolId === poolId)
        if (!cancelled) setReentryPending(match || null)
      } catch { /* best-effort */ }
    })()
    return () => { cancelled = true }
  }, [poolId, completed, unableSubmitted])

  // Pre-fetch GPS as soon as the page loads so permission is granted before photo
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { gpsRef.current = pos.coords },
        () => {}, // silent fail — will try again at capture time
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      )
    }
  }, [])

  // Step 1: Chemical readings
  const [readings, setReadings] = useState({
    ph: '',
    free_chlorine: '',
    total_chlorine: '',
    alkalinity: '',
    stabiliser: '',
    calcium_hardness: '',
    salt: '',
  })

  // Which chemical readings to show (start with pH + free chlorine)
  const [visibleReadings, setVisibleReadings] = useState([...DEFAULT_READINGS])

  // Step 2: Task checklist. Pre-loaded with the standard service
  // checklist — required ones gate progression to the Chemicals step,
  // optional ones are visible but skippable. Required tasks aren't
  // removable from the list (the X delete button is suppressed) so
  // the operator can't bypass the gate by deleting the row.
  const [tasks, setTasks] = useState([
    { name: 'Vacuumed',             required: true,  completed: false },
    { name: 'Scrubbed water line',  required: true,  completed: false },
    { name: 'Checked water level',  required: true,  completed: false },
    { name: 'Emptied pump basket',  required: true,  completed: false },
    { name: 'Backwash filter',      required: true,  completed: false },
    { name: 'Emptied skimmer basket', required: false, completed: false },
    { name: 'Checked equipment',      required: false, completed: false },
    { name: 'Checked chlorinator',    required: false, completed: false },
  ])
  const [customTask, setCustomTask] = useState('')

  // Step 3: Chemicals added
  const [chemicalsAdded, setChemicalsAdded] = useState([])
  const [chemicalProducts, setChemicalProducts] = useState([])
  // (chemSearch / chemSearchFocused removed — Step 3 no longer has
  // a search box. Whole library renders inline.)

  // Step 4: Notes
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (business?.id) loadPool()
  }, [poolId, business?.id])

  async function loadPool() {
    try {
      const [poolRes, staffRes, lastServiceRes, productsRes] = await Promise.all([
        supabase.from('pools').select('*, clients(*)').eq('id', poolId).single(),
        supabase.from('staff_members').select('*').eq('business_id', business?.id).eq('is_active', true).order('name'),
        supabase.from('service_records')
          .select('id, serviced_at, chemical_logs(*)')
          .eq('pool_id', poolId)
          .eq('status', 'completed')
          .order('serviced_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('chemical_products')
          .select('*')
          .eq('business_id', business.id)
          .order('use_count', { ascending: false })
          .limit(20),
      ])
      if (poolRes.error) throw poolRes.error
      setPool(poolRes.data)
      setClient(poolRes.data.clients)

      // Store last service readings for comparison
      if (lastServiceRes.data?.chemical_logs?.length) {
        setLastReadings(lastServiceRes.data.chemical_logs[0])
      }

      const products = productsRes.data || []
      setChemicalProducts(products)
      // Pre-populate one row per library product. Each row has two
      // freeform text fields: dose_text (what the tech added) and
      // stock_remaining (what's left in the bottle at the client).
      // Both optional. Save filters out rows where both are blank.
      setChemicalsAdded(products.map(p => ({
        product_name: p.name,
        dose_text: '',
        stock_remaining: '',
      })))

      const staffData = staffRes.data || []
      setStaffList(staffData)
      // Pre-select: URL param > pool assigned > only-one-staff fallback
      const staffParam = searchParams.get('staff')
      const poolAssigned = poolRes.data.assigned_staff_id
      const preselect = staffParam || poolAssigned
      if (preselect && staffData.some(s => s.id === preselect)) {
        setSelectedStaffId(preselect)
      } else if (staffData.length === 1) {
        setSelectedStaffId(staffData[0].id)
      }
    } catch (err) {
      console.error('Error loading pool:', err)
    } finally {
      setLoading(false)
    }
  }

  async function findNextStop() {
    if (!isTech || !staffRecord?.id) return
    try {
      const today = new Date().toISOString().split('T')[0]
      // Find other pools assigned to this tech that are due today or overdue
      const { data: pools } = await supabase
        .from('pools')
        .select('id, address, clients(name)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffRecord.id)
        .neq('id', poolId)
        .lte('next_due_at', new Date(today + 'T23:59:59').toISOString())
        .order('next_due_at')
        .limit(1)
      if (pools?.length) {
        setNextStop({ type: 'pool', id: pools[0].id, address: pools[0].address, client_name: pools[0].clients?.name })
        return
      }
      // Also check jobs assigned to this tech for today
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, pool_id, clients(name)')
        .eq('business_id', business.id)
        .eq('assigned_staff_id', staffRecord.id)
        .eq('scheduled_date', today)
        .in('status', ['scheduled', 'in_progress'])
        .order('scheduled_time')
        .limit(1)
      if (jobs?.length && jobs[0].pool_id) {
        setNextStop({ type: 'pool', id: jobs[0].pool_id, address: jobs[0].title, client_name: jobs[0].clients?.name })
      }
    } catch (err) {
      console.error('Error finding next stop:', err)
    }
  }

  function handleReadingChange(key, value) {
    setReadings(prev => ({ ...prev, [key]: value }))
  }

  function toggleTask(index) {
    setTasks(prev =>
      prev.map((t, i) => (i === index ? { ...t, completed: !t.completed } : t))
    )
  }

  // (addChemical / addFromLibrary / removeChemical removed —
  // chemicalsAdded is pre-populated with one row per library
  // product on load, the tech only edits quantity. Empty rows
  // get filtered out on save.)
  function updateChemical(index, field, value) {
    setChemicalsAdded(prev =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    )
  }

  async function handleComplete() {
    setSubmitting(true)
    try {
      const selectedStaff = staffList.find(s => s.id === selectedStaffId)
      const techName = selectedStaff?.name || business?.owner_name || 'Owner'
      const serviceRecordId = genId()

      // Readings → null for blanks.
      const cleanReadings = {}
      for (const [k, v] of Object.entries(readings)) {
        cleanReadings[k] = v === '' ? null : parseFloat(v)
      }

      // Chemicals — keep rows with a dose or a stock note (see prior reasoning).
      const validChemicals = chemicalsAdded
        .filter(c => c.product_name && ((c.dose_text && c.dose_text.trim()) || (c.stock_remaining && c.stock_remaining.trim())))
        .map(c => ({
          product_name: c.product_name,
          dose_text: c.dose_text?.trim() || null,
          stock_remaining: c.stock_remaining?.trim() || null,
        }))

      // All photos ride in the draft: mandatory arrival/test-kit + up to 5 extra
      // + the optional completion shot. Each gets its own client_photo_id.
      const photos = []
      if (servicePhoto) photos.push({ clientPhotoId: genId(), blob: servicePhoto, tag: 'test-kit', meta: photoMeta || {} })
      for (const p of extraPhotos) photos.push({ clientPhotoId: genId(), blob: p.blob, tag: 'extra', meta: p.meta || {} })
      if (completionPhoto) photos.push({ clientPhotoId: genId(), blob: completionPhoto, tag: 'completion', meta: completionPhotoMeta || {} })

      // Occurrence identity (from route state; null for a one-off / ad-hoc visit).
      const occ = await resolveOccurrence()
      const servicedAt = new Date().toISOString()

      const draft = {
        serviceRecordId,
        kind: 'complete',
        businessId: business.id,
        poolId,
        staffId: selectedStaffId || null,
        technicianName: techName,
        servicedAt,
        recurringProfileId: occ.recurringProfileId || null,
        occurrenceDate: occ.occurrenceDate || null,
        isOneOff: !!location.state?.oneOff,
        notes,
        readings: cleanReadings,
        tasks: tasks.map(t => ({ name: t.name, completed: t.completed })),
        chemicals: validChemicals,
        photos,
        createdAt: Date.now(),
      }

      // Persist the draft FIRST (durability is the top property), then submit:
      // online it sends + clears on the same tap; offline it stays pending.
      await createDraft(draft)
      appendCachedServiceRecord({
        id: serviceRecordId, pool_id: poolId, status: 'completed', serviced_at: servicedAt,
        recurring_profile_id: draft.recurringProfileId, occurrence_date: draft.occurrenceDate,
        is_one_off: draft.isOneOff,
        // Nested shape matches the run-sheet select so the optimistic stop renders
        // with client/pool names on an offline reload (before the real row syncs).
        pools: { name: pool?.name, address: pool?.address, type: pool?.type, clients: { name: client?.name, phone: client?.phone } },
      })
      // Hand the visit to the automatic sender. It uploads the photos, saves the
      // record, and retries on its own until confirmed — so we NEVER block the tap
      // on the network. A weak uplink can no longer freeze "Complete Service"; the
      // visit is already saved durably above and will send itself.
      kickOutbox({ force: true })

      // Best-effort, online-only analytics — fire-and-forget, never blocks the tap.
      if (validChemicals.length) {
        ;(async () => {
          try {
            for (const c of validChemicals) {
              const existing = chemicalProducts.find(p => p.name.toLowerCase() === c.product_name.toLowerCase())
              if (existing) {
                await supabase.from('chemical_products')
                  .update({ use_count: (existing.use_count || 0) + 1, last_used_at: new Date().toISOString() })
                  .eq('id', existing.id)
              }
            }
          } catch (e) {
            console.warn('Chemical use_count bump failed (non-critical):', e)
          }
        })()
      }

      // Success screen survives reload. Carry the new record id so it can offer
      // "View service details".
      navigate(`/pools/${poolId}/service?done=1&serviceId=${serviceRecordId}`, { replace: true })
      setCompleted(true)
      findNextStop()
      toast.success('Saved ✓ — sending automatically')
    } catch (err) {
      console.error('Error completing service:', err)
      toast.error(t('service.completeFailed') + (err?.message || JSON.stringify(err)))
    } finally {
      setSubmitting(false)
    }
  }

  // Capture + watermark a photo for the Unable-to-Service flow (same GPS/
  // timestamp/technician watermark as the arrival shot). Mirrors the extra-
  // photo capture; saved later with tag='unable_access'.
  async function captureUnablePhoto(file) {
    if (!file || unablePhotos.length >= MAX_EXTRA_PHOTOS) return
    setCapturingUnablePhoto(true)
    try {
      let lat = gpsRef.current?.latitude || null
      let lng = gpsRef.current?.longitude || null
      if (!lat) {
        try {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true, timeout: 8000, maximumAge: 30000
            })
          )
          lat = pos.coords.latitude
          lng = pos.coords.longitude
          gpsRef.current = pos.coords
        } catch (geoErr) {
          console.warn('GPS unavailable:', geoErr.message)
        }
      }
      let gpsAddress = ''
      if (lat && lng) {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`)
          const data = await res.json()
          const a = data.address || {}
          gpsAddress = [a.house_number, a.road, a.suburb, a.city || a.town, a.state].filter(Boolean).join(', ')
        } catch {
          gpsAddress = pool?.address || ''
        }
      }
      const now = new Date()
      const meta = {
        lat, lng, timestamp: now.toISOString(),
        address: gpsAddress || pool?.address || '',
        clientName: client?.name || '',
        poolName: pool?.name || '',
        businessName: business?.name || '',
        technicianName,
      }
      const watermarked = await watermarkPhoto(file, meta)
      setUnablePhotos(prev => [...prev, { blob: watermarked.blob, preview: watermarked.dataUrl, meta }])
    } catch (err) {
      console.error('Unable photo capture error:', err)
    } finally {
      setCapturingUnablePhoto(false)
    }
  }

  // Submit the "unable to service" report. Mirrors handleComplete: create the
  // record, save the (optional) photos, then mark it unable — which advances
  // the schedule, alerts the office in-app, and fires the admin email.
  async function handleUnable() {
    if (!unableReason) return
    setSubmitting(true)
    try {
      const selectedStaff = staffList.find(s => s.id === selectedStaffId)
      const techName = selectedStaff?.name || business?.owner_name || 'Owner'
      const serviceRecordId = genId()
      const occ = await resolveOccurrence()
      const servicedAt = new Date().toISOString()
      const reason = unableReason
      const note = unableNote.trim() || null
      const clientName = client?.name || 'A client'
      const address = pool?.address || ''

      const draft = {
        serviceRecordId,
        kind: 'unable',
        businessId: business.id,
        poolId,
        staffId: selectedStaffId || null,
        technicianName: techName,
        servicedAt,
        recurringProfileId: occ.recurringProfileId || null,
        occurrenceDate: occ.occurrenceDate || null,
        isOneOff: !!location.state?.oneOff,
        reason,
        note,
        activity: {
          type: 'service_unable',
          title: 'Unable to service',
          description: `${clientName}${address ? ' · ' + address : ''}${reason ? ' — ' + reason : ''}`,
          linkTo: `/services/${serviceRecordId}`,
        },
        photos: unablePhotos.map(p => ({ clientPhotoId: genId(), blob: p.blob, tag: 'unable_access', meta: p.meta || {} })),
        createdAt: Date.now(),
      }

      await createDraft(draft)
      appendCachedServiceRecord({
        id: serviceRecordId, pool_id: poolId, status: 'unable_to_service', serviced_at: servicedAt,
        unable_reason: reason, recurring_profile_id: draft.recurringProfileId, occurrence_date: draft.occurrenceDate,
        is_one_off: draft.isOneOff,
        pools: { name: pool?.name, address: pool?.address, type: pool?.type, clients: { name: client?.name, phone: client?.phone } },
      })
      // Hand off to the automatic sender (see handleComplete) — never block on
      // the network; the report is saved durably and will send itself.
      kickOutbox({ force: true })
      setUnableSubmitted(true)
      findNextStop()
      toast.success('Saved ✓ — sending automatically')
    } catch (err) {
      console.error('Error reporting unable to service:', err)
      toast.error(t('service.unableFailed') + (err?.message || JSON.stringify(err)))
    } finally {
      setSubmitting(false)
    }
  }

  function renderDelta(key) {
    if (!lastReadings || lastReadings[key] == null) return null
    const current = parseFloat(readings[key])
    if (isNaN(current)) return (
      <span className="text-xs text-gray-400 dark:text-gray-500">Last: {lastReadings[key]}</span>
    )
    const diff = current - lastReadings[key]
    if (diff === 0) return (
      <span className="text-xs text-gray-400 dark:text-gray-500">— no change (was {lastReadings[key]})</span>
    )
    const arrow = diff > 0 ? '↑' : '↓'
    const color = diff > 0 ? 'text-red-500' : 'text-blue-500'
    return (
      <span className={cn('text-xs font-medium', color)}>
        {arrow} {Math.abs(diff).toFixed(1)} from {lastReadings[key]}
      </span>
    )
  }

  const targetRanges = pool?.target_ranges || DEFAULT_TARGET_RANGES
  const completedCount = tasks.filter(t => t.completed).length
  // Gate: every required task must be checked off before the tech can
  // advance to Chemicals Added. Optional tasks are tracked but don't
  // block progression.
  const allRequiredDone = tasks.filter(t => t.required).every(t => t.completed)
  const isSaltPool = pool?.type === 'salt'

  // Name baked into every watermarked photo — the service technician
  // (selected on the Chemicals step), falling back to the logged-in tech
  // / owner. Mirrors the name written to the service record on submit.
  const technicianName = staffList.find(s => s.id === selectedStaffId)?.name
    || staffRecord?.name || business?.owner_name || ''

  if (loading) {
    return (
      <>
        <Header title={t('service.loading')} backTo={-1} />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-pool-500 border-t-transparent rounded-full" />
          </div>
        </PageWrapper>
      </>
    )
  }

  // Confirmation after an "unable to service" report.
  if (unableSubmitted) {
    return (
      <>
        <Header title={t('service.unableTitle')} backTo={-1} />
        <PageWrapper>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-amber-600 dark:text-amber-400" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('service.unableDone')}</h2>
            {pool?.name && <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{pool.name}</p>}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{pool?.address}</p>
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-6">{t('service.unableDoneDesc')}</p>
            <div className="flex gap-3 w-full">
              {isTech && nextStop ? (
                <Button
                  className="flex-1 min-h-[48px] bg-amber-600 hover:bg-amber-700"
                  onClick={() => navigate(`/pools/${nextStop.id}/service?staff=${staffRecord?.id}`)}
                >
                  {t('service.nextStop')}
                </Button>
              ) : (
                <Button
                  className="flex-1 min-h-[48px]"
                  onClick={() => navigate(isTech ? '/tech' : '/schedule')}
                >
                  {isTech ? t('service.runSheet') : t('service.nextPool')}
                </Button>
              )}
            </div>
            {isTech && nextStop && (
              <button
                onClick={() => navigate('/tech')}
                className="text-sm text-pool-600 dark:text-pool-400 font-semibold mt-2"
              >
                {t('profile.backToRunSheet')}
              </button>
            )}
          </div>
        </PageWrapper>
      </>
    )
  }

  // "Unable to Service" sub-flow — reason + optional note + optional photos.
  if (unableMode) {
    return (
      <>
        <Header title={t('service.unableTitle')} backTo={-1} />
        <PageWrapper>
          <div className="space-y-3">
            <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100">{client?.name || 'Client'}</p>
                  {pool?.name && <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{pool.name}</p>}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
                </div>
                <Badge variant="warning" className="shrink-0">{t('service.unableStatus')}</Badge>
              </div>
            </Card>

            <p className="text-xs text-gray-500 dark:text-gray-400">{t('service.unableSubtitle')}</p>

            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('service.unableReasonLabel')}</h2>
              <div className="flex flex-wrap gap-2">
                {UNABLE_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setUnableReason(r)}
                    className={cn(
                      'px-3 py-2 rounded-full text-sm font-medium border min-h-[44px] transition-colors',
                      unableReason === r
                        ? 'bg-amber-500 border-amber-500 text-white'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-amber-400'
                    )}
                  >
                    {translateUnableReason(r, lang)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t('service.unableNoteLabel')} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{t('service.optionalParen')}</span>
              </h2>
              <TextArea
                value={unableNote}
                onChange={e => setUnableNote(e.target.value)}
                rows={3}
                placeholder={t('service.unableNotePlaceholder')}
              />
            </div>

            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
                {t('service.photos')} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{t('service.optionalParen')} · {unablePhotos.length}/{MAX_EXTRA_PHOTOS}</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('service.unablePhotosHint')}</p>
              <input
                ref={unablePhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) await captureUnablePhoto(f)
                  if (unablePhotoInputRef.current) unablePhotoInputRef.current.value = ''
                }}
              />
              <div className="grid grid-cols-4 gap-2">
                {unablePhotos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.preview} alt="" className="w-full aspect-square rounded-lg border border-gray-200 dark:border-gray-700 object-contain bg-gray-50 dark:bg-gray-800" />
                    <button
                      onClick={() => setUnablePhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {unablePhotos.length < MAX_EXTRA_PHOTOS && (
                  <button
                    onClick={() => unablePhotoInputRef.current?.click()}
                    disabled={capturingUnablePhoto}
                    className="aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-amber-400 hover:text-amber-500 flex items-center justify-center transition-colors"
                  >
                    {capturingUnablePhoto ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    ) : (
                      <Plus className="w-5 h-5" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 min-h-[48px]" onClick={() => setUnableMode(false)}>
                {t('common.back')}
              </Button>
              <Button
                className="flex-1 min-h-[48px] bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                onClick={handleUnable}
                disabled={!unableReason || submitting}
              >
                {submitting ? t('service.unableSubmitting') : t('service.unableSubmit')}
              </Button>
            </div>
            {!unableReason && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400">{t('service.unableReasonRequired')}</p>
            )}
          </div>
        </PageWrapper>
      </>
    )
  }

  // Already-saved guard — precedes the blank form so a tech can't unknowingly
  // re-do (and duplicate) a visit that's already saved and sending. The escape
  // hatch keeps a genuinely separate visit possible.
  if (reentryPending && !ignoreReentry && !completed && !unableSubmitted && !unableMode) {
    return (
      <>
        <Header title="Service" backTo={-1} />
        <PageWrapper>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">This visit is already saved</h2>
            {pool?.name && <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{pool.name}</p>}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
              It’s sending automatically — you don’t need to redo it. No need to refresh or submit again.
            </p>
            <div className="w-full">
              <Button className="w-full min-h-[48px]" onClick={() => navigate(isTech ? '/tech' : '/schedule')}>
                {isTech ? 'Back to run sheet' : 'Back to schedule'}
              </Button>
            </div>
            <button
              onClick={() => setIgnoreReentry(true)}
              className="text-xs text-gray-400 dark:text-gray-500 mt-4 underline"
            >
              This is a different visit — start anyway
            </button>
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title={completed ? t('service.headerComplete') : t('service.headerNew')} backTo={-1} />
      <PageWrapper>
        {/* Progress bar */}
        {!completed && <div className="mb-6">
          <div className="flex justify-between mb-2">
            {STEPS.map((label, i) => (
              <button
                key={label}
                onClick={() => setStep(i)}
                className={cn(
                  'text-xs font-medium min-h-[44px] px-1 flex items-center',
                  i === step ? 'text-pool-600' : i < step ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'
                )}
              >
                {t(`service.step.${label}`)}
              </button>
            ))}
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-pool-500 rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>}

        {/* Step 0: Arrival photo gate — tech must capture a live,
            watermarked photo before any chemical entry. Proof of being
            on site: timestamp + GPS baked into the image (same
            watermark the old pool & test kit photo used). */}
        {step === 0 && !completed && (
          <div className="space-y-3">
            <Card className="bg-pool-50 dark:bg-pool-950/40 border-pool-200">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100">{client?.name || 'Client'}</p>
                  {pool?.name && <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{pool.name}</p>}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
                  {location.state?.oneOff && (
                    <span className="inline-flex items-center mt-2 text-[11px] font-bold px-2 py-0.5 rounded-lg text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/50">
                      One-off visit · not part of the schedule
                    </span>
                  )}
                </div>
                <Badge variant={pool?.type || 'default'} className="shrink-0 capitalize">{pool?.type || 'pool'}</Badge>
              </div>
            </Card>

            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('service.arrivalPhoto')}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Take a live photo at the pool to confirm you're on site. Timestamp and GPS are baked into the image automatically.
              </p>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setCapturingPhoto(true)
                  try {
                    let lat = gpsRef.current?.latitude || null
                    let lng = gpsRef.current?.longitude || null
                    if (!lat) {
                      try {
                        const pos = await new Promise((resolve, reject) =>
                          navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true, timeout: 8000, maximumAge: 30000
                          })
                        )
                        lat = pos.coords.latitude
                        lng = pos.coords.longitude
                        gpsRef.current = pos.coords
                      } catch (geoErr) {
                        console.warn('GPS unavailable:', geoErr.message)
                      }
                    }

                    let gpsAddress = ''
                    if (lat && lng) {
                      try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`)
                        const data = await res.json()
                        const a = data.address || {}
                        gpsAddress = [a.house_number, a.road, a.suburb, a.city || a.town, a.state].filter(Boolean).join(', ')
                      } catch {
                        gpsAddress = pool?.address || ''
                      }
                    }

                    const now = new Date()
                    const meta = {
                      lat, lng, timestamp: now.toISOString(),
                      address: gpsAddress || pool?.address || '',
                      clientName: client?.name || '',
                      poolName: pool?.name || '',
                      businessName: business?.name || '',
                      technicianName,
                    }
                    setPhotoMeta(meta)
                    const watermarked = await watermarkPhoto(file, meta)
                    setServicePhoto(watermarked.blob)
                    setPhotoPreview(watermarked.dataUrl)
                  } catch (err) {
                    console.error('Photo capture error:', err)
                    setServicePhoto(file)
                    const reader = new FileReader()
                    reader.onload = (ev) => setPhotoPreview(ev.target.result)
                    reader.readAsDataURL(file)
                  } finally {
                    setCapturingPhoto(false)
                  }
                }}
              />
              {photoPreview ? (
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Arrival photo — verified"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-contain max-h-48 bg-gray-50 dark:bg-gray-800"
                  />
                  {photoMeta && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 dark:bg-green-950/40 px-2 py-1 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                        Verified Time
                      </span>
                      {photoMeta.lat && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 dark:bg-green-950/40 px-2 py-1 rounded-full">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                          Verified GPS
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setServicePhoto(null)
                      setPhotoPreview(null)
                      setPhotoMeta(null)
                      if (photoInputRef.current) photoInputRef.current.value = ''
                      photoInputRef.current?.click()
                    }}
                    className="mt-2 w-full text-center text-sm font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700 py-2"
                  >
                    Retake Photo
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={capturingPhoto}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 dark:text-gray-500 hover:border-pool-400 hover:text-pool-500 transition-colors"
                >
                  {capturingPhoto ? (
                    <>
                      <svg className="w-8 h-8 animate-spin text-pool-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm font-medium text-pool-600 dark:text-pool-400">{t('service.processingPhoto')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <span className="text-sm font-medium">{t('service.tapTakePhoto')}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">GPS & timestamp verified automatically</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <Button
              onClick={() => setStep(1)}
              disabled={!servicePhoto}
              className="w-full min-h-[48px] mt-2"
            >
              {t('common.continue')}
            </Button>
            {!servicePhoto && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">{t('service.photoRequired')}</p>
            )}
          </div>
        )}

        {/* Step 1: Chemical Readings */}
        {step === 1 && !completed && (
          <div className="space-y-3">
            {/* Client & Pool info */}
            <Card className="bg-pool-50 dark:bg-pool-950/40 border-pool-200">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100">{client?.name || 'Client'}</p>
                  {pool?.name && <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{pool.name}</p>}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
                  {location.state?.oneOff && (
                    <span className="inline-flex items-center mt-2 text-[11px] font-bold px-2 py-0.5 rounded-lg text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/50">
                      One-off visit · not part of the schedule
                    </span>
                  )}
                </div>
                <Badge variant={pool?.type || 'default'} className="shrink-0 capitalize">{pool?.type || 'pool'}</Badge>
              </div>
              <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-pool-200/50">
                {client?.phone && (
                  <a href={`tel:${client.phone}`} className="flex items-center gap-2 text-sm text-pool-600 dark:text-pool-400 font-medium">
                    <Phone className="w-3.5 h-3.5 text-pool-400 shrink-0" strokeWidth={2} />
                    {client.phone}
                  </a>
                )}
                {client?.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-2 text-sm text-pool-600 dark:text-pool-400 font-medium">
                    <Mail className="w-3.5 h-3.5 text-pool-400 shrink-0" strokeWidth={2} />
                    {client.email}
                  </a>
                )}
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {pool?.schedule_frequency && <span>{FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}</span>}
                  {pool?.volume_litres && <span>· {Number(pool.volume_litres).toLocaleString()}L</span>}
                  {pool?.shape && <span>· {pool.shape}</span>}
                </div>
                {pool?.access_notes && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    {pool.access_notes}
                  </p>
                )}
              </div>
            </Card>

            {/* Staff selector */}
            {staffList.length > 0 && (
              <Select
                label={t('service.technician')}
                value={selectedStaffId}
                onChange={e => setSelectedStaffId(e.target.value)}
                options={[
                  { value: '', label: 'Select technician...' },
                  ...staffList.map(s => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('service.chemicalReadings')}</h2>
            {ALL_READING_FIELDS.filter(f => visibleReadings.includes(f.key)).map(({ key, rangeKey, saltOnly }) => {
              if (saltOnly && !isSaltPool) return null
              const info = CHEMICAL_LABELS[key]
              const value = readings[key]
              const range = targetRanges[rangeKey]
              const status = value !== '' ? getChemicalStatus(parseFloat(value), range) : 'neutral'
              const isDefault = DEFAULT_READINGS.includes(key)
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className={cn('w-3 h-3 rounded-full flex-shrink-0', statusDot(status))} />
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {info?.label || key}
                      {info?.unit && <span className="text-gray-400 dark:text-gray-500 ml-1">{info.unit}</span>}
                    </label>
                    {SLIDER_FIELDS[key] ? (
                      // Slider variant — see SLIDER_FIELDS for the
                      // per-reading range/step/default. Visual thumb
                      // sits at defaultPos when readings[key] is empty
                      // but state stays '' until the operator
                      // interacts, so we never save a fake measurement.
                      (() => {
                        const cfg = SLIDER_FIELDS[key]
                        return (
                          <div>
                            <div className="flex items-baseline gap-2 mb-2">
                              <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                                {value !== '' ? Number(value).toFixed(1) : '—'}
                              </p>
                              {value === '' && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">slide to record</p>
                              )}
                            </div>
                            <input
                              type="range"
                              min={cfg.min}
                              max={cfg.max}
                              step={cfg.step}
                              value={value !== '' ? Number(value) : cfg.defaultPos}
                              onChange={e => handleReadingChange(key, e.target.value)}
                              className="w-full accent-pool-500 cursor-pointer"
                              aria-label={`${info?.label || key} reading`}
                            />
                            <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1 tabular-nums">
                              <span>{cfg.min}</span>
                              {range && <span>target {range[0]}–{range[1]}</span>}
                              <span>{cfg.max.toFixed(1)}</span>
                            </div>
                          </div>
                        )
                      })()
                    ) : (
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={value}
                        onChange={e => handleReadingChange(key, e.target.value)}
                        placeholder={range ? `${range[0]} - ${range[1]}` : ''}
                        className="input-lg w-full text-lg"
                      />
                    )}
                    {lastReadings && (
                      <div className="mt-0.5">{renderDelta(key)}</div>
                    )}
                  </div>
                  {!isDefault && (
                    <button
                      onClick={() => {
                        setVisibleReadings(prev => prev.filter(k => k !== key))
                        handleReadingChange(key, '')
                      }}
                      className="min-w-tap min-h-tap flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors mt-5"
                    >
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  )}
                </div>
              )
            })}

            {/* Add more readings dropdown */}
            {(() => {
              const available = ALL_READING_FIELDS.filter(f =>
                !visibleReadings.includes(f.key) && !(f.saltOnly && !isSaltPool)
              )
              if (available.length === 0) return null
              return (
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('service.addReading')}</label>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setVisibleReadings(prev => [...prev, e.target.value])
                      }
                    }}
                  >
                    <option value="">{t('service.selectReading')}</option>
                    {available.map(f => {
                      const info = CHEMICAL_LABELS[f.key]
                      return (
                        <option key={f.key} value={f.key}>
                          {info?.label || f.key}{info?.unit ? ` (${info.unit})` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )
            })()}

            <Button
              onClick={() => setStep(2)}
              className="w-full min-h-[48px] mt-4"
            >
              {t('service.nextAdded')}
            </Button>
          </div>
        )}

        {/* Step 3: Task Checklist (now after Chemicals Added) */}
        {step === 3 && !completed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('service.taskChecklist')}</h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">{completedCount}/{tasks.length}</span>
            </div>

            {/* Active tasks. Required tasks show a red * and have no
                X (delete) button — preventing the operator from
                bypassing the gate by removing the row. Optional tasks
                stay removable. */}
            <div className="space-y-2">
              {tasks.map((task, i) => (
                <div key={task.name} className="flex items-center gap-2">
                  <button
                    onClick={() => toggleTask(i)}
                    className={cn(
                      'flex-1 flex items-center gap-3 px-4 rounded-xl border text-left transition-colors',
                      'min-h-[44px]',
                      task.completed
                        ? 'bg-green-50 dark:bg-green-950/40 border-green-200 text-green-800'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-800'
                    )}
                  >
                    <span className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      task.completed ? 'border-green-500 bg-green-500' : 'border-gray-300 dark:border-gray-600'
                    )}>
                      {task.completed && (
                        <Check className="w-3 h-3 text-white" strokeWidth={2} />
                      )}
                    </span>
                    <span className="text-sm font-medium">
                      {translateTaskName(task.name, lang)}
                      {task.required && (
                        <span className="text-red-500 ml-1" aria-label="required">*</span>
                      )}
                    </span>
                  </button>
                  {!task.required && (
                    <button
                      onClick={() => setTasks(prev => prev.filter((_, idx) => idx !== i))}
                      className="min-w-tap min-h-tap flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add from common tasks */}
            {(() => {
              const addedNames = tasks.map(t => t.name)
              const available = DEFAULT_TASKS.filter(t => !addedNames.includes(t))
              if (available.length === 0) return null
              return (
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('service.addCommonTask')}</label>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setTasks(prev => [...prev, { name: e.target.value, completed: false }])
                      }
                    }}
                  >
                    <option value="">{t('service.selectTask')}</option>
                    {available.map(name => (
                      <option key={name} value={name}>{translateTaskName(name, lang)}</option>
                    ))}
                  </select>
                </div>
              )
            })()}

            {/* Custom task input */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t('service.addCustomTask')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder={t('service.customTaskPlaceholder')}
                  value={customTask}
                  onChange={e => setCustomTask(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customTask.trim()) {
                      setTasks(prev => [...prev, { name: customTask.trim(), completed: false }])
                      setCustomTask('')
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  disabled={!customTask.trim()}
                  onClick={() => {
                    if (customTask.trim()) {
                      setTasks(prev => [...prev, { name: customTask.trim(), completed: false }])
                      setCustomTask('')
                    }
                  }}
                  className="px-4"
                >
                  {t('common.add')}
                </Button>
              </div>
            </div>

            {/* Notes & Issues — free-text the tech jots on site. Bound to
                the same `notes` saved to the service record (shown
                read-only on Review). */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-amber-50/60 dark:bg-amber-950/20">
                <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('service.notesIssuesTitle')}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{t('service.notesIssuesHint')}</p>
                </div>
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t('service.notesIssuesPlaceholder')}
                rows={4}
                className="w-full px-4 py-3 text-sm bg-transparent resize-none focus:outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
            </div>

            {/* Optional photos (up to 5) — "things" the tech wants to flag:
                water condition, dodgy equipment, on-site issues. Saved with
                tag='extra'; watermarked (GPS + timestamp + technician) like
                the arrival / completion shots. Moved here from the Chemicals
                step. */}
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t('service.photos')} <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{t('service.optionalParen')} · {extraPhotos.length}/{MAX_EXTRA_PHOTOS}</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('service.extraPhotoHint')}</p>
              <input
                ref={extraPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (extraPhotos.length >= MAX_EXTRA_PHOTOS) return
                  setCapturingExtraPhoto(true)
                  try {
                    let lat = gpsRef.current?.latitude || null
                    let lng = gpsRef.current?.longitude || null
                    if (!lat) {
                      try {
                        const pos = await new Promise((resolve, reject) =>
                          navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true, timeout: 8000, maximumAge: 30000
                          })
                        )
                        lat = pos.coords.latitude
                        lng = pos.coords.longitude
                        gpsRef.current = pos.coords
                      } catch (geoErr) {
                        console.warn('GPS unavailable:', geoErr.message)
                      }
                    }
                    const now = new Date()
                    const meta = {
                      lat, lng, timestamp: now.toISOString(),
                      address: pool?.address || '',
                      clientName: client?.name || '',
                      poolName: pool?.name || '',
                      businessName: business?.name || '',
                      technicianName,
                    }
                    const watermarked = await watermarkPhoto(file, meta)
                    setExtraPhotos(prev => [...prev, { blob: watermarked.blob, preview: watermarked.dataUrl, meta }])
                  } catch (err) {
                    console.error('Extra photo capture error:', err)
                    const reader = new FileReader()
                    reader.onload = (ev) => setExtraPhotos(prev => [...prev, { blob: file, preview: ev.target.result, meta: null }])
                    reader.readAsDataURL(file)
                  } finally {
                    setCapturingExtraPhoto(false)
                    if (extraPhotoInputRef.current) extraPhotoInputRef.current.value = ''
                  }
                }}
              />
              <div className="grid grid-cols-4 gap-2">
                {extraPhotos.map((p, i) => (
                  <div key={i} className="relative aspect-square">
                    <img src={p.preview} alt="" className="w-full h-full object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
                    <button
                      type="button"
                      onClick={() => setExtraPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                      aria-label="Remove photo"
                    >
                      <X className="w-3 h-3" strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
                {extraPhotos.length < MAX_EXTRA_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => extraPhotoInputRef.current?.click()}
                    disabled={capturingExtraPhoto}
                    className="aspect-square flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-pool-400 hover:text-pool-500 transition-colors"
                  >
                    {capturingExtraPhoto ? (
                      <svg className="w-5 h-5 animate-spin text-pool-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Plus className="w-6 h-6" strokeWidth={2} />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(2)} className="flex-1 min-h-[48px]">
                {t('common.back')}
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={!allRequiredDone}
                className="flex-1 min-h-[48px]"
              >
                {t('service.nextReview')}
              </Button>
            </div>
            {!allRequiredDone && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">
                {t('service.completeRequiredTasks')}
              </p>
            )}
          </div>
        )}

        {/* Step 2: Chemicals Added — flat list of every library chemical
            with inline freeform dose / remaining inputs, PLUS a custom
            line so the tech can record anything off-list. The library is
            admin-managed via Settings → Chemicals; custom rows are
            free-text and don't bump library use_count. */}
        {step === 2 && !completed && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('service.chemicalsAddedTitle')}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              {t('service.chemAddedHint')}
            </p>

            {chemicalsAdded.length > 0 && (
              <div className="space-y-2">
                <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <span>{t('service.chemColName')}</span>
                  <span className="text-center">{t('service.chemColAdded')}</span>
                  <span className="text-center">{t('service.chemColRemaining')}</span>
                </div>
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden bg-white dark:bg-gray-900">
                  {chemicalsAdded.map((chem, i) => (
                    <div key={chem._id || chem.product_name || i} className="px-4 py-3 grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 items-center">
                      {chem.custom ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <input
                            type="text"
                            value={chem.product_name}
                            onChange={e => updateChemical(i, 'product_name', e.target.value)}
                            placeholder={t('service.chemicalNamePlaceholder')}
                            className="input !w-full text-sm"
                            aria-label="Custom chemical name"
                          />
                          <button
                            type="button"
                            onClick={() => setChemicalsAdded(prev => prev.filter((_, idx) => idx !== i))}
                            aria-label="Remove chemical"
                            className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" strokeWidth={2} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {chem.product_name}
                        </span>
                      )}
                      <input
                        type="text"
                        value={chem.dose_text}
                        onChange={e => updateChemical(i, 'dose_text', e.target.value)}
                        placeholder={t('service.egDose')}
                        className="input !w-full text-right"
                        aria-label={`${chem.product_name} added`}
                      />
                      <input
                        type="text"
                        value={chem.stock_remaining}
                        onChange={e => updateChemical(i, 'stock_remaining', e.target.value)}
                        placeholder={t('service.egStock')}
                        className="input !w-full text-right"
                        aria-label={`${chem.product_name} stock remaining`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setChemicalsAdded(prev => [...prev, { product_name: '', dose_text: '', stock_remaining: '', custom: true, _id: genId() }])}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-pool-300 dark:border-pool-700 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors min-h-tap"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} /> {t('service.addCustomChemical')}
            </button>

            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(1)} className="flex-1 min-h-[48px]">
                {t('common.back')}
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1 min-h-[48px]">
                {t('service.nextTasks')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Complete */}
        {step === 4 && !completed && (
          <div className="space-y-4">
            {/* Pool & Client header */}
            <Card className="bg-pool-50 dark:bg-pool-950/40 border-pool-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100">{client?.name}</p>
                  {pool?.name && <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{pool.name}</p>}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
                </div>
                <Badge variant={pool?.type || 'default'}>{pool?.type}</Badge>
              </div>
              <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-pool-200/50">
                {client?.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-3.5 h-3.5 text-pool-400 shrink-0" strokeWidth={2} />
                    <a href={`tel:${client.phone}`} className="text-pool-600 dark:text-pool-400 font-medium">{client.phone}</a>
                  </div>
                )}
                {client?.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-pool-400 shrink-0" strokeWidth={2} />
                    <a href={`mailto:${client.email}`} className="text-pool-600 dark:text-pool-400 font-medium break-all">{client.email}</a>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{formatDate(new Date())}</span>
                <span>{FREQUENCY_LABELS[pool?.schedule_frequency] || pool?.schedule_frequency}</span>
              </div>
            </Card>

            {/* Photos — arrival + on-site shots as thumbnails so the
                whole photo (not a cropped slice) is visible at a glance. */}
            {(photoPreview || extraPhotos.length > 0) && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('service.photos')}</h3>
                <div className="grid grid-cols-4 gap-2">
                  {photoPreview && (
                    <img src={photoPreview} alt="" className="aspect-square w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
                  )}
                  {extraPhotos.map((p, i) => (
                    <img key={i} src={p.preview} alt="" className="aspect-square w-full object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800" />
                  ))}
                </div>
              </Card>
            )}

            {/* Chemical readings summary */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('service.chemicalReadings')}</h3>
              {lastReadings && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('service.comparedToLast')}</p>
              )}
              <div className="space-y-2">
                {ALL_READING_FIELDS.map(({ key, rangeKey, saltOnly }) => {
                  if (saltOnly && !isSaltPool) return null
                  const value = readings[key]
                  if (value === '') return null
                  const info = CHEMICAL_LABELS[key]
                  const range = targetRanges[rangeKey]
                  const status = getChemicalStatus(parseFloat(value), range)
                  const lastVal = lastReadings?.[key]
                  const diff = lastVal != null ? parseFloat(value) - lastVal : null
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(status))} />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{info?.label}</span>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{info?.unit}</span>
                        {diff !== null && diff !== 0 && (
                          <span className={cn(
                            'text-xs font-medium px-1.5 py-0.5 rounded',
                            diff > 0 ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                          )}>
                            {diff > 0 ? '↑' : '↓'}{Math.abs(diff).toFixed(1)}
                          </span>
                        )}
                        {diff === 0 && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                        )}
                        {range && !lastReadings && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">({range[0]}-{range[1]})</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {Object.values(readings).every(v => v === '') && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">{t('service.noReadings')}</p>
                )}
              </div>
            </Card>

            {/* Tasks summary — ONLY completed tasks, because this card
                mirrors what the customer sees on their report. Admins see
                the full ticked/unticked list on the service detail page. */}
            <Card>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('service.tasksTitle')}</h3>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                  {completedCount}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">{t('service.tasksCustomerNote')}</p>
              <div className="space-y-1.5">
                {tasks.filter(t => t.completed).length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">{t('service.noTasksDone')}</p>
                ) : tasks.filter(t => t.completed).map(task => (
                  <div key={task.name} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-500 shrink-0" strokeWidth={2} />
                    <span className="text-gray-900 dark:text-gray-100">
                      {translateTaskName(task.name, lang)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Chemicals summary — rows with a dose AND/OR a stock
                remaining note. chemicalsAdded is pre-populated with
                every library product, so most rows will be blank. */}
            {(() => {
              const used = chemicalsAdded.filter(c =>
                (c.dose_text && c.dose_text.trim()) ||
                (c.stock_remaining && c.stock_remaining.trim())
              )
              if (used.length === 0) return null
              return (
                <Card>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('service.chemicalsTitle')}</h3>
                  <div className="space-y-2">
                    {used.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-sm gap-3">
                        <span className="text-gray-700 dark:text-gray-300 min-w-0 truncate">{c.product_name}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100 shrink-0 tabular-nums">
                          {c.dose_text?.trim() || <span className="text-gray-400 dark:text-gray-500">—</span>}
                          {c.stock_remaining?.trim() && (
                            <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                              · {c.stock_remaining.trim()} left
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )
            })()}

            {/* Next service — hidden for a one-off (it doesn't set the recurring cadence). */}
            {!location.state?.oneOff && (
              <Card className="bg-gray-50 dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{t('service.nextServiceDue')}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                  </span>
                </div>
              </Card>
            )}

            {/* Required completion photo — proof of departure. Same
                watermark pipeline as the arrival photo (GPS +
                timestamp baked into the image). Saved with
                tag='completion' so it's distinguishable from the
                arrival / extra shots on report renderers. Gates the
                Complete Service button — same shape as the arrival
                gate at step 0. */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                {t('service.completionPhoto')} <span className="text-red-500" aria-label="required">*</span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {t('service.completionHint')}
              </p>
              <input
                ref={completionPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setCapturingCompletionPhoto(true)
                  try {
                    let lat = gpsRef.current?.latitude || null
                    let lng = gpsRef.current?.longitude || null
                    if (!lat) {
                      try {
                        const pos = await new Promise((resolve, reject) =>
                          navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true, timeout: 8000, maximumAge: 30000
                          })
                        )
                        lat = pos.coords.latitude
                        lng = pos.coords.longitude
                        gpsRef.current = pos.coords
                      } catch (geoErr) {
                        console.warn('GPS unavailable:', geoErr.message)
                      }
                    }
                    const now = new Date()
                    const meta = {
                      lat, lng, timestamp: now.toISOString(),
                      address: pool?.address || '',
                      clientName: client?.name || '',
                      poolName: pool?.name || '',
                      businessName: business?.name || '',
                      technicianName,
                    }
                    setCompletionPhotoMeta(meta)
                    const watermarked = await watermarkPhoto(file, meta)
                    setCompletionPhoto(watermarked.blob)
                    setCompletionPhotoPreview(watermarked.dataUrl)
                  } catch (err) {
                    console.error('Completion photo capture error:', err)
                    setCompletionPhoto(file)
                    const reader = new FileReader()
                    reader.onload = (ev) => setCompletionPhotoPreview(ev.target.result)
                    reader.readAsDataURL(file)
                  } finally {
                    setCapturingCompletionPhoto(false)
                  }
                }}
              />
              {completionPhotoPreview ? (
                <div className="relative">
                  <img
                    src={completionPhotoPreview}
                    alt="Completion photo"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-contain max-h-48 bg-gray-50 dark:bg-gray-800"
                  />
                  {completionPhotoMeta && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 dark:bg-green-950/40 px-2 py-1 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                        Verified Time
                      </span>
                      {completionPhotoMeta.lat && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 dark:bg-green-950/40 px-2 py-1 rounded-full">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                          Verified GPS
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setCompletionPhoto(null)
                        setCompletionPhotoPreview(null)
                        setCompletionPhotoMeta(null)
                        if (completionPhotoInputRef.current) completionPhotoInputRef.current.value = ''
                      }}
                      className="flex-1 text-center text-sm font-medium text-red-500 hover:text-red-600 py-2 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => {
                        setCompletionPhoto(null)
                        setCompletionPhotoPreview(null)
                        setCompletionPhotoMeta(null)
                        if (completionPhotoInputRef.current) completionPhotoInputRef.current.value = ''
                        completionPhotoInputRef.current?.click()
                      }}
                      className="flex-1 text-center text-sm font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700 py-2 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      Retake
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => completionPhotoInputRef.current?.click()}
                  disabled={capturingCompletionPhoto}
                  className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 dark:text-gray-500 hover:border-pool-400 hover:text-pool-500 transition-colors"
                >
                  {capturingCompletionPhoto ? (
                    <>
                      <svg className="w-7 h-7 animate-spin text-pool-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs font-medium text-pool-600 dark:text-pool-400">{t('service.processingPhoto')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <span className="text-sm font-medium">{t('service.tapTakeCompletion')}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Notes & Issues — read-only echo of what was entered on the
                Tasks step, so the tech can confirm before completing. */}
            {notes.trim() && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{t('service.notesIssuesTitle')}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{notes}</p>
              </Card>
            )}

            {/* Email notice */}
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              {client?.email
                ? t('service.emailNotice', { email: client.email })
                : t('service.noEmailNotice')}
            </p>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(3)} className="flex-1 min-h-[48px]">
                {t('common.back')}
              </Button>
              <Button
                onClick={handleComplete}
                loading={submitting}
                disabled={!completionPhoto}
                className="flex-1 min-h-[52px] text-base font-semibold bg-green-600 hover:bg-green-700 active:bg-green-800"
              >
                {t('service.completeService')}
              </Button>
            </div>
            {!completionPhoto && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">
                {t('service.takeCompletionToFinish')}
              </p>
            )}
          </div>
        )}

        {/* Completion success screen */}
        {completed && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" strokeWidth={2} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('service.serviceComplete')}</h2>
            {pool?.name && <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{pool.name}</p>}
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{pool?.address}</p>
            {client?.email && (
              <p className="text-sm text-green-600 dark:text-green-400 mb-4">
                {t('service.reportSentTo', { email: client.email })}
              </p>
            )}
            {!location.state?.oneOff && (
              <Card className="w-full bg-gray-50 dark:bg-gray-800 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{t('service.nextService')}</span>
                  <span className="text-sm font-semibold text-pool-600 dark:text-pool-400">
                    {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                  </span>
                </div>
              </Card>
            )}
            {searchParams.get('serviceId') && (
              <Button
                variant="secondary"
                className="w-full min-h-[48px] mb-3"
                onClick={() => navigate(`/services/${searchParams.get('serviceId')}`)}
              >
                View service details
              </Button>
            )}
            <div className="flex gap-3 w-full">
              {isTech && nextStop ? (
                <Button
                  className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700"
                  onClick={() => navigate(`/pools/${nextStop.id}/service?staff=${staffRecord?.id}`)}
                >
                  {t('service.nextStop')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    className="flex-1 min-h-[48px]"
                    onClick={() => navigate(`/pools/${poolId}`)}
                  >
                    {t('service.viewPool')}
                  </Button>
                  <Button
                    className="flex-1 min-h-[48px]"
                    onClick={() => navigate(isTech ? '/tech' : '/schedule')}
                  >
                    {isTech ? t('service.runSheet') : t('service.nextPool')}
                  </Button>
                </>
              )}
            </div>
            {isTech && nextStop && (
              <button
                onClick={() => navigate('/tech')}
                className="text-sm text-pool-600 dark:text-pool-400 font-semibold mt-2"
              >
                {t('profile.backToRunSheet')}
              </button>
            )}
            {isTech && !nextStop && (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium mt-2">{t('service.allStopsDone')}</p>
            )}
          </div>
        )}
      </PageWrapper>
    </>
  )
}

// Watermark photo with timestamp, GPS, address, and business name
function watermarkPhoto(file, meta) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1400
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      // ── Watermark bar (bottom), sized to fit ALL its text ──────────────
      // Both columns are drawn from the bottom edge UPWARD, so the lowest line
      // sits `pad` above the image edge and nothing is ever clipped off the
      // canvas. (The old layout used fixed per-line offsets that, scaled up on
      // large/tall photos, pushed the address + GPS past the bottom and baked
      // them off the image.)
      const scale = Math.min(width, height) / 400
      const pad = 14 * scale
      const gap = 6 * scale
      const fontFor = (l) => `${l.bold ? 'bold ' : ''}${l.size}px -apple-system, BlinkMacSystemFont, sans-serif`

      const ts = new Date(meta.timestamp)
      const timeStr = ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
      const dateStr = ts.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

      // Left column — top → bottom display order (time, customer, date, address, GPS).
      const leftLines = [
        { text: timeStr, size: Math.round(20 * scale), bold: true, alpha: 1 },
      ]
      if (meta.clientName) leftLines.push({ text: meta.clientName, size: Math.round(13 * scale), bold: false, alpha: 0.95 })
      if (meta.poolName) leftLines.push({ text: meta.poolName, size: Math.round(12 * scale), bold: false, alpha: 0.9 })
      leftLines.push({ text: dateStr, size: Math.round(12 * scale), bold: false, alpha: 0.85 })
      if (meta.address) leftLines.push({ text: meta.address, size: Math.round(11 * scale), bold: false, alpha: 0.9 })
      if (meta.lat && meta.lng) leftLines.push({ text: `${meta.lat.toFixed(6)}, ${meta.lng.toFixed(6)}`, size: Math.round(9 * scale), bold: false, alpha: 0.6 })

      // Right column (technician + business) — rendered TOP-right (drawn below).
      const rightLines = []
      if (meta.technicianName) rightLines.push({ text: meta.technicianName, size: Math.round(10 * scale), bold: false, alpha: 0.85 })
      if (meta.businessName) rightLines.push({ text: meta.businessName, size: Math.round(12 * scale), bold: true, alpha: 0.9 })

      // Bottom bar sized to the LEFT column only (the right column now lives top-right).
      const colHeight = (lines) => lines.reduce((s, l) => s + l.size, 0) + gap * Math.max(0, lines.length - 1)
      const barH = colHeight(leftLines) + pad * 2

      const grad = ctx.createLinearGradient(0, height - barH, 0, height)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.3, 'rgba(0,0,0,0.65)')
      grad.addColorStop(1, 'rgba(0,0,0,0.85)')
      ctx.fillStyle = grad
      ctx.fillRect(0, height - barH, width, barH)

      ctx.textBaseline = 'alphabetic'

      // Left column, drawn bottom → top.
      ctx.textAlign = 'left'
      let ly = height - pad
      for (let i = leftLines.length - 1; i >= 0; i--) {
        const l = leftLines[i]
        ctx.font = fontFor(l)
        ctx.fillStyle = `rgba(255,255,255,${l.alpha})`
        ctx.fillText(l.text, pad, ly)
        ly -= l.size + gap
      }

      // Right column (technician + business) — TOP-right, drawn top → down, with
      // its own top gradient so it stays legible over bright skies.
      if (rightLines.length) {
        const topBarH = colHeight(rightLines) + pad * 2
        const topGrad = ctx.createLinearGradient(0, 0, 0, topBarH)
        topGrad.addColorStop(0, 'rgba(0,0,0,0.85)')
        topGrad.addColorStop(0.7, 'rgba(0,0,0,0.55)')
        topGrad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = topGrad
        ctx.fillRect(0, 0, width, topBarH)

        ctx.textAlign = 'right'
        let ry = pad + rightLines[0].size
        for (let i = 0; i < rightLines.length; i++) {
          const l = rightLines[i]
          ctx.font = fontFor(l)
          ctx.fillStyle = `rgba(255,255,255,${l.alpha})`
          ctx.fillText(l.text, width - pad, ry)
          ry += l.size + gap
        }
        ctx.textAlign = 'left'
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Watermark failed'))
          // JPEG, not WebP — Outlook desktop / Outlook.com don't render WebP,
          // so the watermarked report photo must be a universally-supported format.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          resolve({ blob, dataUrl })
        },
        'image/jpeg',
        0.85
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}
