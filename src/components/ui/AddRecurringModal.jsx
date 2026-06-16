import { useState, useEffect, useRef } from 'react'
import { Search, X, Pencil, User, Droplet, Calendar as CalendarIcon, Mail, Phone, MapPin, Plus, Trash2 } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import Input, { Select, TextArea } from './Input'
import LocationField from './LocationField'
import NewClientModal from './NewClientModal'
import NewPoolModal from './NewPoolModal'
import NewTechnicianModal from './NewTechnicianModal'
import { supabase } from '../../lib/supabase'
import { cn, formatDateWithDay } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { recomputePoolNextDue } from '../../lib/recomputePoolNextDue'
import RecurrencePicker from './RecurrencePicker'
import {
  RECURRENCE_OPTIONS,
  profileFieldsFromForm,
} from '../../lib/recurringScheduling'

// One schedule = one recurring_job_profiles row. The modal lets the
// operator stack multiple schedules for the same client + pool in one
// transaction (e.g. weekly Tuesday + weekly Friday → two profiles).
// Each schedule owns its own date / rule / duration / tech / notes;
// client + pool are shared at the top of the modal.
function blankSchedule() {
  return {
    recurrenceRule: 'weekly',
    customDays: 7,
    firstDate: new Date().toISOString().split('T')[0],
    durationType: 'ongoing',
    endDate: '',
    totalVisits: '',
    assignedStaffId: '',
    notes: '',
    // Edit-only fields — surfaced in ScheduleSection when detailFields is
    // on (edit mode). Create leaves them blank (auto-title, null price/etc).
    title: '',
    jobTypeTemplateId: '',
    preferredTime: '',
    price: '',
  }
}

// Map an existing recurring_job_profiles row into a single schedule
// object so the unified modal can edit it. Inverse of the payload built
// in handleSubmit's edit branch.
function scheduleFromProfile(p) {
  // The "First service date" field shows the IMMUTABLE series_anchor_date — the
  // true start of the pattern, not the (drifting) next-due mirror. Pre-migration
  // rows have no series_anchor_date yet, so fall back to next_generation_at (the
  // migration backfills series_anchor_date from it, so the grid is identical).
  // _anchor preserves the original so the edit path can tell whether the
  // operator actually re-anchored vs. just edited price/notes/tech.
  const anchor = p.series_anchor_date
    ? String(p.series_anchor_date).split('T')[0]
    : (p.next_generation_at ? String(p.next_generation_at).split('T')[0] : '')
  return {
    recurrenceRule: p.recurrence_rule || 'weekly',
    customDays: p.custom_interval_days || 7,
    firstDate: anchor || new Date().toISOString().split('T')[0],
    _anchor: anchor,
    durationType: p.duration_type || 'ongoing',
    endDate: p.end_date ? String(p.end_date).split('T')[0] : '',
    totalVisits: p.total_visits ?? '',
    assignedStaffId: p.assigned_staff_id || '',
    notes: p.notes || '',
    title: p.title || '',
    jobTypeTemplateId: p.job_type_template_id || '',
    preferredTime: p.preferred_time ? String(p.preferred_time).slice(0, 5) : '',
    price: p.price ?? '',
  }
}

