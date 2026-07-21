import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import StaffCard from '../../components/ui/StaffCard'
import { supabase } from '../../lib/supabase'
import { withDeadline, DEADLINE_MS } from '../../lib/deadline'
import {
  formatDate,
  getChemicalStatus,
  statusDot,
  CHEMICAL_LABELS,
  FREQUENCY_LABELS,
  DEFAULT_TARGET_RANGES,
  cn,
} from '../../lib/utils'
import { Calendar, Check } from 'lucide-react'

const CHEMICAL_KEYS = ['ph', 'free_chlorine', 'total_chlorine', 'alkalinity', 'stabiliser', 'calcium_hardness', 'salt']
const RANGE_KEY_MAP = { ph: 'ph', free_chlorine: 'free_cl', total_chlorine: 'total_cl', alkalinity: 'alk', stabiliser: 'stabiliser', calcium_hardness: 'calcium', salt: 'salt' }

const CATEGORY_LABELS = {
  sanitiser: 'Sanitiser', oxidiser: 'Oxidiser / Shock', balancer: 'Water Balancer',
  algaecide: 'Algaecide', clarifier: 'Clarifier', stabiliser: 'Stabiliser',
  salt: 'Salt', other: 'Other',
}
const CATEGORY_STYLES = {
  sanitiser:  { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-400' },
  oxidiser:   { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-400' },
  balancer:   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-400' },
  algaecide:  { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-400' },
  clarifier:  { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-400' },
  stabiliser: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-400' },
  salt:       { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-400' },
  other:      { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-300' },
}

// Status → colour/label for the headline stat tiles. green/amber/red/neutral come
// from getChemicalStatus; the labels are customer-friendly (not "amber/red").
const STAT_STATUS = {
  green:   { label: 'In range',     text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', dot: 'bg-emerald-500' },
  amber:   { label: 'Keep an eye',  text: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   dot: 'bg-amber-500' },
  red:     { label: 'Out of range', text: 'text-red-700',     bg: 'bg-red-50',     ring: 'ring-red-200',     dot: 'bg-red-500' },
  neutral: { label: 'Recorded',     text: 'text-gray-700',    bg: 'bg-gray-50',    ring: 'ring-gray-200',    dot: 'bg-gray-400' },
}

const SECTION = 'text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2'

function photoUrl(p) {
  return p?.signed_url || supabase.storage.from('service-photos').getPublicUrl(p?.storage_path).data?.publicUrl
}

// Big headline reading (pH / Total Chlorine). The two the tech records first.
function StatTile({ label, value, unit, range }) {
  const has = value != null
  const status = has && range ? getChemicalStatus(value, range) : 'neutral'
  const s = STAT_STATUS[status]
  return (
    <div className={cn('rounded-2xl p-4 sm:p-5 ring-1', s.bg, s.ring)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <span className={cn('w-2.5 h-2.5 rounded-full', s.dot)} />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={cn('text-4xl font-extrabold tabular-nums leading-none', has ? s.text : 'text-gray-300')}>
          {has ? value : '—'}
        </span>
        {has && unit && <span className="text-sm font-medium text-gray-400">{unit}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className={cn('text-xs font-semibold', has ? s.text : 'text-gray-400')}>{has ? s.label : 'Not recorded'}</span>
        {range && <span className="text-[11px] text-gray-400">Target {range[0]}–{range[1]}</span>}
      </div>
    </div>
  )
}

function ChemicalsAdded({ chemicalsAdded, chemProductMap }) {
  if (!chemicalsAdded?.length) return null
  return (
    <div>
      <h5 className={SECTION}>Chemicals added</h5>
      <div className="space-y-2">
        {chemicalsAdded.map((c, i) => {
          const key = c.product_name.toLowerCase().trim()
          let product = chemProductMap?.[key]
          if (!product) {
            for (const [cpKey, cpVal] of Object.entries(chemProductMap || {})) {
              if (cpKey.includes(key) || key.includes(cpKey)) { product = cpVal; break }
            }
          }
          const cat = product?.category || 'other'
          const style = CATEGORY_STYLES[cat] || CATEGORY_STYLES.other
          return (
            <div key={i} className={cn('rounded-xl border-l-[3px] bg-white ring-1 ring-gray-100 p-3', style.border)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{c.product_name}</p>
                  <span className={cn('inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1', style.bg, style.text)}>
                    {CATEGORY_LABELS[cat] || 'Other'}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  {c.dose_text ? (
                    <span className="text-lg font-bold text-gray-900">{c.dose_text}</span>
                  ) : c.quantity ? (
                    <><span className="text-lg font-bold text-gray-900">{c.quantity}</span><span className="text-xs text-gray-500 ml-1">{c.unit}</span></>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>
              </div>
              {product?.suggested_dose && <p className="text-[11px] text-gray-500 mt-1.5">Recommended: {product.suggested_dose}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TasksDone({ tasks }) {
  const done = tasks?.filter(t => t.completed) || []
  if (!done.length) return null
  return (
    <div>
      <h5 className={SECTION}>Tasks completed</h5>
      <div className="flex flex-wrap gap-1.5">
        {done.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
            <Check className="w-3 h-3" /> {t.task_name}
          </span>
        ))}
      </div>
    </div>
  )
}

function ReadingsList({ chemLog, ranges }) {
  const keys = CHEMICAL_KEYS.filter(k => chemLog?.[k] != null)
  if (!keys.length) return null
  return (
    <div>
      <h5 className={SECTION}>Water readings</h5>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
        {keys.map(key => {
          const val = chemLog[key]
          const range = ranges?.[RANGE_KEY_MAP[key]]
          const status = getChemicalStatus(val, range)
          return (
            <div key={key} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn('w-2 h-2 rounded-full shrink-0', statusDot(status))} />
                <span className="text-sm text-gray-600 truncate">{CHEMICAL_LABELS[key]?.label}</span>
              </div>
              <span className="text-sm font-semibold text-gray-900 shrink-0">
                {val}{CHEMICAL_LABELS[key]?.unit && <span className="text-xs text-gray-400 ml-0.5">{CHEMICAL_LABELS[key].unit}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PhotoGrid({ photos }) {
  if (!photos?.length) return null
  return (
    <div>
      <h5 className={SECTION}>Photos</h5>
      <div className={cn('grid gap-2', photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {photos.map((p, i) => (
          <img key={i} src={photoUrl(p)} alt="Pool" className="w-full h-auto rounded-xl bg-gray-100" />
        ))}
      </div>
    </div>
  )
}

// One past service — collapsed to a date row, expands to the full detail. No
// health score, no notes (customer-facing).
function ServiceCard({ record, chemLog, tasks, chemicalsAdded, photos, ranges, chemProductMap, brandColor }) {
  const [expanded, setExpanded] = useState(false)
  const completedTasks = tasks?.filter(t => t.completed).length || 0
  const chemCount = chemicalsAdded?.length || 0
  return (
    <div className={cn('rounded-2xl border transition-all', expanded ? 'bg-white shadow-md border-gray-200' : 'bg-white border-gray-100 hover:border-gray-200')}>
      <button onClick={() => setExpanded(v => !v)} className="w-full px-4 py-3.5 flex items-center gap-3 text-left min-h-[56px]">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: brandColor + '18' }}>
          <Calendar className="w-4 h-4" style={{ color: brandColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-gray-900 text-sm">{formatDate(record.serviced_at)}</span>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {record.technician_name ? `${record.technician_name} · ` : ''}
            {completedTasks} task{completedTasks === 1 ? '' : 's'}{chemCount ? ` · ${chemCount} chemical${chemCount === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <svg className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', expanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <ReadingsList chemLog={chemLog} ranges={ranges} />
          <TasksDone tasks={tasks} />
          <ChemicalsAdded chemicalsAdded={chemicalsAdded} chemProductMap={chemProductMap} />
          <PhotoGrid photos={photos} />
        </div>
      )}
    </div>
  )
}

function PoolSection({ pool, serviceRecords, chemicalLogs, tasksByRecord, chemAddedByRecord, photosByRecord, brandColor, chemProductMap }) {
  const ranges = pool.target_ranges || DEFAULT_TARGET_RANGES
  const latest = serviceRecords[0] || null
  const latestLog = latest ? chemicalLogs[latest.id] : null
  const latestPhotos = latest ? (photosByRecord[latest.id] || []) : []
  const hero = latestPhotos.find(p => p.tag === 'completion') || latestPhotos[0] || null
  const heroUrl = hero ? photoUrl(hero) : null
  const isOverdue = pool.next_due_at && new Date(pool.next_due_at) < new Date()

  const latestTasks = latest ? tasksByRecord[latest.id] : []
  const latestChems = latest ? chemAddedByRecord[latest.id] : []
  const hasLatestExtras = (latestChems?.length || 0) > 0 || (latestTasks?.some(t => t.completed))

  return (
    <div className="mb-10">
      {/* ── Hero: the customer's actual pool ─────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden mb-5 shadow-sm">
        {heroUrl ? (
          <img src={heroUrl} alt="Your pool" className="w-full h-52 sm:h-64 object-cover" />
        ) : (
          <div className="w-full h-36" style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColor}bb)` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
          <div className="flex items-center gap-2 mb-1.5">
            {pool.type && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm capitalize">{pool.type}</span>
            )}
            {pool.volume_litres && <span className="text-xs text-white/75">{Number(pool.volume_litres).toLocaleString()}L</span>}
          </div>
          <h3 className="text-xl font-bold leading-tight drop-shadow-sm">{pool.address}</h3>
          {latest && (
            <p className="text-sm text-white/85 mt-1">
              Last serviced {formatDate(latest.serviced_at)}{latest.technician_name ? ` by ${latest.technician_name}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* ── Next service ─────────────────────────────────────────────── */}
      {pool.next_due_at && (
        <div className={cn('rounded-2xl p-4 mb-5 flex items-center justify-between ring-1',
          isOverdue ? 'bg-red-50 ring-red-200' : 'bg-emerald-50 ring-emerald-200')}>
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', isOverdue ? 'bg-red-100' : 'bg-emerald-100')}>
              <Calendar className={cn('w-5 h-5', isOverdue ? 'text-red-600' : 'text-emerald-600')} />
            </div>
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500">{isOverdue ? 'Overdue' : 'Next service'}</p>
              <p className={cn('text-base font-bold', isOverdue ? 'text-red-600' : 'text-emerald-700')}>{formatDate(pool.next_due_at)}</p>
            </div>
          </div>
          {pool.schedule_frequency && (
            <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', isOverdue ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
              {FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}
            </span>
          )}
        </div>
      )}

      {/* ── Latest Service Details ───────────────────────────────────── */}
      {latest && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-gray-900 text-lg">Latest Service Details</h4>
            <span className="text-xs text-gray-400">{formatDate(latest.serviced_at)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <StatTile label={CHEMICAL_LABELS.ph?.label || 'pH'} value={latestLog?.ph} unit={CHEMICAL_LABELS.ph?.unit} range={ranges.ph} />
            <StatTile label={CHEMICAL_LABELS.total_chlorine?.label || 'Total Chlorine'} value={latestLog?.total_chlorine} unit={CHEMICAL_LABELS.total_chlorine?.unit || 'ppm'} range={ranges.total_cl} />
          </div>

          {hasLatestExtras ? (
            <div className="space-y-5">
              <TasksDone tasks={latestTasks} />
              <ChemicalsAdded chemicalsAdded={latestChems} chemProductMap={chemProductMap} />
            </div>
          ) : (
            <p className="text-sm text-gray-400">No chemicals or tasks were logged for this visit.</p>
          )}
        </div>
      )}

      {/* ── Service history ──────────────────────────────────────────── */}
      {serviceRecords.length > 0 ? (
        <div>
          <h4 className="font-bold text-gray-900 mb-3">
            Service History <span className="text-sm font-normal text-gray-400 ml-1">{serviceRecords.length} visit{serviceRecords.length === 1 ? '' : 's'}</span>
          </h4>
          <div className="space-y-2">
            {serviceRecords.map(record => (
              <ServiceCard key={record.id} record={record} chemLog={chemicalLogs[record.id]}
                tasks={tasksByRecord[record.id]} chemicalsAdded={chemAddedByRecord[record.id]}
                photos={photosByRecord[record.id]} ranges={ranges} chemProductMap={chemProductMap} brandColor={brandColor} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white text-center py-8">
          <p className="text-gray-400 text-sm">No services recorded yet for this pool.</p>
        </div>
      )}
    </div>
  )
}

export default function PortalDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [business, setBusiness] = useState(null)
  const [clientName, setClientName] = useState('')
  const [pools, setPools] = useState([])
  const [serviceRecords, setServiceRecords] = useState({})
  const [chemicalLogs, setChemicalLogs] = useState({})
  const [tasksByRecord, setTasksByRecord] = useState({})
  const [chemAddedByRecord, setChemAddedByRecord] = useState({})
  const [photosByRecord, setPhotosByRecord] = useState({})
  const [staffMembers, setStaffMembers] = useState([])
  const [chemProductMap, setChemProductMap] = useState({})
  const [activePool, setActivePool] = useState(null)

  useEffect(() => {
    loadPortalData()
  }, [])

  async function loadPortalData() {
    try {
      setLoading(true)
      // Bounded: getUser resolves behind the auth lock — a wedged/suspended tab
      // could otherwise hang the whole portal on its spinner (see deadline.js).
      const { data: { user } } = await withDeadline(supabase.auth.getUser(), DEADLINE_MS, 'portal-getUser')
      if (!user) { navigate('/portal/login', { replace: true }); return }

      // Fetch all client records for this user
      const { data: clients } = await withDeadline(
        supabase.from('clients').select('*, pools(*)').eq('auth_user_id', user.id),
        DEADLINE_MS, 'portal-clients')

      if (!clients?.length) {
        navigate('/portal/login', { replace: true })
        return
      }

      setClientName(clients[0].name)

      // Business branding/contact via a definer RPC (name/logo/colour/phone/email
      // only — never Stripe/bank/report config).
      const { data: bizData } = await supabase.rpc('get_portal_business', { p_business_id: clients[0].business_id })
      setBusiness(bizData)

      const allPools = clients.flatMap(c => c.pools || [])
      setPools(allPools)
      if (allPools.length > 0) setActivePool(allPools[0].id)

      const poolIds = allPools.map(p => p.id)
      if (poolIds.length > 0) {
        // Explicit column list (not '*') — internal/admin-only columns (report_*
        // backstop bookkeeping, pool_condition, tech notes) must not ship to the
        // customer. Notes/issues are deliberately excluded from the portal.
        const { data: records } = await supabase
          .from('service_records')
          .select('id, pool_id, serviced_at, technician_name, status, service_tasks(*), chemicals_added(*), service_photos(*)')
          .in('pool_id', poolIds)
          .eq('status', 'completed')
          .order('serviced_at', { ascending: false })
          .limit(poolIds.length * 20)

        const grouped = {}, tasksMap = {}, chemsMap = {}, photosMap = {}
        for (const record of (records || [])) {
          if (!grouped[record.pool_id]) grouped[record.pool_id] = []
          if (grouped[record.pool_id].length < 20) grouped[record.pool_id].push(record)
          tasksMap[record.id] = record.service_tasks || []
          chemsMap[record.id] = record.chemicals_added || []
          photosMap[record.id] = record.service_photos || []
        }
        setServiceRecords(grouped)
        setTasksByRecord(tasksMap)
        setChemAddedByRecord(chemsMap)
        setPhotosByRecord(photosMap)

        const recordIds = (records || []).map(r => r.id)
        if (recordIds.length > 0) {
          const { data: logs } = await supabase
            .from('chemical_logs')
            .select('*')
            .in('service_record_id', recordIds)
          const logMap = {}
          for (const log of (logs || [])) logMap[log.service_record_id] = log
          setChemicalLogs(logMap)
        }
      }

      if (bizData?.id) {
        const [staffRes, chemProdRes] = await Promise.all([
          supabase.from('staff_members').select('*').eq('business_id', bizData.id).eq('is_active', true).order('name'),
          supabase.from('chemical_products').select('name, category, suggested_dose, notes').eq('business_id', bizData.id),
        ])
        setStaffMembers(staffRes.data || [])
        const cpMap = {}
        for (const cp of (chemProdRes.data || [])) cpMap[cp.name.toLowerCase()] = cp
        setChemProductMap(cpMap)
      }
    } catch (err) {
      console.error('Portal load error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/portal/login', { replace: true })
  }

  const totalServices = Object.values(serviceRecords).flat().length
  const brandColor = business?.brand_colour || '#0EA5E9'

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-10 w-10 border-4 border-pool-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading your portal...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="w-full pt-8 pb-10 px-4 relative overflow-hidden" style={{ backgroundColor: brandColor }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 15% 85%, white 0%, transparent 45%), radial-gradient(circle at 85% 15%, white 0%, transparent 45%)' }} />
        <div className="max-w-3xl mx-auto relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {business?.logo_url && (
                <img src={business.logo_url} alt={business.name} className="h-12 w-12 rounded-xl object-cover bg-white/20 shadow-lg" />
              )}
              <div className="text-white">
                <h1 className="text-xl font-bold leading-tight">{business?.name || 'Pool Service'}</h1>
                <p className="text-xs opacity-75">Customer Portal</p>
              </div>
            </div>
            <button onClick={handleSignOut} className="text-white/70 hover:text-white text-sm font-medium min-h-[44px] px-3">
              Sign Out
            </button>
          </div>

          <div className="mt-6 text-white">
            <h2 className="text-2xl font-bold">Hi {clientName || 'there'} 👋</h2>
            <p className="text-sm text-white/80 mt-1">
              Here's the latest on your pool{pools.length > 1 ? 's' : ''} — service details, readings and what's coming up.
            </p>
          </div>

          <div className="flex items-center gap-6 text-white/90 text-sm mt-5">
            {totalServices > 0 && (
              <div><span className="text-2xl font-bold text-white">{totalServices}</span><span className="ml-1 opacity-75">service{totalServices === 1 ? '' : 's'}</span></div>
            )}
            {pools.length > 0 && (
              <div><span className="text-2xl font-bold text-white">{pools.length}</span><span className="ml-1 opacity-75">{pools.length === 1 ? 'pool' : 'pools'}</span></div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto w-full px-4 py-6 flex-1 -mt-4">
        {pools.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {pools.map(pool => (
              <button key={pool.id} onClick={() => setActivePool(pool.id)}
                className={cn('px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[40px]',
                  activePool === pool.id ? 'text-white shadow-sm' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50')}
                style={activePool === pool.id ? { backgroundColor: brandColor } : undefined}>
                {pool.address}
              </button>
            ))}
          </div>
        )}

        {pools.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white text-center py-12">
            <p className="text-gray-500">No pools found for your account.</p>
          </div>
        ) : (
          pools.filter(p => pools.length === 1 || p.id === activePool).map(pool => (
            <PoolSection key={pool.id} pool={pool}
              serviceRecords={serviceRecords[pool.id] || []} chemicalLogs={chemicalLogs}
              tasksByRecord={tasksByRecord} chemAddedByRecord={chemAddedByRecord} photosByRecord={photosByRecord}
              brandColor={brandColor} chemProductMap={chemProductMap} />
          ))
        )}

        {staffMembers.length > 0 && (
          <section className="mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your service team</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {staffMembers.map(member => <StaffCard key={member.id} staff={member} brandColor={brandColor} />)}
            </div>
          </section>
        )}
      </div>

      <footer className="w-full border-t bg-white py-8 px-4 mt-auto">
        <div className="max-w-3xl mx-auto text-center text-sm text-gray-500 space-y-1">
          <p className="font-semibold text-gray-700">{business?.name}</p>
          <div className="flex items-center justify-center gap-4">
            {business?.phone && <p>{business.phone}</p>}
            {business?.email && <p>{business.email}</p>}
          </div>
          <p className="pt-3 text-xs text-gray-300">Powered by PoolPro</p>
        </div>
      </footer>
    </div>
  )
}
