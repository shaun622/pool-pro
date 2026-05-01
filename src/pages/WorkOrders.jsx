import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import {
  ArrowRight, Briefcase, ChevronLeft, ChevronRight,
  MapPin, Plus, User, Wallet, Wrench, X,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import Input, { Select, TextArea } from '../components/ui/Input'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../components/PoolFormFields'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'

const STATE_LABEL = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
}
const STATE_BADGE = {
  scheduled: 'primary',
  in_progress: 'warning',
  on_hold: 'neutral',
  completed: 'success-solid',
}
const STATE_TEXT = {
  scheduled:   'text-pool-700 dark:text-pool-300',
  in_progress: 'text-amber-600 dark:text-amber-400',
  on_hold:     'text-gray-500 dark:text-gray-400',
  completed:   'text-emerald-600 dark:text-emerald-400',
}
const FILTER_KEYS = ['all', 'scheduled', 'in_progress', 'on_hold', 'completed']

const PAGE_SIZE = 25

function dateBadgeParts(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-AU', { month: 'short' }),
  }
}

function formatTime(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

export default function WorkOrders() {
  const toast = useToast()
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [jobs, setJobs] = useState([])
  const [stateFilter, setStateFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [selectedJobId, setSelectedJobId] = useState(null)

  // Create job modal
  const [jobModalOpen, setJobModalOpen] = useState(false)
  const [clients, setClients] = useState([])
  const [clientPools, setClientPools] = useState([])
  const [jobForm, setJobForm] = useState({
    client_id: '', pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0],
    scheduled_time: '09:00', notes: '', price: '', assigned_staff_id: '',
  })
  const [staffList, setStaffList] = useState([])
  const [showAddTech, setShowAddTech] = useState(false)
  const [newTechForm, setNewTechForm] = useState({ name: '', email: '', phone: '', role: 'tech' })
  const [newTechSaving, setNewTechSaving] = useState(false)
  const [jobSaving, setJobSaving] = useState(false)
  const jobSubmittingRef = useRef(false)

  // Inline pool creation (uses full PoolFormFields component)
  const [showNewPool, setShowNewPool] = useState(false)
  const [newPoolForm, setNewPoolForm] = useState(emptyPool)
  const [newPoolSaving, setNewPoolSaving] = useState(false)

  // Inline client creation
  const [showNewClient, setShowNewClient] = useState(false)
  const [newClientForm, setNewClientForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' })
  const [newClientSaving, setNewClientSaving] = useState(false)

  const handleCreateClientInline = async () => {
    if (!newClientForm.name.trim() || !business?.id) return
    setNewClientSaving(true)
    try {
      // Block duplicate names — if a client with the same name (case-
      // insensitive, trimmed) already exists for this business, reuse it
      // instead of creating a duplicate. Operator gets a toast pointing
      // them at the existing record.
      const trimmed = newClientForm.name.trim()
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name, address')
        .eq('business_id', business.id)
        .ilike('name', trimmed)
        .limit(5)
      const dup = (existing || []).find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase())
      if (dup) {
        toast.error(`A client named "${dup.name}" already exists. Using the existing record.`)
        setClients(prev => prev.some(c => c.id === dup.id) ? prev : [...prev, dup].sort((a, b) => a.name.localeCompare(b.name)))
        setJobForm(prev => ({ ...prev, client_id: dup.id, pool_id: '' }))
        setNewClientForm({ name: '', email: '', phone: '', address: '', notes: '' })
        setShowNewClient(false)
        return
      }

      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: trimmed,
        email: newClientForm.email.trim() || null,
        phone: newClientForm.phone.trim() || null,
        address: newClientForm.address.trim() || null,
        notes: newClientForm.notes.trim() || null,
      }).select('id, name, address').single()
      if (error) throw error
      setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setJobForm(prev => ({ ...prev, client_id: data.id, pool_id: '' }))
      // Pre-seed the pool form with the client's address so "Same as client" has something to copy.
      const clientAddress = newClientForm.address.trim()
      setNewPoolForm({
        ...emptyPool,
        address: clientAddress,
        sameAsClient: !!clientAddress,
      })
      setNewClientForm({ name: '', email: '', phone: '', address: '', notes: '' })
      setShowNewClient(false)
      // Jump straight into the Add Pool step
      setShowNewPool(true)
    } catch (err) {
      console.error('Error creating client inline:', err)
      toast.error(err?.message || 'Failed to create client')
    } finally {
      setNewClientSaving(false)
    }
  }

  async function fetchData() {
    if (!business?.id) return
    setLoading(true)
    const { data } = await supabase.from('jobs')
      .select('*, clients(name, email, phone), pools(address, latitude, longitude), staff_members(name)')
      .eq('business_id', business.id)
      .is('recurring_profile_id', null)
      .order('scheduled_date', { ascending: false, nullsFirst: false })
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!business?.id) return
    fetchData()

    const uniqueId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = supabase.channel(`work-orders-${business.id}-${uniqueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `business_id=eq.${business.id}` }, () => fetchData())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [business?.id, location.key])

  // Pre-fill from query params (from Quote → Add as Work Order)
  useEffect(() => {
    if (!business?.id) return
    const clientParam = searchParams.get('client')
    if (!clientParam) return

    // Fetch clients first, then pre-fill and open modal
    supabase.from('clients').select('id, name, address').eq('business_id', business.id).order('name')
      .then(({ data }) => {
        setClients(data || [])
        setJobForm(prev => ({
          ...prev,
          client_id: clientParam,
          pool_id: searchParams.get('pool') || '',
          title: searchParams.get('title') || '',
          price: searchParams.get('price') || '',
        }))
        setJobModalOpen(true)
        // Clear params so reopening doesn't re-trigger
        setSearchParams({}, { replace: true })
      })
  }, [business?.id, searchParams])

  // Fetch clients and staff when modal opens
  useEffect(() => {
    if (!jobModalOpen || !business?.id) return
    if (!clients.length) {
      supabase.from('clients').select('id, name, address').eq('business_id', business.id).order('name')
        .then(({ data }) => setClients(data || []))
    }
    if (!staffList.length) {
      supabase.from('staff_members').select('id, name').eq('business_id', business.id).eq('is_active', true).order('name')
        .then(({ data }) => setStaffList(data || []))
    }
  }, [jobModalOpen, business?.id])

  // Fetch pools when client changes
  useEffect(() => {
    if (!jobForm.client_id) { setClientPools([]); return }
    supabase.from('pools').select('id, address').eq('client_id', jobForm.client_id)
      .then(({ data }) => setClientPools(data || []))
  }, [jobForm.client_id])

  const resetJobForm = () => {
    setJobForm({
      client_id: '', pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0],
      scheduled_time: '09:00', notes: '', price: '', assigned_staff_id: '',
    })
    setShowNewPool(false)
    setNewPoolForm(emptyPool)
    setShowAddTech(false)
    setNewTechForm({ name: '', email: '', phone: '', role: 'tech' })
  }

  async function handleAddTech() {
    if (!newTechForm.name.trim()) return
    setNewTechSaving(true)
    try {
      const { data, error } = await supabase
        .from('staff_members')
        .insert({ ...newTechForm, business_id: business.id })
        .select('id, name')
        .single()
      if (error) throw error
      setStaffList(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setJobForm(f => ({ ...f, assigned_staff_id: data.id }))
      setShowAddTech(false)
      setNewTechForm({ name: '', email: '', phone: '', role: 'tech' })
    } catch (err) {
      console.error('Error adding technician:', err)
      toast.error(err.message || 'Failed to add technician')
    } finally {
      setNewTechSaving(false)
    }
  }

  async function handleCreatePool() {
    if (!newPoolForm.address.trim() || !jobForm.client_id) return
    setNewPoolSaving(true)
    try {
      const payload = await buildPoolPayload(newPoolForm)
      const { data, error } = await supabase.from('pools').insert({
        ...payload,
        client_id: jobForm.client_id,
        business_id: business.id,
      }).select('id, address').single()
      if (error) throw error
      setClientPools(prev => [...prev, data])
      setJobForm(prev => ({ ...prev, pool_id: data.id }))
      setNewPoolForm(emptyPool)
      setShowNewPool(false)
    } catch (err) {
      console.error('Error creating pool:', err)
      toast.error(err?.message || 'Failed to create pool')
    } finally {
      setNewPoolSaving(false)
    }
  }

  async function handleJobSubmit(e) {
    e.preventDefault()
    if (!jobForm.client_id || !jobForm.title.trim()) return
    if (jobSubmittingRef.current) return // guard against double submission
    jobSubmittingRef.current = true
    setJobSaving(true)
    try {
      const jobData = {
        business_id: business.id,
        client_id: jobForm.client_id,
        pool_id: jobForm.pool_id || null,
        title: jobForm.title.trim(),
        status: 'scheduled',
        scheduled_date: jobForm.scheduled_date || null,
        scheduled_time: jobForm.scheduled_time || null,
        price: jobForm.price ? Number(jobForm.price) : null,
        notes: jobForm.notes.trim() || null,
      }
      if (jobForm.assigned_staff_id) jobData.assigned_staff_id = jobForm.assigned_staff_id
      const { data, error } = await supabase.from('jobs').insert(jobData).select('*, clients(name), pools(address)').single()
      if (error) throw error

      // Log activity
      await supabase.from('activity_feed').insert({
        business_id: business.id,
        type: 'job_created',
        title: `Job created: ${jobForm.title.trim()}`,
        description: data.clients?.name || '',
        link_to: `/work-orders/${data.id}`,
      })

      // Don't locally prepend — realtime subscription will refresh the list
      // and prevent a duplicate showing briefly.
      setJobModalOpen(false)
      resetJobForm()
    } catch (err) {
      console.error('Error creating job:', err)
    } finally {
      setJobSaving(false)
      jobSubmittingRef.current = false
    }
  }

  // ─── Derived state for the page ─────────────────────
  const stateCounts = useMemo(() => ({
    all:         jobs.length,
    scheduled:   jobs.filter(j => j.status === 'scheduled').length,
    in_progress: jobs.filter(j => j.status === 'in_progress').length,
    on_hold:     jobs.filter(j => j.status === 'on_hold').length,
    completed:   jobs.filter(j => j.status === 'completed').length,
  }), [jobs])

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return jobs
    return jobs.filter(j => j.status === stateFilter)
  }, [jobs, stateFilter])

  // KPI metrics
  const scheduledValue = useMemo(
    () => jobs.filter(j => j.status === 'scheduled').reduce((s, j) => s + (Number(j.price) || 0), 0),
    [jobs],
  )
  const inProgressCount = stateCounts.in_progress

  // Completed this calendar month
  const completedThisMonth = useMemo(() => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return jobs.filter(j => j.status === 'completed' && j.scheduled_date?.startsWith(ym)).length
  }, [jobs])

  // Pagination — reset to page 0 when filter changes
  useEffect(() => { setPage(0) }, [stateFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length)
  const pagedJobs = useMemo(() => filtered.slice(pageStart, pageEnd), [filtered, pageStart, pageEnd])

  const selectedJob = useMemo(() => {
    if (!filtered.length) return null
    return filtered.find(j => j.id === selectedJobId) || filtered[0]
  }, [filtered, selectedJobId])

  // Hero title
  const heroTitle = jobs.length === 0
    ? 'No work orders yet'
    : `${stateCounts.scheduled} scheduled${inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ''}`

  if (bizLoading || loading) {
    return (
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5" strokeWidth={2.5} />
              Jobs board
            </span>
          }
          title="Work Orders"
        />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  return (
    <>
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5" strokeWidth={2.5} />
              Jobs board
            </span>
          }
          title={heroTitle}
          action={
            <Button leftIcon={Plus} onClick={() => setJobModalOpen(true)}>
              New work order
            </Button>
          }
        />

        {/* KPI strip — hidden when there's nothing to show */}
        {jobs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">
            <Card tinted className="!p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Scheduled work</p>
                  <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                    {formatCurrency(scheduledValue)}
                  </p>
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    {stateCounts.scheduled} {stateCounts.scheduled === 1 ? 'job' : 'jobs'}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-pool-100 dark:bg-pool-900/50 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5" strokeWidth={2} />
                </div>
              </div>
            </Card>
            <StatCard
              label="In progress"
              value={inProgressCount}
              icon={Wrench}
              iconTone={inProgressCount > 0 ? 'amber' : 'gray'}
            />
            <StatCard
              label="Completed this month"
              value={completedThisMonth}
              icon={Briefcase}
              iconTone={completedThisMonth > 0 ? 'brand' : 'gray'}
            />
          </div>
        )}

        {jobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="w-8 h-8" strokeWidth={1.5} />}
            title="No work orders"
            description="Create a work order to track one-off repairs and extra work"
            action="New work order"
            onAction={() => setJobModalOpen(true)}
          />
        ) : (
          <>
            {/* State filter pills */}
            <div className="flex flex-wrap gap-2 mb-4">
              {FILTER_KEYS.map(key => {
                const active = stateFilter === key
                const count = stateCounts[key] || 0
                return (
                  <button
                    key={key}
                    onClick={() => setStateFilter(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                      active
                        ? 'bg-pool-50 dark:bg-pool-950/40 border-pool-200 dark:border-pool-800/60 text-pool-700 dark:text-pool-300 ring-1 ring-pool-300/40'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    <span>{key === 'all' ? 'All' : STATE_LABEL[key]}</span>
                    <span className={cn(
                      'tabular-nums text-[11px]',
                      active ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500',
                    )}>{count}</span>
                  </button>
                )
              })}
            </div>

            {filtered.length === 0 ? (
              <Card className="!p-12 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No {stateFilter === 'all' ? 'work orders' : STATE_LABEL[stateFilter]?.toLowerCase()} {stateFilter !== 'all' && 'work orders'}
                </p>
              </Card>
            ) : (
              <>
                {/* MOBILE: stacked card list */}
                <div className="md:hidden space-y-2.5">
                  {filtered.map(job => (
                    <MobileJobCard
                      key={job.id}
                      job={job}
                      onClick={() => navigate(`/work-orders/${job.id}`)}
                    />
                  ))}
                </div>

                {/* DESKTOP: master-detail */}
                <div className="hidden md:grid md:grid-cols-12 gap-4">
                  {/* Table */}
                  <Card className="!p-0 md:col-span-7 overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_5.5rem_5rem] gap-3 px-4 py-2 bg-gray-50/60 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      <span>Job / Client</span>
                      <span>Date</span>
                      <span>Tech</span>
                      <span>State</span>
                      <span className="text-right">Price</span>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {pagedJobs.map(job => {
                        const isSelected = selectedJob && job.id === selectedJob.id
                        const dateStr = job.scheduled_date
                          ? new Date(job.scheduled_date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                          : null
                        return (
                          <li key={job.id}>
                            <button
                              onClick={() => setSelectedJobId(job.id)}
                              onDoubleClick={() => navigate(`/work-orders/${job.id}`)}
                              className={cn(
                                'w-full grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_5.5rem_5rem] gap-3 px-4 py-3 text-left transition-colors items-center',
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
                                  {job.title || 'Job'}
                                </span>
                                <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {job.clients?.name || 'Unknown'}
                                </span>
                              </span>
                              <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300 truncate">
                                {dateStr || <span className="text-gray-300 dark:text-gray-600">—</span>}
                              </span>
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                {job.staff_members?.name || <span className="text-gray-300 dark:text-gray-600">Unassigned</span>}
                              </span>
                              <span className={cn('text-sm font-medium', STATE_TEXT[job.status])}>
                                {STATE_LABEL[job.status] || 'Scheduled'}
                              </span>
                              <span className="text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                {job.price ? formatCurrency(job.price) : <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}
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
                    {selectedJob && (
                      <DetailPanel
                        job={selectedJob}
                        onOpen={() => navigate(`/work-orders/${selectedJob.id}`)}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </PageWrapper>

      {/* Create Job Modal */}
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title="New Work Order">
        <form onSubmit={handleJobSubmit} className="space-y-4">
          {!showNewClient ? (
            <div>
              <Select
                label="Client"
                value={jobForm.client_id}
                onChange={e => setJobForm(prev => ({ ...prev, client_id: e.target.value, pool_id: '' }))}
                options={[{ value: '', label: 'Select client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
                required={!showNewClient}
              />
              <button type="button" onClick={() => setShowNewClient(true)}
                className="mt-1.5 text-xs font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700">
                + Add new client
              </button>
            </div>
          ) : (
            <div
              className="space-y-3 p-3 rounded-lg border border-pool-200 bg-pool-50 dark:bg-pool-950/30 animate-fade-in"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateClientInline() } }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Client</span>
                <button type="button"
                  onClick={() => { setShowNewClient(false); setNewClientForm({ name: '', email: '', phone: '', address: '', notes: '' }) }}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400">
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <Input
                label="Name"
                value={newClientForm.name}
                onChange={e => setNewClientForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Full name"
                required
              />
              <Input
                label="Email"
                type="email"
                value={newClientForm.email}
                onChange={e => setNewClientForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="email@example.com"
              />
              <Input
                label="Phone"
                type="tel"
                value={newClientForm.phone}
                onChange={e => setNewClientForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="0400 000 000"
              />
              <AddressAutocomplete
                label="Address"
                value={newClientForm.address}
                onChange={(v) => setNewClientForm(prev => ({ ...prev, address: v }))}
                onSelect={({ address }) => setNewClientForm(prev => ({ ...prev, address }))}
                placeholder="Start typing a street address..."
              />
              <TextArea
                label="Notes"
                value={newClientForm.notes}
                onChange={e => setNewClientForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any additional notes..."
              />
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); handleCreateClientInline() }}
                disabled={!newClientForm.name.trim() || newClientSaving}
                className="w-full px-3 py-2.5 rounded-lg bg-gradient-brand text-white text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {newClientSaving ? 'Saving…' : 'Next'}
              </button>
            </div>
          )}
          {jobForm.client_id && !showNewClient && (
            <div>
              <Select
                label="Pool"
                value={jobForm.pool_id}
                onChange={e => setJobForm(prev => ({ ...prev, pool_id: e.target.value }))}
                options={[
                  { value: '', label: 'No Pool — General Items' },
                  ...clientPools.map(p => ({ value: p.id, label: p.address })),
                ]}
              />
              {!showNewPool ? (
                <button type="button" onClick={() => setShowNewPool(true)}
                  className="mt-1.5 text-xs font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700">
                  + Add new pool
                </button>
              ) : (
                <div
                  className="mt-2 space-y-4 p-3 rounded-lg border border-pool-200 bg-pool-50 dark:bg-pool-950/30 animate-fade-in"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault() } }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Pool</span>
                    <button type="button"
                      onClick={() => { setShowNewPool(false); setNewPoolForm(emptyPool) }}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400">
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                  <PoolFormFields
                    poolForm={newPoolForm}
                    setPoolForm={setNewPoolForm}
                    clientAddress={clients.find(c => c.id === jobForm.client_id)?.address || ''}
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); handleCreatePool() }}
                    disabled={!newPoolForm.address.trim() || newPoolSaving}
                    className="w-full px-3 py-2.5 rounded-lg bg-gradient-brand text-white text-sm font-semibold shadow-sm hover:shadow-md active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {newPoolSaving ? 'Saving…' : 'Add Pool'}
                  </button>
                </div>
              )}
            </div>
          )}
          <Input
            label="Job Title"
            value={jobForm.title}
            onChange={e => setJobForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Filter replacement, Green pool cleanup"
            required
          />

          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              One-off job. For recurring services, use <strong>Schedule → Recurring</strong>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={jobForm.scheduled_date}
              onChange={e => setJobForm(prev => ({ ...prev, scheduled_date: e.target.value }))}
            />
            <Input
              label="Time"
              type="time"
              value={jobForm.scheduled_time}
              onChange={e => setJobForm(prev => ({ ...prev, scheduled_time: e.target.value }))}
            />
          </div>
          <Input
            label="Price ($)"
            type="number"
            value={jobForm.price}
            onChange={e => setJobForm(prev => ({ ...prev, price: e.target.value }))}
            placeholder="Optional"
          />
          <Select
            label="Assign Technician"
            value={jobForm.assigned_staff_id}
            onChange={e => {
              if (e.target.value === '__add__') {
                setShowAddTech(true)
                setJobForm(f => ({ ...f, assigned_staff_id: '' }))
              } else {
                setJobForm(f => ({ ...f, assigned_staff_id: e.target.value }))
                setShowAddTech(false)
              }
            }}
            options={[
              { value: '', label: 'Unassigned' },
              ...staffList.map(s => ({ value: s.id, label: s.name })),
              { value: '__add__', label: '+ Add Technician' },
            ]}
          />
          {showAddTech && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">New Technician</h4>
              <Input
                label="Name"
                value={newTechForm.name}
                onChange={e => setNewTechForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
              <Input
                label="Email"
                type="email"
                value={newTechForm.email}
                onChange={e => setNewTechForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
              />
              <Input
                label="Phone"
                type="tel"
                value={newTechForm.phone}
                onChange={e => setNewTechForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="04XX XXX XXX"
              />
              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowAddTech(false)}>
                  Cancel
                </Button>
                <Button type="button" className="flex-1" onClick={handleAddTech} loading={newTechSaving} disabled={!newTechForm.name.trim()}>
                  Add
                </Button>
              </div>
            </div>
          )}
          <TextArea
            label="Notes"
            value={jobForm.notes}
            onChange={e => setJobForm(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Job details..."
            rows={2}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setJobModalOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={jobSaving}>Create</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

// ─── Mobile job card (matches Clients/Quotes/Recurring style) ───────
function MobileJobCard({ job, onClick }) {
  const dateBadge = dateBadgeParts(job.scheduled_date)
  const timeStr = formatTime(job.scheduled_time)
  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-3">
        {/* Date badge — pool gradient when scheduled, gray when not */}
        <div className={cn(
          'flex flex-col items-center justify-center px-3 py-2 rounded-xl shrink-0 w-[60px]',
          dateBadge
            ? 'bg-gradient-brand text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
        )}>
          {dateBadge ? (
            <>
              <span className="text-[18px] font-bold leading-none tabular-nums">{dateBadge.day}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider mt-0.5">{dateBadge.month}</span>
            </>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-center leading-tight">No date</span>
          )}
        </div>

        {/* Title + client */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {job.title || 'Job'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {job.clients?.name || 'Unknown'}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
            {timeStr ? `${timeStr} · ` : ''}{job.staff_members?.name || 'Unassigned'}
          </p>
        </div>

        {/* State + price */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={STATE_BADGE[job.status] || 'neutral'}>
            {STATE_LABEL[job.status] || 'Scheduled'}
          </Badge>
          {job.price ? (
            <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {formatCurrency(job.price)}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

// ─── Sticky desktop detail panel ────────────────────
function DetailPanel({ job, onOpen }) {
  const dateBadge = dateBadgeParts(job.scheduled_date)
  const timeStr = formatTime(job.scheduled_time)
  const duration = job.estimated_duration_minutes || 60

  return (
    <Card className="!p-5 sticky top-24">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pool-600 dark:text-pool-400 inline-flex items-center gap-2">
          <Briefcase className="w-3.5 h-3.5" strokeWidth={2.5} />
          Work order
        </p>
        <Badge variant={STATE_BADGE[job.status] || 'neutral'}>
          {STATE_LABEL[job.status] || 'Scheduled'}
        </Badge>
      </div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
        {job.title || 'Job'}
      </h3>
      {job.clients?.name && (
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          {job.clients.name}
        </p>
      )}
      {job.pools?.address && (
        <p className="text-xs text-pool-600 dark:text-pool-400 truncate mt-0.5 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          {job.pools.address}
        </p>
      )}

      {/* Mini grid */}
      <div className="grid grid-cols-2 gap-4 mt-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Date</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">
            {dateBadge ? `${dateBadge.day} ${dateBadge.month}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Time</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">
            {timeStr ? (
              <>
                {timeStr} <span className="text-gray-400 dark:text-gray-500 font-normal">· {duration}m</span>
              </>
            ) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Tech</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 truncate">
            {job.staff_members?.name || <span className="text-gray-400 dark:text-gray-500 font-normal">Unassigned</span>}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Price</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">
            {job.price ? formatCurrency(job.price) : '—'}
          </p>
        </div>
      </div>

      {job.notes && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Notes</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-3">{job.notes}</p>
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300 transition-colors group"
        >
          Open work order
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
        </button>
      </div>
    </Card>
  )
}
