import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import { useService } from '../hooks/useService'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import Badge from '../components/ui/Badge'
import { useToast } from '../contexts/ToastContext'
import { Check, Mail, Phone, Plus, X } from 'lucide-react'
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
  cn,
} from '../lib/utils'

// Step 0 ("Arrival") gates the rest of the flow on a live, GPS+
// timestamp watermarked photo. The tech can't enter chemical readings
// until they've proven they're physically at the pool. Replaces the
// old "pool & test kit" photo that lived inside the chemicals step
// (the one photo we capture is now this arrival photo, taken with the
// test kit visible — same shot, earlier in the flow, and required).
const STEPS = ['Arrival', 'Chemicals', 'Tasks', 'Added', 'Review']

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

export default function NewService() {
  const toast = useToast()
  const { id: poolId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { business, staffRecord, userRole } = useBusiness()
  const {
    loading: serviceLoading,
    createServiceRecord,
    saveChemicalLog,
    saveTasks,
    saveChemicalsAdded,
    saveServicePhoto,
    completeService,
  } = useService()

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

  // Pool photo
  const [servicePhoto, setServicePhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoMeta, setPhotoMeta] = useState(null) // { lat, lng, timestamp, address }
  const [capturingPhoto, setCapturingPhoto] = useState(false)
  // Optional second photo on the chemicals step — for "things" shots
  // (water condition, equipment found dodgy, on-site issues, etc.).
  // Not gated on, saved with tag='extra' alongside the test-kit photo.
  const [extraPhoto, setExtraPhoto] = useState(null)
  const [extraPhotoPreview, setExtraPhotoPreview] = useState(null)
  const [extraPhotoMeta, setExtraPhotoMeta] = useState(null)
  const [capturingExtraPhoto, setCapturingExtraPhoto] = useState(false)
  // Optional completion photo on the review step — proof of departure
  // / "leaving the pool in a good state" shot. Same watermark
  // pipeline; saved with tag='completion' so it's distinguishable
  // from the arrival photo on report renderers.
  const [completionPhoto, setCompletionPhoto] = useState(null)
  const [completionPhotoPreview, setCompletionPhotoPreview] = useState(null)
  const [completionPhotoMeta, setCompletionPhotoMeta] = useState(null)
  const [capturingCompletionPhoto, setCapturingCompletionPhoto] = useState(false)
  const gpsRef = useRef(null) // pre-fetched GPS position

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
      // Create service record
      const selectedStaff = staffList.find(s => s.id === selectedStaffId)
      const techName = selectedStaff?.name || business?.owner_name || 'Owner'
      const record = await createServiceRecord(poolId, techName, selectedStaffId || null)

      // Save chemical readings (convert empty strings to null)
      const cleanReadings = {}
      for (const [k, v] of Object.entries(readings)) {
        cleanReadings[k] = v === '' ? null : parseFloat(v)
      }
      await saveChemicalLog(record.id, cleanReadings)

      // Save tasks
      await saveTasks(record.id, tasks)

      // Save chemicals — keep rows where EITHER dose_text OR
      // stock_remaining is non-empty. A "noticed salt is low, bring
      // some" entry with no dose still saves so the office sees the
      // restock signal; same for a dose with no remaining note.
      const validChemicals = chemicalsAdded.filter(c => c.product_name && (
        (c.dose_text && c.dose_text.trim()) ||
        (c.stock_remaining && c.stock_remaining.trim())
      ))
      await saveChemicalsAdded(record.id, validChemicals.map(c => ({
        product_name: c.product_name,
        dose_text: c.dose_text?.trim() || null,
        stock_remaining: c.stock_remaining?.trim() || null,
      })))

      // Bump use_count on the library row so the admin can see which
      // chemicals are actually getting used. No new-row insert path —
      // tech can't add chemicals from this flow anymore (admin-only
      // via Settings → Chemicals).
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

      // Upload pool photo
      if (servicePhoto) {
        // Mandatory test-kit / arrival photo (always present at this point — gated at step 0).
        await saveServicePhoto(record.id, servicePhoto, photoMeta || {}, 'test-kit')
        // Optional second photo from the chemicals step. Saved with a
        // different tag so the report can render it under "On-site
        // photos" / etc. rather than mixed with the test-kit shot.
        if (extraPhoto) {
          try {
            await saveServicePhoto(record.id, extraPhoto, extraPhotoMeta || {}, 'extra')
          } catch (err) {
            // Non-fatal — main test-kit photo already saved, service
            // record exists, completion flow continues. Logging only.
            console.error('Extra photo save failed:', err)
          }
        }
        // Optional completion / departure photo from the review step.
        // Tag='completion' so the renderer can pair it with the
        // arrival shot ("here's the pool when I arrived ↔ when I left").
        if (completionPhoto) {
          try {
            await saveServicePhoto(record.id, completionPhoto, completionPhotoMeta || {}, 'completion')
          } catch (err) {
            // Non-fatal — same reasoning as extra photo above.
            console.error('Completion photo save failed:', err)
          }
        }
      }

      // Complete the service
      await completeService(record.id, poolId, notes)

      // Navigate to completion URL so it survives page reloads
      navigate(`/pools/${poolId}/service?done=1`, { replace: true })
      setCompleted(true)
      findNextStop()
    } catch (err) {
      console.error('Error completing service:', err)
      toast.error('Failed to complete service: ' + (err?.message || JSON.stringify(err)))
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
  const isSaltPool = pool?.pool_type === 'salt'

  if (loading) {
    return (
      <>
        <Header title="Loading..." backTo={-1} />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-pool-500 border-t-transparent rounded-full" />
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title={completed ? "Service Complete" : "New Service"} backTo={-1} />
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
                {label}
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
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
                </div>
                <Badge variant={pool?.type || 'default'} className="shrink-0 capitalize">{pool?.type || 'pool'}</Badge>
              </div>
            </Card>

            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Arrival photo</h2>
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
                      businessName: business?.name || '',
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
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-cover"
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
                      <span className="text-sm font-medium text-pool-600 dark:text-pool-400">Processing photo...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <span className="text-sm font-medium">Tap to take photo</span>
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
              Continue
            </Button>
            {!servicePhoto && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">Photo required to continue</p>
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
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{pool?.address}</p>
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
                label="Technician"
                value={selectedStaffId}
                onChange={e => setSelectedStaffId(e.target.value)}
                options={[
                  { value: '', label: 'Select technician...' },
                  ...staffList.map(s => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Chemical Readings</h2>
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
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Add reading</label>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setVisibleReadings(prev => [...prev, e.target.value])
                      }
                    }}
                  >
                    <option value="">Select a reading...</option>
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

            {/* Optional photo — for "things" the tech wants to flag:
                water condition, dodgy equipment, an issue worth a
                photo. Distinct from the mandatory arrival/test-kit
                shot in step 0; saved with tag='extra' so the report
                renderer can lay it out separately. Same watermark
                pipeline (GPS + timestamp baked in) for consistency. */}
            <div className="mt-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Photo <span className="text-xs font-normal text-gray-400 dark:text-gray-500">(optional)</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Snap anything worth recording — water condition, equipment, an issue. Skip if nothing to add.
              </p>
              <input
                ref={extraPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
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
                      businessName: business?.name || '',
                    }
                    setExtraPhotoMeta(meta)
                    const watermarked = await watermarkPhoto(file, meta)
                    setExtraPhoto(watermarked.blob)
                    setExtraPhotoPreview(watermarked.dataUrl)
                  } catch (err) {
                    console.error('Extra photo capture error:', err)
                    setExtraPhoto(file)
                    const reader = new FileReader()
                    reader.onload = (ev) => setExtraPhotoPreview(ev.target.result)
                    reader.readAsDataURL(file)
                  } finally {
                    setCapturingExtraPhoto(false)
                  }
                }}
              />
              {extraPhotoPreview ? (
                <div className="relative">
                  <img
                    src={extraPhotoPreview}
                    alt="Extra photo"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-cover"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setExtraPhoto(null)
                        setExtraPhotoPreview(null)
                        setExtraPhotoMeta(null)
                        if (extraPhotoInputRef.current) extraPhotoInputRef.current.value = ''
                      }}
                      className="flex-1 text-center text-sm font-medium text-red-500 hover:text-red-600 py-2 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => {
                        setExtraPhoto(null)
                        setExtraPhotoPreview(null)
                        setExtraPhotoMeta(null)
                        if (extraPhotoInputRef.current) extraPhotoInputRef.current.value = ''
                        extraPhotoInputRef.current?.click()
                      }}
                      className="flex-1 text-center text-sm font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700 py-2 border border-gray-200 dark:border-gray-700 rounded-lg"
                    >
                      Replace
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => extraPhotoInputRef.current?.click()}
                  disabled={capturingExtraPhoto}
                  className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 dark:text-gray-500 hover:border-pool-400 hover:text-pool-500 transition-colors"
                >
                  {capturingExtraPhoto ? (
                    <>
                      <svg className="w-7 h-7 animate-spin text-pool-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs font-medium text-pool-600 dark:text-pool-400">Processing photo...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <span className="text-sm font-medium">Tap to add photo</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <Button
              onClick={() => setStep(2)}
              className="w-full min-h-[48px] mt-4"
            >
              Next: Tasks
            </Button>
          </div>
        )}

        {/* Step 2: Task Checklist */}
        {step === 2 && !completed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Task Checklist</h2>
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
                      {task.name}
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
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Add common task</label>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setTasks(prev => [...prev, { name: e.target.value, completed: false }])
                      }
                    }}
                  >
                    <option value="">Select a task...</option>
                    {available.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )
            })()}

            {/* Custom task input */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Add custom task</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="e.g. Replaced O-ring"
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
                  Add
                </Button>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(1)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!allRequiredDone}
                className="flex-1 min-h-[48px]"
              >
                Next: Chemicals
              </Button>
            </div>
            {!allRequiredDone && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">
                Complete all <span className="text-red-500">*</span> tasks to continue
              </p>
            )}
          </div>
        )}

        {/* Step 3: Chemicals Added — flat list of every library
            chemical with an inline quantity input. Tech types in the
            amount they used; blanks are filtered out on save. No
            search, no add button — the library is admin-managed via
            Settings → Chemicals (canonical seven seeded by the
            20260508 migration plus whatever the admin adds). */}
        {step === 3 && !completed && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Chemicals Added</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              Enter the amount of each chemical you used. Leave blank if not used.
            </p>

            {chemicalsAdded.length === 0 ? (
              <Card>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                  No chemicals in the library. Ask an admin to add some via{' '}
                  <span className="font-medium text-gray-700 dark:text-gray-200">Settings → Chemicals</span>.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {/* Header row — labels above the inputs so the tech
                    knows which column is which. Hidden on narrow
                    screens to keep the row compact. */}
                <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <span>Chemical</span>
                  <span className="text-center">Added</span>
                  <span className="text-center">Remaining</span>
                </div>
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden bg-white dark:bg-gray-900">
                  {chemicalsAdded.map((chem, i) => (
                    <div key={chem.product_name || i} className="px-4 py-3 grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 items-center">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {chem.product_name}
                      </span>
                      {/* Dose — what the tech added. Freeform so they
                          can write "100g", "1kg", "half scoop", etc. */}
                      <input
                        type="text"
                        value={chem.dose_text}
                        onChange={e => updateChemical(i, 'dose_text', e.target.value)}
                        placeholder="e.g. 100g"
                        className="input !w-full text-right"
                        aria-label={`${chem.product_name} added`}
                      />
                      {/* Stock remaining at the client — also
                          freeform. Empty if the tech didn't note it. */}
                      <input
                        type="text"
                        value={chem.stock_remaining}
                        onChange={e => updateChemical(i, 'stock_remaining', e.target.value)}
                        placeholder="e.g. 3kg"
                        className="input !w-full text-right"
                        aria-label={`${chem.product_name} stock remaining`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(2)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button onClick={() => setStep(4)} className="flex-1 min-h-[48px]">
                Next: Review
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

            {/* Pool photo */}
            {photoPreview && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Pool & Test Kit Photo</h3>
                <img
                  src={photoPreview}
                  alt="Pool & test kit"
                  className="w-full rounded-lg object-cover max-h-56"
                />
              </Card>
            )}

            {/* Chemical readings summary */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Chemical Readings</h3>
              {lastReadings && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Compared to last service</p>
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
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">No readings recorded</p>
                )}
              </div>
            </Card>

            {/* Tasks summary */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tasks</h3>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  completedCount === tasks.length ? 'bg-green-100 text-green-700' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                )}>
                  {completedCount}/{tasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {tasks.map(task => (
                  <div key={task.name} className="flex items-center gap-2 text-sm">
                    {task.completed ? (
                      <Check className="w-4 h-4 text-green-500 shrink-0" strokeWidth={2} />
                    ) : (
                      <X className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" strokeWidth={2} />
                    )}
                    <span className={task.completed ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}>
                      {task.name}
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
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Chemicals</h3>
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

            {/* Next service */}
            <Card className="bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Next service due</span>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                </span>
              </div>
            </Card>

            {/* Required completion photo — proof of departure. Same
                watermark pipeline as the arrival photo (GPS +
                timestamp baked into the image). Saved with
                tag='completion' so it's distinguishable from the
                arrival / extra shots on report renderers. Gates the
                Complete Service button — same shape as the arrival
                gate at step 0. */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Completion photo <span className="text-red-500" aria-label="required">*</span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Snap a finishing shot — timestamp + GPS baked in automatically.
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
                      businessName: business?.name || '',
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
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 object-cover"
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
                      <span className="text-xs font-medium text-pool-600 dark:text-pool-400">Processing photo...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <span className="text-sm font-medium">Tap to take completion photo</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Notes */}
            <TextArea
              label="Notes / Recommendations"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes for the client or for next visit..."
              rows={3}
            />

            {/* Email notice */}
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              {client?.email
                ? `A service report will be emailed to ${client.email}`
                : 'No client email set — report will be saved but not emailed'}
            </p>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(3)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button
                onClick={handleComplete}
                loading={submitting}
                disabled={!completionPhoto}
                className="flex-1 min-h-[52px] text-base font-semibold bg-green-600 hover:bg-green-700 active:bg-green-800"
              >
                Complete Service
              </Button>
            </div>
            {!completionPhoto && (
              <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1">
                Take a completion photo to finish the service
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
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">Service Complete</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{pool?.address}</p>
            {client?.email && (
              <p className="text-sm text-green-600 dark:text-green-400 mb-4">
                Report sent to {client.email}
              </p>
            )}
            <Card className="w-full bg-gray-50 dark:bg-gray-800 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Next service</span>
                <span className="text-sm font-semibold text-pool-600 dark:text-pool-400">
                  {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                </span>
              </div>
            </Card>
            <div className="flex gap-3 w-full">
              {isTech && nextStop ? (
                <Button
                  className="flex-1 min-h-[48px] bg-green-600 hover:bg-green-700"
                  onClick={() => navigate(`/pools/${nextStop.id}/service?staff=${staffRecord?.id}`)}
                >
                  Next Stop →
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    className="flex-1 min-h-[48px]"
                    onClick={() => navigate(`/pools/${poolId}`)}
                  >
                    View Pool
                  </Button>
                  <Button
                    className="flex-1 min-h-[48px]"
                    onClick={() => navigate(isTech ? '/tech' : '/schedule')}
                  >
                    {isTech ? 'Run Sheet' : 'Next Pool'}
                  </Button>
                </>
              )}
            </div>
            {isTech && nextStop && (
              <button
                onClick={() => navigate('/tech')}
                className="text-sm text-pool-600 dark:text-pool-400 font-semibold mt-2"
              >
                Back to Run Sheet
              </button>
            )}
            {isTech && !nextStop && (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium mt-2">All stops completed for today!</p>
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

      // Watermark bar at bottom
      const barH = Math.max(80, height * 0.1)
      const grad = ctx.createLinearGradient(0, height - barH, 0, height)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.3, 'rgba(0,0,0,0.6)')
      grad.addColorStop(1, 'rgba(0,0,0,0.8)')
      ctx.fillStyle = grad
      ctx.fillRect(0, height - barH, width, barH)

      // Text settings
      const scale = Math.min(width, height) / 400
      const pad = 12 * scale

      // Timestamp — large
      const ts = new Date(meta.timestamp)
      const timeStr = ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
      const dateStr = ts.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

      ctx.fillStyle = 'white'
      ctx.font = `bold ${Math.round(18 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.textBaseline = 'bottom'
      ctx.fillText(timeStr, pad, height - barH + 30 * scale)

      ctx.font = `${Math.round(11 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillText(dateStr, pad, height - barH + 45 * scale)

      // Address
      if (meta.address) {
        ctx.font = `${Math.round(10 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillText(meta.address, pad, height - barH + 60 * scale)
      }

      // GPS coordinates
      if (meta.lat && meta.lng) {
        ctx.font = `${Math.round(9 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillText(`${meta.lat.toFixed(6)}, ${meta.lng.toFixed(6)}`, pad, height - barH + 73 * scale)
      }

      // Business name — right side
      if (meta.businessName) {
        ctx.font = `bold ${Math.round(11 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'right'
        ctx.fillText(meta.businessName, width - pad, height - pad)
        ctx.textAlign = 'left'
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Watermark failed'))
          const dataUrl = canvas.toDataURL('image/webp', 0.85)
          resolve({ blob, dataUrl })
        },
        'image/webp',
        0.85
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}
