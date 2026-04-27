import { useState, useEffect } from 'react'
import { Search, X, Pencil, User, Droplet, Calendar as CalendarIcon, Repeat, Mail, Phone, MapPin, Plus } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import Input, { Select, TextArea } from './Input'
import AddressAutocomplete from './AddressAutocomplete'
import NewClientModal from './NewClientModal'
import NewPoolModal from './NewPoolModal'
import NewTechnicianModal from './NewTechnicianModal'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'

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

export default function AddRecurringModal({ open, onClose, business, staff, onCreated }) {
  const toast = useToast()
  // Loaded data
  const [clients, setClients] = useState([])
  const [clientPools, setClientPools] = useState([])
  const [localStaff, setLocalStaff] = useState([])

  // Selections
  const [clientId, setClientId] = useState('')
  const [poolId, setPoolId] = useState('')
  const [assignedStaffId, setAssignedStaffId] = useState('')

  // Client search dropdown
  const [clientSearch, setClientSearch] = useState('')
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)

  // Schedule
  const [recurrenceRule, setRecurrenceRule] = useState('weekly')
  const [customDays, setCustomDays] = useState(7)
  const [preferredDay, setPreferredDay] = useState('')
  const [firstDate, setFirstDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  // Duration
  const [durationType, setDurationType] = useState('ongoing')
  const [endDate, setEndDate] = useState('')
  const [totalVisits, setTotalVisits] = useState('')

  // Nested modal state
  const [showNewClient, setShowNewClient] = useState(false)
  const [showNewPool, setShowNewPool] = useState(false)
  const [showNewTech, setShowNewTech] = useState(false)
  const [editingClient, setEditingClient] = useState(false)
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', phone: '', address: '' })
  const [editClientSaving, setEditClientSaving] = useState(false)

  const [saving, setSaving] = useState(false)

  // Fetch clients on open
  useEffect(() => {
    if (!open || !business?.id) return
    supabase.from('clients').select('id, name, address, email, phone').eq('business_id', business.id).order('name')
      .then(({ data }) => setClients(data || []))
  }, [open, business?.id])

  // Fetch pools when client changes
  useEffect(() => {
    if (!clientId) { setClientPools([]); return }
    supabase.from('pools').select('id, address').eq('client_id', clientId)
      .then(({ data }) => {
        setClientPools(data || [])
        // Auto-select if only one pool
        if (data?.length === 1) setPoolId(data[0].id)
      })
  }, [clientId])

  function reset() {
    setClientId(''); setPoolId(''); setAssignedStaffId('')
    setClientSearch(''); setClientDropdownOpen(false)
    setRecurrenceRule('weekly'); setCustomDays(7); setPreferredDay('')
    setFirstDate(new Date().toISOString().split('T')[0]); setNotes('')
    setDurationType('ongoing'); setEndDate(''); setTotalVisits('')
    setShowNewClient(false); setShowNewPool(false); setShowNewTech(false)
    setEditingClient(false); setEditClientForm({ name: '', email: '', phone: '', address: '' })
    setLocalStaff([])
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
    setAssignedStaffId(newTech.id)
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
      }
      const { error } = await supabase.from('clients').update(updates).eq('id', clientId)
      if (error) throw error
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, ...updates } : c))
      setEditingClient(false)
    } catch (err) {
      toast.error(err?.message || 'Failed to update client')
    } finally { setEditClientSaving(false) }
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

      // Update pool frequency, next_due_at, and assigned tech
      const poolUpdate = {
        schedule_frequency: recurrenceRule === 'custom' ? `${customDays}` : recurrenceRule,
        next_due_at: firstDate,
      }
      if (assignedStaffId) poolUpdate.assigned_staff_id = assignedStaffId
      await supabase.from('pools').update(poolUpdate).eq('id', poolId)

      onCreated()
      reset()
    } catch (err) {
      console.error('Error creating recurring service:', err)
      toast.error(err?.message || 'Failed to create recurring service')
    } finally { setSaving(false) }
  }

  const selectedClient = clients.find(c => c.id === clientId)
  const selectedPool = clientPools.find(p => p.id === poolId)
  const allTechs = [...staff, ...localStaff.filter(ls => !staff.some(s => s.id === ls.id))]
  const selectedTech = allTechs.find(s => s.id === assignedStaffId)

  // Filtered client list for search dropdown
  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  )

  // Estimated end date for num_visits
  const intervalDaysValue = recurrenceRule === 'custom' ? Number(customDays) : ({ weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }[recurrenceRule] || 7)
  const estimatedEndDate = durationType === 'num_visits' && totalVisits && firstDate
    ? (() => { const d = new Date(firstDate); d.setDate(d.getDate() + intervalDaysValue * (Number(totalVisits) - 1)); return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) })()
    : null

  // Validation
  const canSubmit = clientId && poolId && firstDate && !saving
    && (durationType !== 'until_date' || !!endDate)
    && (durationType !== 'num_visits' || (Number(totalVisits) > 0))

  return (
    <>
      <Modal open={open} onClose={handleClose} title="New Recurring Service" size="lg">
        <div className="space-y-6">

          {/* ── CLIENT ────────────────────────────────────── */}
          <Section icon={User} iconColor="text-pool-600 dark:text-pool-400" iconBg="bg-pool-50 dark:bg-pool-950/40" label="Client">
            {!selectedClient ? (
              <div className="space-y-2">
                <div className="relative">
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
                <AddressAutocomplete
                  label="Address"
                  value={editClientForm.address}
                  onChange={v => setEditClientForm(p => ({ ...p, address: v }))}
                  onSelect={({ address }) => setEditClientForm(p => ({ ...p, address }))}
                  placeholder="Start typing a street address..."
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
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.address}</span>
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

          {/* ── SCHEDULE ──────────────────────────────────── */}
          <Section icon={CalendarIcon} iconColor="text-emerald-600 dark:text-emerald-400" iconBg="bg-emerald-50 dark:bg-emerald-950/40" label="Schedule">
            {/* Recurrence pills */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Frequency</label>
              <div className="flex flex-wrap gap-1.5">
                {RECURRENCE_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => setRecurrenceRule(opt.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px]',
                      recurrenceRule === opt.value
                        ? 'bg-pool-500 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
                    )}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {recurrenceRule === 'custom' && (
                <Input label="" type="number" min="1" value={customDays} onChange={e => setCustomDays(e.target.value)}
                  placeholder="Number of days" className="mt-2" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="First service date" type="date" value={firstDate} onChange={e => setFirstDate(e.target.value)} />
              <Select label="Preferred day" value={preferredDay} onChange={e => setPreferredDay(e.target.value)} options={DAY_OPTIONS} />
            </div>

            {/* Duration cards */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Duration</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'ongoing', label: 'Ongoing', desc: 'Until cancelled' },
                  { value: 'until_date', label: 'Until date', desc: 'Specific end' },
                  { value: 'num_visits', label: 'Fixed visits', desc: 'Set number' },
                ].map(opt => (
                  <button key={opt.value} type="button" onClick={() => setDurationType(opt.value)}
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
                  <Input label="End date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  <div className="flex gap-2">
                    {[{ label: '3 months', months: 3 }, { label: '6 months', months: 6 }, { label: '12 months', months: 12 }].map(preset => (
                      <button key={preset.months} type="button"
                        onClick={() => {
                          const d = new Date(firstDate || new Date())
                          d.setMonth(d.getMonth() + preset.months)
                          setEndDate(d.toISOString().split('T')[0])
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
                  <Input label="Number of visits" type="number" min="1" value={totalVisits}
                    onChange={e => setTotalVisits(e.target.value)} placeholder="e.g. 12" />
                  {estimatedEndDate && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Approx. finishes <span className="font-semibold text-gray-700 dark:text-gray-300">{estimatedEndDate}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* ── ASSIGNMENT ────────────────────────────────── */}
          <Section icon={Repeat} iconColor="text-violet-600 dark:text-violet-400" iconBg="bg-violet-50 dark:bg-violet-950/40" label="Assignment">
            <Select
              label="Technician"
              value={assignedStaffId}
              onChange={e => {
                if (e.target.value === '__add__') {
                  setShowNewTech(true)
                } else {
                  setAssignedStaffId(e.target.value)
                }
              }}
              options={[
                { value: '', label: 'Unassigned' },
                ...allTechs.map(s => ({ value: s.id, label: s.name })),
                { value: '__add__', label: '+ Add Technician' },
              ]}
            />
            <TextArea label="Notes" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Back gate code 1234, dog in yard, etc." rows={2} />
          </Section>

          {/* ── ACTIONS ──────────────────────────────────── */}
          <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <Button variant="secondary" onClick={handleClose} disabled={saving} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} loading={saving} disabled={!canSubmit} className="flex-1">
              Create Recurring Service
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
