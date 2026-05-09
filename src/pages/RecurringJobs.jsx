import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Pause, Pencil, Play, Plus, Repeat, Trash2, Wallet,
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
import NewClientModal from '../components/ui/NewClientModal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'
import RecurrencePicker from '../components/ui/RecurrencePicker'
import {
  describeSchedule,
  computeNthFromDate,
} from '../lib/recurringScheduling'

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
  preferred_time: '', assigned_staff_id: '',
  price: '', notes: '',
  // First service date is the anchor: its weekday drives projection,
  // and for monthly the Nth-occurrence is computed from it. Recurring
  // services are single-day-per-occurrence — two services per week =
  // two profiles anchored on different days.
  first_date: new Date().toISOString().split('T')[0],
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
  // Hard-delete dialog. Cancelling stops new jobs from generating; deleting
  // also removes the profile row from the DB. Existing scheduled jobs that
  // were already generated from this profile aren't touched (their
  // recurring_profile_id just orphans).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletingService, setDeletingService] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [stateFilter, setStateFilter] = useState('all')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (business?.id) fetchAll()
  }, [business?.id])

  async function fetchAll() {
    setLoading(true)
    // Pull legacy pool schedules alongside profiles so the operator
    // can manage both from one page. Pool-level schedules
    // (`pools.schedule_frequency` + `pools.next_due_at`) are written
    // by the legacy "regular_service" pool flow in PoolFormFields and
    // by AddRecurringModal as a denormalised mirror. The Schedule's
    // path-2 projector reads them, so any pool with these fields set
    // and no active profile pointing at it is producing schedule
    // stops that aren't editable from /recurring today — that's the
    // gap this fetch closes.
    const [profilesRes, clientsRes, staffRes, jobTypesRes, legacyPoolsRes] = await Promise.all([
      supabase.from('recurring_job_profiles').select('*, clients(name), pools(address), staff_members:assigned_staff_id(name), job_type_templates:job_type_template_id(name, color)')
        .eq('business_id', business.id).order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name, pools(id, address)').eq('business_id', business.id).order('name'),
      supabase.from('staff_members').select('id, name').eq('business_id', business.id).eq('is_active', true).order('name'),
      supabase.from('job_type_templates').select('id, name, color, default_tasks, estimated_duration_minutes, default_price')
        .eq('business_id', business.id).eq('is_active', true).order('name'),
      supabase.from('pools')
        .select('id, address, schedule_frequency, next_due_at, client_id, business_id, assigned_staff_id, clients(name)')
        .eq('business_id', business.id)
        .not('schedule_frequency', 'is', null)
        .not('next_due_at', 'is', null),
    ])
    const realProfiles = profilesRes.data || []

    // Drop any legacy pool that already has an active profile —
    // those pool fields are just a denormalised mirror, not a
    // separate schedule. The exclusion is in JS rather than a nested
    // EXISTS to keep the query simple and the cost of one extra
    // round-trip to a list of pool ids is irrelevant at this scale.
    const activeProfilePoolIds = new Set(
      realProfiles
        .filter(p => p.is_active && p.pool_id)
        .map(p => p.pool_id)
    )
    const legacyOnly = (legacyPoolsRes.data || []).filter(p => !activeProfilePoolIds.has(p.id))

    // Wrap each legacy pool in a "pseudo-profile" so the existing
    // render code can consume it without branching everywhere.
    // Handlers branch on `__isLegacy` to do the right thing
    // (delete clears pool fields; edit migrates to a real profile).
    const legacyPseudoProfiles = legacyOnly.map(p => ({
      id: `legacy-pool-${p.id}`,
      __isLegacy: true,
      __poolId: p.id,
      title: 'Pool Service',
      pool_id: p.id,
      client_id: p.client_id,
      business_id: p.business_id,
      assigned_staff_id: p.assigned_staff_id || null,
      clients: p.clients,
      pools: { id: p.id, address: p.address },
      // Map legacy schedule_frequency onto the recurrence_rule field
      // the rest of the code expects.
      recurrence_rule: p.schedule_frequency,
      next_generation_at: p.next_due_at?.split('T')[0] || null,
      last_generated_at: null,
      is_active: true,
      status: 'active',
      service_type: 'pool',
      duration_type: 'ongoing',
      price: null,
      created_at: p.next_due_at, // best-effort sort key
    }))

    setProfiles([...realProfiles, ...legacyPseudoProfiles])
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
    // First service date is whatever the profile is anchored on. The
    // weekday is derived from this date — no separate per-day state.
    const firstDate = profile.next_generation_at
      ? String(profile.next_generation_at).split('T')[0]
      : new Date().toISOString().split('T')[0]
    setForm({
      client_id: profile.client_id || '',
      pool_id: profile.pool_id || '',
      job_type_template_id: profile.job_type_template_id || '',
      title: profile.title || '',
      recurrence_rule: profile.recurrence_rule || 'weekly',
      custom_interval_days: profile.custom_interval_days || '',
      preferred_time: profile.preferred_time || '',
      assigned_staff_id: profile.assigned_staff_id || '',
      price: profile.price || '',
      notes: profile.notes || '',
      first_date: firstDate,
    })
    setModalOpen(true)
  }

  // Client creation lives in <NewClientModal> — same modal used at
  // /clients and inside AddRecurringModal. The legacy inline name-only
  // "quick create" was removed because it skipped the email/phone
  // duplicate guard and routinely produced phantom clients.
  function handleNewClientCreated(client) {
    // The modal returns the inserted row (or the existing client if
    // the operator clicked "Use existing"). Fold it into the local
    // clients list and select it on the form. The pools relation
    // isn't included here, so refetchAll picks up that side after.
    setClients(prev => prev.some(c => c.id === client.id)
      ? prev
      : [...prev, { ...client, pools: client.pools || [] }].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(prev => ({ ...prev, client_id: client.id, pool_id: '' }))
    setShowNewClient(false)
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
    if (!form.client_id || !form.title.trim() || !form.first_date) return
    setSaving(true)
    try {
      // First service date drives the day-of-week / Nth field. Single
      // weekday only — preferred_days_of_week stays null.
      const anchorDate = new Date(form.first_date + 'T00:00:00')
      const anchorWd = anchorDate.getDay()

      let preferred_day_of_week = null
      const preferred_days_of_week = null
      let monthly_week_of_month = null
      if (form.recurrence_rule === 'monthly') {
        preferred_day_of_week = anchorWd
        monthly_week_of_month = computeNthFromDate(anchorDate)
      } else if (form.recurrence_rule === 'weekly' || form.recurrence_rule === 'fortnightly') {
        preferred_day_of_week = anchorWd
      }

      const payload = {
        client_id: form.client_id,
        pool_id: form.pool_id || null,
        job_type_template_id: form.job_type_template_id || null,
        title: form.title.trim(),
        recurrence_rule: form.recurrence_rule,
        custom_interval_days: form.recurrence_rule === 'custom' ? Number(form.custom_interval_days) || 7 : null,
        preferred_day_of_week,
        preferred_days_of_week,
        monthly_week_of_month,
        preferred_time: form.preferred_time || null,
        assigned_staff_id: form.assigned_staff_id || null,
        price: form.price ? Number(form.price) : null,
        notes: form.notes.trim() || null,
        next_generation_at: form.first_date,
      }
      if (editing?.__isLegacy) {
        // Migrate a legacy pool-level schedule into a real profile.
        // The pool already has next_due_at + schedule_frequency set
        // (that's what made it legacy). We INSERT a profile and then
        // re-sync the pool fields to whatever the operator chose in
        // this edit — same shape AddRecurringModal would write on a
        // fresh create. After this, the active profile is the source
        // of truth and the legacy fetch query no longer surfaces this
        // pool because activeProfilePoolIds excludes it.
        const { error: insertErr } = await supabase
          .from('recurring_job_profiles')
          .insert({ ...payload, business_id: business.id })
        if (insertErr) throw insertErr
        if (form.pool_id) {
          const freq = form.recurrence_rule === 'custom'
            ? `${form.custom_interval_days}`
            : form.recurrence_rule
          await supabase.from('pools').update({
            schedule_frequency: freq,
            next_due_at: form.first_date
              ? new Date(form.first_date + 'T09:00:00').toISOString()
              : null,
          }).eq('id', form.pool_id)
        }
      } else if (editing) {
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

  // Permanently delete the recurring profile + every job materialized
  // from it + clear the denormalised pool fields. Different from
  // Cancel (which keeps the profile row at status=cancelled).
  //
  // Three things have to happen, all in one atomic-feeling sequence:
  //   1. Hard delete jobs with this recurring_profile_id. Detach was
  //      wrong — left orphan in_progress / scheduled jobs that path-1
  //      of the Schedule projector picked up and showed as "Already
  //      started" on what was supposed to be a brand new recurring.
  //   2. Hard delete the profile.
  //   3. Clear pools.next_due_at + pools.schedule_frequency for the
  //      profile's pool. The pool fields are a denormalised mirror of
  //      the profile schedule (AddRecurringModal writes them on
  //      create), and the Schedule's path-2 projector reads them to
  //      draw "pool service" stops independently of the profile. If
  //      we leave them around, every deleted recurring service keeps
  //      projecting forever — that's the "I deleted it, /recurring is
  //      empty, but the schedule still shows stops" report.
  //
  // Completed pool services live in service_records (not jobs) so the
  // chemical history stays. Completed ad-hoc jobs DO get hard-deleted
  // along with their parent profile — operator's expectation is "wipe
  // the slate" and that's how it now behaves.
  async function handleDeleteService() {
    if (!editing) return
    setDeletingService(true)
    try {
      // Legacy entries are pool-only (no profile, no jobs). Just clear
      // the pool's schedule mirror — that's the entire schedule for
      // these rows.
      if (editing.__isLegacy) {
        const { error: poolErr } = await supabase
          .from('pools')
          .update({ next_due_at: null, schedule_frequency: null })
          .eq('id', editing.__poolId)
        if (poolErr) throw poolErr
      } else {
        const { error: jobsErr } = await supabase
          .from('jobs')
          .delete()
          .eq('recurring_profile_id', editing.id)
        if (jobsErr) throw jobsErr

        const { error } = await supabase
          .from('recurring_job_profiles')
          .delete()
          .eq('id', editing.id)
        if (error) throw error

        // Clear the pool's denormalised mirror so path-2 stops projecting.
        // We only clear fields the recurring lifecycle owns; address /
        // other pool fields stay untouched.
        if (editing.pool_id) {
          await supabase
            .from('pools')
            .update({ next_due_at: null, schedule_frequency: null })
            .eq('id', editing.pool_id)
        }
      }
      toast.success('Recurring service deleted')
      // If the deleted profile was selected in the desktop detail pane,
      // clear the selection so the empty-state shows.
      if (selectedProfile?.id === editing.id) setSelectedProfileId(null)
      setConfirmDeleteOpen(false)
      setModalOpen(false)
      fetchAll()
    } catch (err) {
      toast.error(err.message || 'Failed to delete')
    } finally {
      setDeletingService(false)
    }
  }

  // Pausing or cancelling a profile must also clear the denormalised
  // pool mirror, otherwise path-2 of the Schedule projector keeps
  // emitting "pool service" stops as if the profile were live. Status
  // moves *into* active (resume) re-anchor the pool fields from the
  // current profile rule so projections come back.
  async function handleStatusChange(profileId, newStatus) {
    try {
      await supabase.from('recurring_job_profiles').update({ status: newStatus }).eq('id', profileId)

      // Look up the pool_id + (for resume) the rule we need to mirror.
      // Cheap single-row fetch keeps this self-contained without
      // depending on whatever's loaded into local state.
      const { data: profile } = await supabase
        .from('recurring_job_profiles')
        .select('pool_id, recurrence_rule, custom_interval_days, next_generation_at')
        .eq('id', profileId)
        .single()

      if (profile?.pool_id) {
        if (newStatus === 'paused' || newStatus === 'cancelled') {
          await supabase
            .from('pools')
            .update({ next_due_at: null, schedule_frequency: null })
            .eq('id', profile.pool_id)
        } else if (newStatus === 'active') {
          // Re-anchor the mirror to the profile so the schedule starts
          // projecting again. next_generation_at is the next planned
          // occurrence; if it's missing we fall back to today and let
          // the operator adjust via the edit flow.
          const freq = profile.recurrence_rule === 'custom' && profile.custom_interval_days
            ? String(profile.custom_interval_days)
            : profile.recurrence_rule
          const nextDue = profile.next_generation_at
            ? new Date(profile.next_generation_at + 'T09:00:00').toISOString()
            : new Date().toISOString()
          await supabase
            .from('pools')
            .update({ next_due_at: nextDue, schedule_frequency: freq })
            .eq('id', profile.pool_id)
        }
      }

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
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{p.title}</p>
                      {p.__isLegacy && (
                        <Badge variant="warning" className="shrink-0 text-[9px] uppercase tracking-wider">Legacy</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.clients?.name || 'Unknown'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                      {describeSchedule(p)}
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
                            'flex items-center gap-1.5 text-sm font-semibold',
                            isSelected ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100',
                          )}>
                            <span className="truncate">{p.title}</span>
                            {p.__isLegacy && (
                              <Badge variant="warning" className="shrink-0 text-[9px] uppercase tracking-wider">Legacy</Badge>
                            )}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                            {p.clients?.name || 'Unknown'}
                          </span>
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                          {describeSchedule(p)}
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
                    <div className="flex items-center gap-1.5">
                      {selectedProfile.__isLegacy && (
                        <Badge variant="warning" className="text-[10px] uppercase tracking-wider">Legacy</Badge>
                      )}
                      <Badge variant={STATE_BADGE[selectedProfile._state]}>
                        {STATE_LABEL[selectedProfile._state]}
                      </Badge>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                    {selectedProfile.title}
                  </h3>
                  {selectedProfile.__isLegacy && (
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-lg px-2.5 py-1.5">
                      Pool-level legacy schedule. Hit Edit to migrate it into a proper recurring profile.
                    </p>
                  )}
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
                        {describeSchedule(selectedProfile)}
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
                    {/* Pause / Resume only make sense for real profile
                        rows — they flip the profile's status. Legacy
                        pool-level entries have no profile to flip; the
                        operator should Edit (which migrates legacy →
                        profile) and pause from there. */}
                    {!selectedProfile.__isLegacy && selectedProfile._state === 'active' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={Pause}
                        onClick={() => handleStatusChange(selectedProfile.id, 'paused')}
                      >
                        Pause
                      </Button>
                    )}
                    {!selectedProfile.__isLegacy && selectedProfile._state === 'paused' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={Play}
                        onClick={() => handleStatusChange(selectedProfile.id, 'active')}
                      >
                        Resume
                      </Button>
                    )}
                    {/* Delete sits on the far right, opposite Edit, so
                        it's discoverable without opening the edit modal
                        first. ml-auto pushes it past the Pause/Resume
                        secondaries when they're shown. handleDeleteService
                        keys off `editing`, so we set that here too. */}
                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={Trash2}
                      onClick={() => {
                        setEditing(selectedProfile)
                        setConfirmDeleteOpen(true)
                      }}
                      className="ml-auto"
                    >
                      Delete
                    </Button>
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
            <button type="button" onClick={() => setShowNewClient(true)}
              className="text-xs text-pool-600 dark:text-pool-400 font-semibold mt-1.5 hover:text-pool-700">
              + New Client
            </button>
          </div>
          {clientPools.length > 0 && (
            <Select label="Pool" options={[{ value: '', label: 'Select pool...' }, ...clientPools.map(p => ({ value: p.id, label: p.address }))]} value={form.pool_id} onChange={e => setForm(prev => ({ ...prev, pool_id: e.target.value }))} />
          )}
          {jobTypes.length > 0 && (
            <Select label="Job Type" options={[{ value: '', label: 'No template' }, ...jobTypes.map(j => ({ value: j.id, label: j.name }))]} value={form.job_type_template_id} onChange={e => onJobTypeChange(e.target.value)} />
          )}
          <Input label="Service Title" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} placeholder="e.g. Regular Maintenance" required />

          <Input
            label="First service date"
            type="date"
            value={form.first_date}
            onChange={e => setForm(prev => ({ ...prev, first_date: e.target.value }))}
          />

          <RecurrencePicker
            value={{
              rule: form.recurrence_rule,
              customDays: form.custom_interval_days,
            }}
            onChange={(next) => setForm(prev => ({
              ...prev,
              recurrence_rule: next.rule,
              custom_interval_days: next.customDays,
            }))}
            firstDate={form.first_date}
          />
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
                  <Button type="button" variant="secondary" onClick={() => setConfirmCancelOpen(true)} className="text-xs px-3">Cancel Service</Button>
                )}
                {/* Hard-delete: removes the profile row entirely. Use
                    when the operator wants to clean up rather than
                    keep a cancelled record for history. */}
                <Button
                  type="button"
                  variant="danger"
                  leftIcon={Trash2}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="text-xs px-3"
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        open={confirmCancelOpen}
        onClose={() => setConfirmCancelOpen(false)}
        title="Cancel this recurring service?"
        description="This will stop generating new jobs from now. Existing scheduled jobs are not removed. The profile stays in the list as Cancelled — use Delete instead to remove it entirely."
        destructive
        confirmLabel="Cancel Service"
        onConfirm={handleCancelService}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete this recurring service?"
        description="Permanently removes the profile from the list. Existing scheduled jobs that were generated from this profile aren't deleted — only the recurring template is. Cannot be undone."
        destructive
        confirmLabel={deletingService ? 'Deleting…' : 'Delete service'}
        onConfirm={handleDeleteService}
      />

      {/* Shared new-client modal (same one used at /clients and inside
          AddRecurringModal). Nested above the edit modal via zLayer 70. */}
      <NewClientModal
        open={showNewClient}
        onClose={() => setShowNewClient(false)}
        onCreated={handleNewClientCreated}
        zLayer={70}
      />
    </PageWrapper>
  )
}
