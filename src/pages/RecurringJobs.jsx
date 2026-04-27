import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { Select, TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import ConfirmModal from '../components/ui/ConfirmModal'
import AddRecurringModal from '../components/ui/AddRecurringModal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'

const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: '6_weekly', label: 'Every 6 Weeks' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'custom', label: 'Custom Interval' },
]

const DAY_OPTIONS = [
  { value: '', label: 'Any day' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
]

const RECURRENCE_LABEL = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly',
  '6_weekly': 'Every 6 Weeks', quarterly: 'Quarterly', custom: 'Custom',
}

const emptyForm = {
  client_id: '',
  pool_id: '',
  job_type_template_id: '',
  title: '',
  recurrence_rule: 'weekly',
  custom_interval_days: '',
  preferred_day_of_week: '',
  preferred_time: '',
  assigned_staff_id: '',
  price: '',
  notes: '',
}

export default function RecurringJobs() {
  const toast = useToast()
  const { business } = useBusiness()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState([])
  const [clients, setClients] = useState([])
  const [pools, setPools] = useState([])
  const [staff, setStaff] = useState([])
  const [jobTypes, setJobTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)       // edit modal (legacy)
  const [addModalOpen, setAddModalOpen] = useState(false)  // new add modal
  const [editing, setEditing] = useState(null)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  // Inline create client
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientSaving, setNewClientSaving] = useState(false)

  useEffect(() => {
    if (business?.id) fetchAll()
  }, [business?.id])

  async function fetchAll() {
    setLoading(true)
    const [profilesRes, clientsRes, staffRes, jobTypesRes] = await Promise.all([
      supabase.from('recurring_job_profiles').select('*, clients(name), pools(address), staff_members:assigned_staff_id(name), job_type_templates:job_type_template_id(name, color)')
        .eq('business_id', business.id).order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name, pools(id, address)').eq('business_id', business.id).order('name'),
      supabase.from('staff_members').select('id, name').eq('business_id', business.id).eq('is_active', true).order('name'),
      supabase.from('job_type_templates').select('id, name, color, default_tasks, estimated_duration_minutes, default_price')
        .eq('business_id', business.id).eq('is_active', true).order('name'),
    ])
    setProfiles(profilesRes.data || [])
    setClients(clientsRes.data || [])
    setStaff(staffRes.data || [])
    setJobTypes(jobTypesRes.data || [])
    setLoading(false)
  }

  const clientPools = form.client_id
    ? (clients.find(c => c.id === form.client_id)?.pools || [])
    : []

  function openAdd() {
    // Use the new clean Add Recurring Service modal (same as Schedule page)
    setAddModalOpen(true)
  }

  function openEdit(profile) {
    setEditing(profile)
    setForm({
      client_id: profile.client_id || '',
      pool_id: profile.pool_id || '',
      job_type_template_id: profile.job_type_template_id || '',
      title: profile.title || '',
      recurrence_rule: profile.recurrence_rule || 'weekly',
      custom_interval_days: profile.custom_interval_days || '',
      preferred_day_of_week: profile.preferred_day_of_week != null ? String(profile.preferred_day_of_week) : '',
      preferred_time: profile.preferred_time || '',
      assigned_staff_id: profile.assigned_staff_id || '',
      price: profile.price || '',
      notes: profile.notes || '',
    })
    setModalOpen(true)
  }

  async function handleQuickCreateClient() {
    if (!newClientName.trim()) return
    setNewClientSaving(true)
    try {
      const { data, error } = await supabase.from('clients')
        .insert({ name: newClientName.trim(), business_id: business.id })
        .select('id, name, pools:pools(id, address)')
        .single()
      if (error) throw error
      setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setForm(prev => ({ ...prev, client_id: data.id, pool_id: '' }))
      setNewClientName('')
      setShowNewClient(false)
    } catch (err) {
      toast.error(err.message || 'Failed to create client')
    } finally {
      setNewClientSaving(false)
    }
  }

  function onJobTypeChange(templateId) {
    setForm(prev => {
      const jt = jobTypes.find(j => j.id === templateId)
      return {
        ...prev,
        job_type_template_id: templateId,
        title: jt?.name || prev.title,
        price: jt?.default_price || prev.price,
      }
    })
  }

  function calcNextGeneration() {
    const now = new Date()
    const intervals = {
      weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90,
      custom: Number(form.custom_interval_days) || 7,
    }
    const days = intervals[form.recurrence_rule] || 7
    const next = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return next.toISOString()
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.client_id || !form.title.trim()) return
    setSaving(true)
    try {
      const payload = {
        client_id: form.client_id,
        pool_id: form.pool_id || null,
        job_type_template_id: form.job_type_template_id || null,
        title: form.title.trim(),
        recurrence_rule: form.recurrence_rule,
        custom_interval_days: form.recurrence_rule === 'custom' ? Number(form.custom_interval_days) || 7 : null,
        preferred_day_of_week: form.preferred_day_of_week !== '' ? Number(form.preferred_day_of_week) : null,
        preferred_time: form.preferred_time || null,
        assigned_staff_id: form.assigned_staff_id || null,
        price: form.price ? Number(form.price) : null,
        notes: form.notes.trim() || null,
        next_generation_at: editing?.next_generation_at || calcNextGeneration(),
      }
      if (editing) {
        await supabase.from('recurring_job_profiles').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('recurring_job_profiles').insert({ ...payload, business_id: business.id })
      }
      setModalOpen(false)
      fetchAll()
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate() {
    if (!editing) return
    await supabase.from('recurring_job_profiles').update({ is_active: false }).eq('id', editing.id)
    setModalOpen(false)
    fetchAll()
  }

  async function handleCancelService() {
    if (!editing) return
    await handleStatusChange(editing.id, 'cancelled')
    setModalOpen(false)
  }

  async function generateNow(profile) {
    try {
      const jt = jobTypes.find(j => j.id === profile.job_type_template_id)
      const nextDate = new Date()
      // Find next preferred day
      if (profile.preferred_day_of_week != null) {
        const current = nextDate.getDay()
        const target = profile.preferred_day_of_week
        const daysUntil = (target - current + 7) % 7 || 7
        nextDate.setDate(nextDate.getDate() + daysUntil)
      }

      const { error } = await supabase.from('jobs').insert({
        business_id: business.id,
        client_id: profile.client_id,
        pool_id: profile.pool_id,
        recurring_profile_id: profile.id,
        job_type_template_id: profile.job_type_template_id,
        assigned_staff_id: profile.assigned_staff_id,
        title: profile.title,
        status: 'scheduled',
        scheduled_date: nextDate.toISOString().split('T')[0],
        scheduled_time: profile.preferred_time,
        estimated_duration_minutes: jt?.estimated_duration_minutes || null,
        price: profile.price,
        notes: profile.notes,
      })
      if (error) throw error

      // Update last/next generation
      const intervals = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90, custom: profile.custom_interval_days || 7 }
      const days = intervals[profile.recurrence_rule] || 7
      const nextGen = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      await supabase.from('recurring_job_profiles').update({
        last_generated_at: new Date().toISOString(),
        next_generation_at: nextGen.toISOString(),
      }).eq('id', profile.id)

      toast.success('Job created!')
      fetchAll()
    } catch (err) {
      toast.error(err.message || 'Failed to generate job')
    }
  }

  async function handleStatusChange(profileId, newStatus) {
    try {
      await supabase.from('recurring_job_profiles').update({ status: newStatus }).eq('id', profileId)
      fetchAll()
    } catch (err) {
      toast.error(err.message || 'Failed to update status')
    }
  }

  async function handleExtend(profileId) {
    if (!editing) return
    const profile = editing
    if (profile.duration_type === 'until_date') {
      const newEnd = prompt('Enter new end date (YYYY-MM-DD):', profile.end_date || '')
      if (!newEnd) return
      await supabase.from('recurring_job_profiles').update({ end_date: newEnd, status: 'active' }).eq('id', profileId)
    } else if (profile.duration_type === 'num_visits') {
      const extra = prompt('Add how many visits?', '6')
      if (!extra || isNaN(Number(extra))) return
      await supabase.from('recurring_job_profiles').update({ total_visits: (profile.total_visits || 0) + Number(extra), status: 'active' }).eq('id', profileId)
    }
    fetchAll()
    setModalOpen(false)
  }

  const activeProfiles = profiles.filter(p => p.is_active && (!p.status || p.status === 'active'))
  const pausedProfiles = profiles.filter(p => p.status === 'paused')
  const completedProfiles = profiles.filter(p => p.status === 'completed' || p.status === 'cancelled' || !p.is_active)

  const STATUS_BADGE = {
    active: { variant: 'success', label: 'Active' },
    paused: { variant: 'warning', label: 'Paused' },
    completed: { variant: 'default', label: 'Completed' },
    cancelled: { variant: 'default', label: 'Cancelled' },
  }

  function durationLabel(p) {
    if (!p.duration_type || p.duration_type === 'ongoing') return 'Ongoing'
    if (p.duration_type === 'until_date') {
      if (!p.end_date) return 'Until date'
      const end = new Date(p.end_date)
      const now = new Date()
      const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24))
      if (daysLeft <= 0) return 'Ended'
      if (daysLeft <= 30) return `${daysLeft}d remaining`
      const months = Math.round(daysLeft / 30)
      return `${months}mo remaining`
    }
    if (p.duration_type === 'num_visits') {
      return `${p.completed_visits || 0} of ${p.total_visits} visits`
    }
    return 'Ongoing'
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHero title="Recurring" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  const activeCount = activeProfiles.length
  const pausedCount = pausedProfiles.length
  const heroSubtitle = activeCount === 0 && pausedCount === 0
    ? 'No recurring services yet'
    : `${activeCount} active${pausedCount > 0 ? ` · ${pausedCount} paused` : ''}`

  return (
    <>
      <PageWrapper>
        <PageHero
          title="Recurring"
          subtitle={heroSubtitle}
          action={<Button leftIcon={Plus} onClick={openAdd}>Add Recurring Service</Button>}
        />
        {activeProfiles.length === 0 && pausedProfiles.length === 0 && completedProfiles.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
              </svg>
            }
            title="No recurring jobs"
            description="Set up recurring job profiles to auto-generate jobs"
            action="Create Recurring Job"
            onAction={openAdd}
          />
        ) : (
          <div className="space-y-2.5">
            {[...activeProfiles, ...pausedProfiles].map(p => {
              const st = STATUS_BADGE[p.status || 'active'] || STATUS_BADGE.active
              return (
                <Card key={p.id} onClick={() => openEdit(p)}>
                  <div className="flex items-start gap-3">
                    {p.job_type_templates?.color && (
                      <div className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: p.job_type_templates.color }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.title}</p>
                        <Badge variant="primary" className="shrink-0">
                          {RECURRENCE_LABEL[p.recurrence_rule] || p.recurrence_rule}
                        </Badge>
                        <Badge variant={st.variant} className="shrink-0 text-[10px]">{st.label}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{p.clients?.name}</p>
                      {p.pools?.address && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.pools.address}</p>}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">{durationLabel(p)}</span>
                        {p.duration_type === 'num_visits' && p.total_visits && (
                          <div className="flex-1 max-w-[80px] h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-pool-500 rounded-full" style={{ width: `${Math.min(100, ((p.completed_visits || 0) / p.total_visits) * 100)}%` }} />
                          </div>
                        )}
                        {p.staff_members?.name && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{p.staff_members.name}</span>
                        )}
                        {p.price && <span className="text-[11px] text-pool-600 dark:text-pool-400 font-medium">${Number(p.price).toFixed(0)}</span>}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); generateNow(p) }}
                      className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors shrink-0"
                      title="Generate job now"
                    >
                      <svg className="w-5 h-5 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </Card>
              )
            })}

            {completedProfiles.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-6 mb-2">
                  Completed / Inactive
                </h3>
                {completedProfiles.map(p => {
                  const st = STATUS_BADGE[p.status || 'completed'] || STATUS_BADGE.completed
                  return (
                    <Card key={p.id} onClick={() => openEdit(p)} className="opacity-60">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.title}</p>
                            <Badge variant={st.variant} className="shrink-0 text-[10px]">{st.label}</Badge>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{p.clients?.name}</p>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">{durationLabel(p)}</span>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </>
            )}
          </div>
        )}
      </PageWrapper>

      {/* New clean Add modal — same as used on Schedule page */}
      <AddRecurringModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        business={business}
        staff={staff}
        onCreated={() => { fetchAll(); setAddModalOpen(false) }}
      />

      {/* Legacy edit modal — only used for editing existing profiles */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Recurring Job' : 'New Recurring Job'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Select
              label="Client"
              options={[{ value: '', label: 'Select client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
              value={form.client_id}
              onChange={e => setForm(prev => ({ ...prev, client_id: e.target.value, pool_id: '' }))}
              required
            />
            {!showNewClient ? (
              <button type="button" onClick={() => setShowNewClient(true)}
                className="text-xs text-pool-600 dark:text-pool-400 font-semibold mt-1.5 hover:text-pool-700">
                + Create new client
              </button>
            ) : (
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Client name"
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  className="flex-1"
                  autoFocus
                />
                <Button type="button" onClick={handleQuickCreateClient} loading={newClientSaving}
                  className="text-xs px-3 shrink-0">Add</Button>
                <button type="button" onClick={() => { setShowNewClient(false); setNewClientName('') }}
                  className="text-xs text-gray-400 dark:text-gray-500 px-2 shrink-0 hover:text-gray-600 dark:text-gray-400">Cancel</button>
              </div>
            )}
          </div>
          {clientPools.length > 0 && (
            <Select
              label="Pool"
              options={[{ value: '', label: 'Select pool...' }, ...clientPools.map(p => ({ value: p.id, label: p.address }))]}
              value={form.pool_id}
              onChange={e => setForm(prev => ({ ...prev, pool_id: e.target.value }))}
            />
          )}
          {jobTypes.length > 0 && (
            <Select
              label="Job Type"
              options={[{ value: '', label: 'No template' }, ...jobTypes.map(j => ({ value: j.id, label: j.name }))]}
              value={form.job_type_template_id}
              onChange={e => onJobTypeChange(e.target.value)}
            />
          )}
          <Input
            label="Job Title"
            value={form.title}
            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Regular Maintenance"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Frequency"
              options={RECURRENCE_OPTIONS}
              value={form.recurrence_rule}
              onChange={e => setForm(prev => ({ ...prev, recurrence_rule: e.target.value }))}
            />
            {form.recurrence_rule === 'custom' ? (
              <Input
                label="Interval (days)"
                type="number"
                value={form.custom_interval_days}
                onChange={e => setForm(prev => ({ ...prev, custom_interval_days: e.target.value }))}
                placeholder="10"
              />
            ) : (
              <Select
                label="Preferred Day"
                options={DAY_OPTIONS}
                value={form.preferred_day_of_week}
                onChange={e => setForm(prev => ({ ...prev, preferred_day_of_week: e.target.value }))}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Preferred Time"
              type="time"
              value={form.preferred_time}
              onChange={e => setForm(prev => ({ ...prev, preferred_time: e.target.value }))}
            />
            <Input
              label="Price ($)"
              type="number"
              value={form.price}
              onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
              placeholder="150"
            />
          </div>
          {staff.length > 0 && (
            <Select
              label="Assign To"
              options={[{ value: '', label: 'Unassigned' }, ...staff.map(s => ({ value: s.id, label: s.name }))]}
              value={form.assigned_staff_id}
              onChange={e => setForm(prev => ({ ...prev, assigned_staff_id: e.target.value }))}
            />
          )}
          <TextArea
            label="Notes"
            value={form.notes}
            onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Any recurring notes..."
            rows={2}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
          </div>

          {editing && (
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-2 space-y-2">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Actions</p>
              <div className="flex gap-2 flex-wrap">
                {(!editing.status || editing.status === 'active') && (
                  <Button type="button" variant="secondary" onClick={() => { handleStatusChange(editing.id, 'paused'); setModalOpen(false) }} className="text-xs px-3">
                    Pause
                  </Button>
                )}
                {editing.status === 'paused' && (
                  <Button type="button" variant="secondary" onClick={() => { handleStatusChange(editing.id, 'active'); setModalOpen(false) }} className="text-xs px-3">
                    Resume
                  </Button>
                )}
                {(editing.duration_type === 'until_date' || editing.duration_type === 'num_visits') && (
                  <Button type="button" variant="secondary" onClick={() => handleExtend(editing.id)} className="text-xs px-3">
                    Extend
                  </Button>
                )}
                {editing.status !== 'cancelled' && (
                  <Button type="button" variant="danger" onClick={() => setConfirmCancelOpen(true)} className="text-xs px-3">
                    Cancel Service
                  </Button>
                )}
              </div>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Cancel this recurring service?"
        description="This will stop generating new jobs from now. Existing scheduled jobs are not removed."
        destructive
        confirmLabel="Cancel Service"
        onConfirm={handleCancelService}
      />
    </>
  )
}