export default function AddRecurringModal({ open, onClose, business, staff, onCreated, editProfile = null, jobTypes = [] }) {
  const toast = useToast()
  const isEdit = !!editProfile
  // Loaded data
  const [clients, setClients] = useState([])
  const [clientPools, setClientPools] = useState([])
  const [localStaff, setLocalStaff] = useState([])

  // Selections (shared across all schedules)
  const [clientId, setClientId] = useState('')
  const [poolId, setPoolId] = useState('')

  // Client search dropdown
  const [clientSearch, setClientSearch] = useState('')
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const clientDropdownRef = useRef(null)

  // Close the search dropdown when the operator clicks anywhere
  // outside it. Without this, the only way to dismiss it was to pick
  // a result.
  useEffect(() => {
    if (!clientDropdownOpen) return
    function onPointerDown(e) {
      const node = clientDropdownRef.current
      if (node && !node.contains(e.target)) setClientDropdownOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setClientDropdownOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [clientDropdownOpen])

  // Schedules. Each entry is one independent recurring_job_profile row.
  // Always at least 1; "+ Add another schedule" appends a blankSchedule().
  // Per-schedule fields: date, rule, customDays, duration, technician, notes.
  const [schedules, setSchedules] = useState([blankSchedule()])

  // Which schedule index initiated "+ Add Technician"? Set when the
  // operator clicks the option in a ScheduleSection's tech dropdown so
  // the freshly-created tech auto-selects on the right schedule.
  const [pendingTechScheduleIdx, setPendingTechScheduleIdx] = useState(null)

  // Nested modal state
  const [showNewClient, setShowNewClient] = useState(false)
  const [showNewPool, setShowNewPool] = useState(false)
  const [showNewTech, setShowNewTech] = useState(false)
  const [editingClient, setEditingClient] = useState(false)
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', address: '', lat: null, lng: null })
  const [editClientSaving, setEditClientSaving] = useState(false)

  const [saving, setSaving] = useState(false)

  // Fetch clients on open
  useEffect(() => {
    if (!open || !business?.id) return
    supabase.from('clients').select('id, name, address, email, phone, latitude, longitude').eq('business_id', business.id).order('name')
      .then(({ data }) => setClients(data || []))
  }, [open, business?.id])

  // Fetch pools when client changes
  useEffect(() => {
    if (!clientId) { setClientPools([]); return }
    supabase.from('pools').select('id, name, address').eq('client_id', clientId)
      .then(({ data }) => {
        setClientPools(data || [])
        // Auto-select if only one pool — but never override an explicit
        // selection (e.g. the pool we just loaded for an edit).
        if (data?.length === 1 && !poolId) setPoolId(data[0].id)
      })
  }, [clientId])

  // Edit mode: hydrate client + pool + a single schedule from the profile
  // when the modal opens. Keyed on the profile id so re-opening Edit for a
  // different row reloads. Create mode leaves the create defaults intact.
  useEffect(() => {
    if (!open || !editProfile) return
    setClientId(editProfile.client_id || '')
    setPoolId(editProfile.pool_id || '')
    setSchedules([scheduleFromProfile(editProfile)])
  }, [open, editProfile?.id])

  function reset() {
    setClientId(''); setPoolId('')
    setClientSearch(''); setClientDropdownOpen(false)
    setSchedules([blankSchedule()])
    setPendingTechScheduleIdx(null)
    setShowNewClient(false); setShowNewPool(false); setShowNewTech(false)
    setEditingClient(false); setEditClientForm({ name: '', email: '', phone: '', address: '', lat: null, lng: null })
    setLocalStaff([])
  }

  // Schedules array mutators. Always keep length >= 1 — removeSchedule
  // refuses to drop the last row (the "Remove" button is hidden in that
  // state anyway, this is just a safety net).
  function patchSchedule(idx, patch) {
    setSchedules(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }
  function addSchedule() {
    setSchedules(prev => [...prev, blankSchedule()])
  }
  function removeSchedule(idx) {
    setSchedules(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)
  }

  function handleClose() { reset(); onClose() }

  // Sub-modal callbacks — auto-select after create
  function handleClientCreated(newClient) {
    setClients(prev => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)))
    setClientId(newClient.id)
    setPoolId('')
    setClientSearch('')
    setClientDropdownOpen(false)
  }

  function handlePoolCreated(newPool) {
    setClientPools(prev => [...prev, newPool])
    setPoolId(newPool.id)
  }

  function handleTechCreated(newTech) {
    setLocalStaff(prev => [...prev, newTech])
    // Auto-select the new tech on whichever schedule initiated the
    // "+ Add Technician" action. Falls back to schedule 0 if (somehow)
    // the index didn't get tracked — safer than dropping the selection.
    const targetIdx = pendingTechScheduleIdx ?? 0
    patchSchedule(targetIdx, { assignedStaffId: newTech.id })
    setPendingTechScheduleIdx(null)
  }

  async function handleSaveClientEdit() {
    if (!editClientForm.name.trim() || !clientId) return
    setEditClientSaving(true)
    try {
      const updates = {
        name: editClientForm.name.trim(),
        email: editClientForm.email.trim() || null,
        phone: editClientForm.phone.trim() || null,
        address: editClientForm.address.trim() || null,
        latitude: editClientForm.lat ?? null,
        longitude: editClientForm.lng ?? null,
        geocoded_at: editClientForm.lat != null ? new Date().toISOString() : null,
      }
      const { error } = await supabase.from('clients').update(updates).eq('id', clientId)
      if (error) throw error
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, ...updates } : c))
      setEditingClient(false)
    } catch (err) {
      toast.error(err?.message || 'Failed to update client')
    } finally { setEditClientSaving(false) }
  }

  // Shared payload shape for a single schedule → recurring_job_profiles row.
  // Used by both the edit branch (one row) and create (mapped over N).
  function scheduleToPayload(s) {
    const fields = profileFieldsFromForm({
      rule: s.recurrenceRule,
      customDays: s.customDays,
      firstDate: s.firstDate,
    })
    const freqLabel = s.recurrenceRule === 'custom'
      ? `Every ${s.customDays} days`
      : RECURRENCE_OPTIONS.find(o => o.value === s.recurrenceRule)?.label || s.recurrenceRule
    return {
      client_id: clientId,
      pool_id: poolId,
      title: (s.title && s.title.trim()) ? s.title.trim() : `Pool Service — ${freqLabel}`,
      ...fields,
      job_type_template_id: s.jobTypeTemplateId || null,
      preferred_time: s.preferredTime || null,
      price: (s.price !== '' && s.price != null) ? Number(s.price) : null,
      assigned_staff_id: s.assignedStaffId || null,
      notes: s.notes.trim() || null,
      // series_anchor_date is intentionally NOT set here. It is immutable once a
      // profile exists, so the edit branch only writes it when the operator
      // explicitly changes the first date. Fresh inserts (create / legacy
      // promote) add it explicitly below.
      duration_type: s.durationType,
      end_date: s.durationType === 'until_date' ? s.endDate : null,
      total_visits: s.durationType === 'num_visits' ? Number(s.totalVisits) : null,
    }
  }

  async function handleSubmit() {
    if (!clientId || !poolId || schedules.length === 0) return
    if (!schedules.every(s => s.firstDate)) return
    setSaving(true)
    try {
      // ── EDIT ────────────────────────────────────────────────
      if (editProfile) {
        const s = schedules[0]
        const payload = scheduleToPayload(s)
        // Update the existing profile in place. Don't touch
        // is_active/status/completed_visits. Re-anchor the immutable
        // series_anchor_date ONLY when the operator actually changed the
        // first service date — editing price/notes/tech must leave the
        // pattern's phase untouched (otherwise history stops lining up).
        const updatePayload = { ...payload }
        if (s.firstDate && s.firstDate !== s._anchor) {
          updatePayload.series_anchor_date = s.firstDate
        }
        const { error } = await supabase
          .from('recurring_job_profiles')
          .update(updatePayload)
          .eq('id', editProfile.id)
        if (error) throw error
        await recomputePoolNextDue(poolId)
        toast.success('Recurring service updated')
        onCreated()
        reset()
        return
      }

      // ── CREATE ──────────────────────────────────────────────
      // Build one insert payload per schedule. profileFieldsFromForm
      // centralises the rule → (preferred_day_of_week, monthly_week_of_month,
      // custom_interval_days) mapping so AddRecurringModal, RecurringJobs,
      // and StopDetailModal all produce identical writes for the same
      // picker state.
      const payloads = schedules.map(s => {
        const fields = profileFieldsFromForm({
          rule: s.recurrenceRule,
          customDays: s.customDays,
          firstDate: s.firstDate,
        })
        const freqLabel = s.recurrenceRule === 'custom'
          ? `Every ${s.customDays} days`
          : RECURRENCE_OPTIONS.find(o => o.value === s.recurrenceRule)?.label || s.recurrenceRule
        return {
          business_id: business.id,
          client_id: clientId,
          pool_id: poolId,
          title: `Pool Service — ${freqLabel}`,
          ...fields,
          assigned_staff_id: s.assignedStaffId || null,
          notes: s.notes.trim() || null,
          is_active: true,
          series_anchor_date: s.firstDate,
          duration_type: s.durationType,
          end_date: s.durationType === 'until_date' ? s.endDate : null,
          total_visits: s.durationType === 'num_visits' ? Number(s.totalVisits) : null,
          completed_visits: 0,
          status: 'active',
        }
      })

      // No more pre-insert "deactivate existing actives for this pool"
      // step — multiple active profiles per pool is now the supported
      // model (the partial unique index that enforced one-per-pool was
      // dropped in migration 20260509130000). Operator manages stacked
      // schedules via /recurring if they want to retire one.
      const { error } = await supabase.from('recurring_job_profiles').insert(payloads)
      if (error) throw error

      // Pool denormalised mirror: written from schedules[0] only. Path-2
      // (the pool-level projector that reads schedule_frequency /
      // next_due_at) is suppressed for any pool with at least one active
      // profile, so this mirror only matters for pool-detail card copy
      // and /recurring's legacy fetch — "primary schedule" is the right
      // value there.
      const primary = schedules[0]
      const poolUpdate = {
        schedule_frequency: primary.recurrenceRule === 'custom' ? `${primary.customDays}` : primary.recurrenceRule,
      }
      if (primary.assignedStaffId) poolUpdate.assigned_staff_id = primary.assignedStaffId
      await supabase.from('pools').update(poolUpdate).eq('id', poolId)
      // The chokepoint derives next_due_at from the brand-new pattern (= firstDate,
      // since nothing's fulfilled yet) — the single writer, no manual mirror.
      await recomputePoolNextDue(poolId)

      if (payloads.length > 1) {
        toast.success(`Created ${payloads.length} recurring services`)
      }
      onCreated()
      reset()
    } catch (err) {
      console.error('Error creating recurring service:', err)
      toast.error(err?.message || 'Failed to create recurring service')
    } finally { setSaving(false) }
  }

  const selectedClient = clients.find(c => c.id === clientId)
  const allTechs = [...staff, ...localStaff.filter(ls => !staff.some(s => s.id === ls.id))]

  // Filtered client list for search dropdown
  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )

  // Submit gate: shared bits + every schedule must individually validate.
  // Empty firstDate, missing endDate for until_date, or zero totalVisits
  // for num_visits each disable submit until corrected.
  const schedulesValid = schedules.every(s => {
    if (!s.firstDate) return false
    if (s.durationType === 'until_date' && !s.endDate) return false
    if (s.durationType === 'num_visits' && !(Number(s.totalVisits) > 0)) return false
    return true
  })
  const canSubmit = !!clientId && !!poolId && !saving && schedulesValid

  // Soft-warn when two schedules in this draft would project on the same
  // weekday — they'd both insert, but the schedule projector dedupes
  // per-day-per-pool so only one stop renders. Operator can still proceed.
  const sameDayCollision = (() => {
    const days = schedules.map(s => s.firstDate ? new Date(s.firstDate + 'T00:00:00').getDay() : null)
    const seen = new Set()
    for (const d of days) {
      if (d == null) continue
      if (seen.has(d)) return true
      seen.add(d)
    }
    return false
  })()

  return (
    <>
      <Modal open={open} onClose={handleClose} title={isEdit ? 'Edit Recurring Service' : 'New Recurring Service'} size="lg">
        <div className="space-y-6">

          {/* ── CLIENT ────────────────────────────────────── */}
          <Section icon={User} iconColor="text-pool-600 dark:text-pool-400" iconBg="bg-pool-50 dark:bg-pool-950/40" label="Client">
            {!selectedClient ? (
              <div className="space-y-2">
                <div className="relative" ref={clientDropdownRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" strokeWidth={2} />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setClientDropdownOpen(true) }}
                    onFocus={() => setClientDropdownOpen(true)}
                    placeholder="Search clients..."
                    className="input w-full pl-9"
                  />
                  {clientDropdownOpen && filteredClients.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-elevated max-h-56 overflow-y-auto">
                      {filteredClients.map(c => (
                        <button key={c.id} type="button"
                          onClick={() => { setClientId(c.id); setClientSearch(''); setPoolId(''); setClientDropdownOpen(false) }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{c.name}</p>
                          {c.address && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{c.address}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                  {clientDropdownOpen && filteredClients.length === 0 && clientSearch && (
                    <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-elevated p-3">
                      <p className="text-sm text-gray-400 dark:text-gray-500">No clients match "{clientSearch}"</p>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setShowNewClient(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 min-h-tap">
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> New Client
                </button>
              </div>
            ) : editingClient ? (
              <div className="space-y-3 p-4 rounded-xl border border-pool-200 dark:border-pool-800/40 bg-pool-50/40 dark:bg-pool-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-pool-700 dark:text-pool-300 uppercase tracking-wide">Edit Client</span>
                  <button type="button" onClick={() => setEditingClient(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <X className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
                <Input label="Name" value={editClientForm.name} onChange={e => setEditClientForm(p => ({ ...p, name: e.target.value }))} required />
                <Input label="Email" type="email" value={editClientForm.email} onChange={e => setEditClientForm(p => ({ ...p, email: e.target.value }))} />
                <Input label="Phone" type="tel" value={editClientForm.phone} onChange={e => setEditClientForm(p => ({ ...p, phone: e.target.value }))} />
                <LocationField
                  label="Address"
                  placeholder="Start typing a street address..."
                  address={editClientForm.address}
                  lat={editClientForm.lat}
                  lng={editClientForm.lng}
                  onChange={({ address, lat, lng }) => setEditClientForm(p => ({ ...p, address, lat, lng }))}
                />
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditingClient(false)} className="flex-1">Cancel</Button>
                  <Button onClick={handleSaveClientEdit} loading={editClientSaving} disabled={!editClientForm.name.trim()} className="flex-1">Save</Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedClient.name}</p>
                    <div className="mt-1 space-y-0.5">
                      {selectedClient.email && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Mail className="w-3 h-3 shrink-0" strokeWidth={2} />
                          <span className="truncate">{selectedClient.email}</span>
                        </div>
                      )}
                      {selectedClient.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Phone className="w-3 h-3 shrink-0" strokeWidth={2} />
                          <span>{selectedClient.phone}</span>
                        </div>
                      )}
                      {selectedClient.address && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <MapPin className="w-3 h-3 shrink-0" strokeWidth={2} />
                          <span className="truncate">{selectedClient.address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => {
                      setEditClientForm({
                        name: selectedClient.name || '',
                        email: selectedClient.email || '',
                        phone: selectedClient.phone || '',
                        address: selectedClient.address || '',
                        lat: selectedClient.latitude ?? null,
                        lng: selectedClient.longitude ?? null,
                      })
                      setEditingClient(true)
                    }} className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-gray-500 hover:text-pool-600 dark:hover:text-pool-400 hover:bg-white dark:hover:bg-gray-700 transition-colors" aria-label="Edit client">
                      <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                    </button>
                    <button type="button" onClick={() => { setClientId(''); setPoolId('') }}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-white dark:hover:bg-gray-700 transition-colors" aria-label="Change client">
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── POOL ──────────────────────────────────────── */}
          <Section icon={Droplet} iconColor="text-pool-600 dark:text-pool-400" iconBg="bg-pool-50 dark:bg-pool-950/40" label="Pool">
            {!clientId ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Select a client first</p>
            ) : (
              <div className="space-y-2">
                {clientPools.length > 0 && (
                  <div className="space-y-1.5">
                    {clientPools.map(p => (
                      <button key={p.id} type="button" onClick={() => setPoolId(p.id)}
                        className={cn(
                          'w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-2',
                          poolId === p.id
                            ? 'border-pool-500 bg-pool-50 dark:bg-pool-950/40'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
                        )}>
                        <MapPin className={cn('w-4 h-4 shrink-0', poolId === p.id ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500')} strokeWidth={2} />
                        <span className="min-w-0 flex-1">
                          {p.name && <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.name}</span>}
                          <span className={cn('block truncate', p.name ? 'text-xs text-gray-500 dark:text-gray-400' : 'text-sm font-medium text-gray-900 dark:text-gray-100')}>{p.address}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setShowNewPool(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 min-h-tap">
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> New Pool
                </button>
              </div>
            )}
          </Section>

          {/* ── SCHEDULES ─────────────────────────────────── */}
          {/* One ScheduleSection per row in `schedules`. With a single
              schedule the section renders without a numbered header so
              this looks identical to the old single-schedule modal.
              "+ Add another schedule" stacks more independent rows. */}
          <Section icon={CalendarIcon} iconColor="text-emerald-600 dark:text-emerald-400" iconBg="bg-emerald-50 dark:bg-emerald-950/40" label="Schedule">
            <div className="space-y-4">
              {schedules.map((s, idx) => (
                <ScheduleSection
                  key={idx}
                  index={idx}
                  schedule={s}
                  onChange={(patch) => patchSchedule(idx, patch)}
                  onRemove={!isEdit && schedules.length > 1 ? () => removeSchedule(idx) : null}
                  showHeader={!isEdit && schedules.length > 1}
                  detailFields={isEdit}
                  jobTypes={jobTypes}
                  allTechs={allTechs}
                  onAddTech={() => { setPendingTechScheduleIdx(idx); setShowNewTech(true) }}
                />
              ))}
              {/* Stacking multiple schedules is a create-only flow — editing
                  always operates on one existing profile. */}
              {!isEdit && (
                <button
                  type="button"
                  onClick={addSchedule}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-pool-300 dark:border-pool-700 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors min-h-tap"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} /> Add another schedule
                </button>
              )}
              {!isEdit && sameDayCollision && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-lg px-2.5 py-1.5">
                  Two schedules anchor on the same weekday for this pool. Both will save, but the calendar will only show one stop per day.
                </p>
              )}
            </div>
          </Section>

          {/* ── ACTIONS ──────────────────────────────────── */}
          <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <Button variant="secondary" onClick={handleClose} disabled={saving} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} loading={saving} disabled={!canSubmit} className="flex-1">
              {isEdit
                ? 'Save Changes'
                : schedules.length === 1
                  ? 'Create Recurring Service'
                  : `Create ${schedules.length} Recurring Services`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Nested sub-modals */}
      <NewClientModal
        open={showNewClient}
        onClose={() => setShowNewClient(false)}
        onCreated={handleClientCreated}
        prefill={clientSearch ? { name: clientSearch } : undefined}
      />
      <NewPoolModal
        open={showNewPool}
        onClose={() => setShowNewPool(false)}
        clientId={clientId}
        clientAddress={selectedClient?.address}
        onCreated={handlePoolCreated}
      />
      <NewTechnicianModal
        open={showNewTech}
        onClose={() => setShowNewTech(false)}
        onCreated={handleTechCreated}
      />
    </>
  )
}

// Per-schedule controls. One of these renders per row in `schedules`.
// Date + RecurrencePicker drive the cadence; duration cards toggle the
// conditional end-date / num-visits inputs; technician + notes live
// here too so each schedule can be independently assigned.
function ScheduleSection({ index, schedule, onChange, onRemove, showHeader, detailFields = false, jobTypes = [], allTechs, onAddTech }) {
  const rule = schedule.recurrenceRule
  const customDays = schedule.customDays
  const firstDate = schedule.firstDate
  const durationType = schedule.durationType

  // Estimated end date for num_visits — approximated for monthly and
  // beyond. Surfaced only as a "approx finishes" hint, so rough is fine.
  const intervalDaysValue = rule === 'custom'
    ? Number(customDays) || 7
    : ({ weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }[rule] || 7)
  const estimatedEndDate = durationType === 'num_visits' && schedule.totalVisits && firstDate
    ? (() => {
        const d = new Date(firstDate)
        d.setDate(d.getDate() + intervalDaysValue * (Number(schedule.totalVisits) - 1))
        return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
      })()
    : null

  return (
    <div className={cn(
      'space-y-3',
      // Numbered schedules visually nest in a card so multi-schedule
      // setups are scannable. Single-schedule case keeps the original
      // flat layout so the common path is unchanged.
      showHeader && 'rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40 p-4'
    )}>
      {showHeader && (
        <div className="flex items-center justify-between -mt-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Schedule {index + 1}
          </h4>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors min-h-tap px-2"
              aria-label={`Remove schedule ${index + 1}`}
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} /> Remove
            </button>
          )}
        </div>
      )}

      {/* Detail fields — edit mode only. Service Title + Job Type sit
          above the date so the operator sees what they're editing first. */}
      {detailFields && jobTypes.length > 0 && (
        <Select
          label="Job Type"
          value={schedule.jobTypeTemplateId}
          onChange={e => onChange({ jobTypeTemplateId: e.target.value })}
          options={[{ value: '', label: 'No template' }, ...jobTypes.map(j => ({ value: j.id, label: j.name }))]}
        />
      )}
      {detailFields && (
        <Input
          label="Service Title"
          value={schedule.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="e.g. Regular Maintenance"
        />
      )}

      <div>
        <Input
          label="First service date"
          type="date"
          value={firstDate}
          onChange={e => onChange({ firstDate: e.target.value })}
        />
        {firstDate && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDateWithDay(firstDate)}</p>
        )}
      </div>

      <RecurrencePicker
        value={{ rule, customDays }}
        onChange={next => onChange({ recurrenceRule: next.rule, customDays: next.customDays })}
        firstDate={firstDate}
      />

      {/* Duration cards */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Duration</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'ongoing', label: 'Ongoing', desc: 'Until cancelled' },
            { value: 'until_date', label: 'Until date', desc: 'Specific end' },
            { value: 'num_visits', label: 'Fixed visits', desc: 'Set number' },
          ].map(opt => (
            <button key={opt.value} type="button" onClick={() => onChange({ durationType: opt.value })}
              className={cn(
                'p-3 rounded-xl border-2 transition-all text-left',
                durationType === opt.value
                  ? 'border-pool-500 bg-pool-50 dark:bg-pool-950/40'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
              )}>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{opt.label}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>

        {durationType === 'until_date' && (
          <div className="mt-3 space-y-2">
            <Input label="End date" type="date" value={schedule.endDate} onChange={e => onChange({ endDate: e.target.value })} />
            <div className="flex gap-2">
              {[{ label: '3 months', months: 3 }, { label: '6 months', months: 6 }, { label: '12 months', months: 12 }].map(preset => (
                <button key={preset.months} type="button"
                  onClick={() => {
                    const d = new Date(firstDate || new Date())
                    d.setMonth(d.getMonth() + preset.months)
                    onChange({ endDate: d.toISOString().split('T')[0] })
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {durationType === 'num_visits' && (
          <div className="mt-3 space-y-2">
            <Input label="Number of visits" type="number" min="1" value={schedule.totalVisits}
              onChange={e => onChange({ totalVisits: e.target.value })} placeholder="e.g. 12" />
            {estimatedEndDate && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Approx. finishes <span className="font-semibold text-gray-700 dark:text-gray-300">{estimatedEndDate}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Preferred time + price — edit mode only. */}
      {detailFields && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Preferred Time"
            type="time"
            value={schedule.preferredTime}
            onChange={e => onChange({ preferredTime: e.target.value })}
          />
          <Input
            label="Price ($)"
            type="number"
            value={schedule.price}
            onChange={e => onChange({ price: e.target.value })}
            placeholder="150"
          />
        </div>
      )}

      {/* Technician */}
      <Select
        label="Technician"
        value={schedule.assignedStaffId}
        onChange={e => {
          if (e.target.value === '__add__') {
            onAddTech()
          } else {
            onChange({ assignedStaffId: e.target.value })
          }
        }}
        options={[
          { value: '', label: 'Unassigned' },
          ...allTechs.map(s => ({ value: s.id, label: s.name })),
          { value: '__add__', label: '+ Add Technician' },
        ]}
      />

      {/* Notes */}
      <TextArea
        label="Notes"
        value={schedule.notes}
        onChange={e => onChange({ notes: e.target.value })}
        placeholder="e.g. Back gate code 1234, dog in yard, etc."
        rows={2}
      />
    </div>
  )
}

// Section wrapper — icon-box + label + content
function Section({ icon: Icon, iconColor, iconBg, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
          <Icon className={cn('w-4 h-4', iconColor)} strokeWidth={2} />
        </div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{label}</h3>
      </div>
      <div className="space-y-3 pl-[44px]">
        {children}
      </div>
    </div>
  )
}
