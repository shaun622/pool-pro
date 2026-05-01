import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Pause, Pencil, Play, Plus, Repeat, Wallet,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import StatCard from '../components/ui/StatCard'
import Input, { Select, TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import ConfirmModal from '../components/ui/ConfirmModal'
import AddRecurringModal from '../components/ui/AddRecurringModal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'
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
  '6_weekly': 'Every 6 weeks', quarterly: 'Quarterly', custom: 'Custom',
}

// Profile status logic — combines is_active + status field into a single state
function getProfileState(p) {
  if (!p.is_active) return 'completed'
  if (p.status === 'cancelled') return 'cancelled'
  if (p.status === 'completed') return 'completed'
  if (p.status === 'paused') return 'paused'
  return 'active'
}

const STATE_TEXT = {
  active:    'text-emerald-600 dark:text-emerald-400',
  paused:    'text-amber-600 dark:text-amber-400',
  completed: 'text-gray-500 dark:text-gray-400',
  cancelled: 'text-gray-400 dark:text-gray-500',
}
const STATE_LABEL = {
  active: 'Active', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled',
}
const STATE_BADGE = {
  active: 'success-solid',
  paused: 'warning',
  completed: 'neutral',
  cancelled: 'neutral',
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

const emptyForm = {
  client_id: '', pool_id: '', job_type_template_id: '', title: '',
  recurrence_rule: 'weekly', custom_interval_days: '',
  preferred_day_of_week: '', preferred_time: '', assigned_staff_id: '',
  price: '', notes: '',
}

const PAGE_SIZE = 25

export default function RecurringJobs() {
  const toast = useToast()
  const { business } = useBusiness()
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState([])
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [jobTypes, setJobTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientSaving, setNewClientSaving] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [stateFilter, setStateFilter] = useState('all')
  const [page, setPage] = useState(0)

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

  const enriched = useMemo(
    () => profiles.map(p => ({ ...p, _state: getProfileState(p) })),
    [profiles],
  )

  const stateCounts = useMemo(() => ({
    all:       enriched.length,
    active:    enriched.filter(p => p._state === 'active').length,
    paused:    enriched.filter(p => p._state === 'paused').length,
    completed: enriched.filter(p => p._state === 'completed').length,
    cancelled: enriched.filter(p => p._state === 'cancelled').length,
  }), [enriched])

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return enriched
    return enriched.filter(p => p._state === stateFilter)
  }, [enriched, stateFilter])

  // KPI metrics (across all profiles)
  const recurringValue = useMemo(
    () => enriched
      .filter(p => p._state === 'active')
      .reduce((s, p) => s + (Number(p.price) || 0), 0),
    [enriched],
  )
  const activeCount = stateCounts.active
  const pausedCount = stateCounts.paused

  // Pagination
  useEffect(() => { setPage(0) }, [stateFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length)
  const pagedProfiles = useMemo(() => filtered.slice(pageStart, pageEnd), [filtered, pageStart, pageEnd])

  const selectedProfile = useMemo(() => {
    if (!filtered.length) return null
    return filtered.find(p => p.id === selectedProfileId) || filtered[0]
  }, [filtered, selectedProfileId])

  const clientPools = form.client_id
    ? (clients.find(c => c.id === form.client_id)?.pools || [])
    : []

  function openAdd() {
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

  async function handleCancelService() {
    if (!editing) return
    await handleStatusChange(editing.id, 'cancelled')
    setModalOpen(false)
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

  const heroTitle = enriched.length === 0
    ? 'No recurring services yet'
    : `${activeCount} active · ${formatCurrency(recurringValue)} per cycle`

  if (loading) {
    return (
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Repeat className="w-3.5 h-3.5" strokeWidth={2.5} />
              Recurring services
            </span>
          }
          title="Recurring"
        />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Repeat className="w-3.5 h-3.5" strokeWidth={2.5} />
            Recurring services
          </span>
        }
        title={heroTitle}
        action={
          <Button leftIcon={Plus} onClick={openAdd}>
            New recurring
          </Button>
        }
      />

      {/* KPI strip */}
      {enriched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">
          <Card tinted className="!p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Recurring value</p>
                <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                  {formatCurrency(recurringValue)}
                </p>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Active per cycle</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-pool-100 dark:bg-pool-900/50 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" strokeWidth={2} />
              </div>
            </div>
          </Card>
          <StatCard label="Active" value={activeCount} icon={Repeat} iconTone={activeCount > 0 ? 'brand' : 'gray'} />
          <StatCard label="Paused" value={pausedCount} icon={Pause}  iconTone={pausedCount > 0 ? 'amber' : 'gray'} />
        </div>
      )}

      {enriched.length === 0 ? (
        <EmptyState
          icon={<Repeat className="w-8 h-8" strokeWidth={1.5} />}
          title="No recurring services yet"
          description="Set up recurring service profiles to auto-generate jobs"
          action="New recurring"
          onAction={openAdd}
        />
      ) : (
        <>
          {/* State filter pills */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { key: 'all',       label: 'All' },
              { key: 'active',    label: 'Active' },
              { key: 'paused',    label: 'Paused' },
              { key: 'completed', label: 'Completed' },
              { key: 'cancelled', label: 'Cancelled' },
            ].map(f => {
              const active = stateFilter === f.key
              const count = stateCounts[f.key] || 0
              return (
                <button
                  key={f.key}
                  onClick={() => setStateFilter(f.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                    active
                      ? 'bg-pool-50 dark:bg-pool-950/40 border-pool-200 dark:border-pool-800/60 text-pool-700 dark:text-pool-300 ring-1 ring-pool-300/40'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                  )}
                >
                  <span>{f.label}</span>
                  <span className={cn(
                    'tabular-nums text-[11px]',
                    active ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500',
                  )}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* MOBILE: stacked card list */}
          <div className="md:hidden space-y-2.5">
            {filtered.map(p => (
              <Card key={p.id} onClick={() => openEdit(p)}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.clients?.name || 'Unknown'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                      {RECURRENCE_LABEL[p.recurrence_rule] || p.recurrence_rule}
                      {p.next_generation_at && ` · next ${formatDate(p.next_generation_at)}`}
                    </p>
                  </div>
                  <Badge variant={STATE_BADGE[p._state]} className="shrink-0">{STATE_LABEL[p._state]}</Badge>
                  {p.price && (
                    <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100 shrink-0 ml-2">
                      {formatCurrency(p.price)}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* DESKTOP: master-detail */}
          <div className="hidden md:grid md:grid-cols-12 gap-4">
            {/* Table */}
            <Card className="!p-0 md:col-span-7 overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_8rem_7rem_6rem_5rem] gap-3 px-4 py-2 bg-gray-50/60 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <span>Service / Client</span>
                <span>Frequency</span>
                <span>Next due</span>
                <span className="text-left">State</span>
                <span className="text-right">Price</span>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {pagedProfiles.map(p => {
                  const isSelected = selectedProfile && p.id === selectedProfile.id
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedProfileId(p.id)}
                        onDoubleClick={() => openEdit(p)}
                        className={cn(
                          'w-full grid grid-cols-[minmax(0,1fr)_8rem_7rem_6rem_5rem] gap-3 px-4 py-3 text-left transition-colors items-center',
                          isSelected
                            ? 'bg-pool-50 dark:bg-pool-950/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                        )}
                      >
                        <span className="min-w-0">
                          <span className={cn(
                            'block text-sm font-semibold truncate',
                            isSelected ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100',
                          )}>
                            {p.title}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                            {p.clients?.name || 'Unknown'}
                          </span>
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                          {RECURRENCE_LABEL[p.recurrence_rule] || p.recurrence_rule}
                        </span>
                        <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300 truncate">
                          {p.next_generation_at ? formatDate(p.next_generation_at) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </span>
                        <span className={cn('text-left text-sm font-medium', STATE_TEXT[p._state])}>
                          {STATE_LABEL[p._state]}
                        </span>
                        <span className="text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                          {p.price ? formatCurrency(p.price) : <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {pageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40">
                  <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    Showing {pageStart + 1}–{pageEnd} of {filtered.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                    </button>
                    <span className="px-3 h-8 inline-flex items-center text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                      {safePage + 1} / {pageCount}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Detail panel */}
            <div className="md:col-span-5">
              {selectedProfile && (
                <Card className="!p-5 sticky top-24">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pool-600 dark:text-pool-400 inline-flex items-center gap-2">
                      <Repeat className="w-3.5 h-3.5" strokeWidth={2.5} />
                      Recurring service
                    </p>
                    <Badge variant={STATE_BADGE[selectedProfile._state]}>
                      {STATE_LABEL[selectedProfile._state]}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                    {selectedProfile.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {selectedProfile.clients?.name || 'Unknown client'}
                  </p>
                  {selectedProfile.pools?.address && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {selectedProfile.pools.address}
                    </p>
                  )}

                  {/* Mini grid */}
                  <div className="grid grid-cols-2 gap-4 mt-5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Frequency</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                        {RECURRENCE_LABEL[selectedProfile.recurrence_rule] || selectedProfile.recurrence_rule}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Next due</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">
                        {selectedProfile.next_generation_at ? formatDate(selectedProfile.next_generation_at) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Price</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">
                        {selectedProfile.price ? formatCurrency(selectedProfile.price) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Duration</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                        {durationLabel(selectedProfile)}
                      </p>
                    </div>
                  </div>

                  {selectedProfile.staff_members?.name && (
                    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Assigned to</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{selectedProfile.staff_members.name}</p>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      leftIcon={Pencil}
                      onClick={() => openEdit(selectedProfile)}
                    >
                      Edit
                    </Button>
                    {selectedProfile._state === 'active' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={Pause}
                        onClick={() => handleStatusChange(selectedProfile.id, 'paused')}
                      >
                        Pause
                      </Button>
                    )}
                    {selectedProfile._state === 'paused' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={Play}
                        onClick={() => handleStatusChange(selectedProfile.id, 'active')}
                      >
                        Resume
                      </Button>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* New clean Add modal — same as used on Schedule page */}
      <AddRecurringModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        business={business}
        staff={staff}
        onCreated={() => { fetchAll(); setAddModalOpen(false) }}
      />

      {/* Legacy edit modal — only used for editing existing profiles */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Recurring Service' : 'New Recurring Service'}>
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
                <Input placeholder="Client name" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="flex-1" autoFocus />
                <Button type="button" onClick={handleQuickCreateClient} loading={newClientSaving} className="text-xs px-3 shrink-0">Add</Button>
                <button type="button" onClick={() => { setShowNewClient(false); setNewClientName('') }} className="text-xs text-gray-400 dark:text-gray-500 px-2 shrink-0 hover:text-gray-600">Cancel</button>
              </div>
            )}
          </div>
          {clientPools.length > 0 && (
            <Select label="Pool" options={[{ value: '', label: 'Select pool...' }, ...clientPools.map(p => ({ value: p.id, label: p.address }))]} value={form.pool_id} onChange={e => setForm(prev => ({ ...prev, pool_id: e.target.value }))} />
          )}
          {jobTypes.length > 0 && (
            <Select label="Job Type" options={[{ value: '', label: 'No template' }, ...jobTypes.map(j => ({ value: j.id, label: j.name }))]} value={form.job_type_template_id} onChange={e => onJobTypeChange(e.target.value)} />
          )}
          <Input label="Service Title" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Regular Maintenance" required />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Frequency" options={RECURRENCE_OPTIONS} value={form.recurrence_rule} onChange={e => setForm(prev => ({ ...prev, recurrence_rule: e.target.value }))} />
            {form.recurrence_rule === 'custom' ? (
              <Input label="Interval (days)" type="number" value={form.custom_interval_days} onChange={e => setForm(prev => ({ ...prev, custom_interval_days: e.target.value }))} placeholder="10" />
            ) : (
              <Select label="Preferred Day" options={DAY_OPTIONS} value={form.preferred_day_of_week} onChange={e => setForm(prev => ({ ...prev, preferred_day_of_week: e.target.value }))} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Preferred Time" type="time" value={form.preferred_time} onChange={e => setForm(prev => ({ ...prev, preferred_time: e.target.value }))} />
            <Input label="Price ($)" type="number" value={form.price} onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))} placeholder="150" />
          </div>
          {staff.length > 0 && (
            <Select label="Assign To" options={[{ value: '', label: 'Unassigned' }, ...staff.map(s => ({ value: s.id, label: s.name }))]} value={form.assigned_staff_id} onChange={e => setForm(prev => ({ ...prev, assigned_staff_id: e.target.value }))} />
          )}
          <TextArea label="Notes" value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Any recurring notes..." rows={2} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
          </div>

          {editing && (
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-2 space-y-2">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Actions</p>
              <div className="flex gap-2 flex-wrap">
                {(!editing.status || editing.status === 'active') && (
                  <Button type="button" variant="secondary" onClick={() => { handleStatusChange(editing.id, 'paused'); setModalOpen(false) }} className="text-xs px-3">Pause</Button>
                )}
                {editing.status === 'paused' && (
                  <Button type="button" variant="secondary" onClick={() => { handleStatusChange(editing.id, 'active'); setModalOpen(false) }} className="text-xs px-3">Resume</Button>
                )}
                {(editing.duration_type === 'until_date' || editing.duration_type === 'num_visits') && (
                  <Button type="button" variant="secondary" onClick={() => handleExtend(editing.id)} className="text-xs px-3">Extend</Button>
                )}
                {editing.status !== 'cancelled' && (
                  <Button type="button" variant="danger" onClick={() => setConfirmCancelOpen(true)} className="text-xs px-3">Cancel Service</Button>
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
    </PageWrapper>
  )
}
