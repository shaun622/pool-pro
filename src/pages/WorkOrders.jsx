import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { Select, TextArea } from '../components/ui/Input'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../components/PoolFormFields'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import StopDetailModal from '../components/ui/StopDetailModal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'

const JOB_STATUS_BADGE = {
  scheduled: 'primary',
  in_progress: 'warning',
  on_hold: 'default',
  completed: 'success',
}

const JOB_STATUS_LABEL = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
}

const JOB_STATUSES = ['all', 'scheduled', 'in_progress', 'on_hold', 'completed']

// Convert a job row into the "stop" shape expected by StopDetailModal
function jobToStop(j) {
  const duration = j.estimated_duration_minutes || 60
  let timeDisp = null
  if (j.scheduled_time) {
    const [h, m] = j.scheduled_time.split(':').map(Number)
    const startD = new Date(); startD.setHours(h || 0, m || 0, 0, 0)
    const endD = new Date(startD.getTime() + duration * 60000)
    const fmt = x => x.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    timeDisp = `${fmt(startD)} – ${fmt(endD)}`
  }
  return {
    type: 'job',
    id: j.id,
    title: j.title || 'Job',
    client_id: j.client_id,
    pool_id: j.pool_id,
    client_name: j.clients?.name,
    address: j.pools?.address || null,
    status: j.status,
    scheduled_date: j.scheduled_date,
    scheduled_time: j.scheduled_time,
    time_display: timeDisp,
    duration,
    price: j.price,
    notes: j.notes,
    phone: j.clients?.phone,
    email: j.clients?.email,
    lat: j.pools?.latitude ? Number(j.pools.latitude) : null,
    lng: j.pools?.longitude ? Number(j.pools.longitude) : null,
  }
}

export default function WorkOrders() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Job detail modal
  const [selectedJob, setSelectedJob] = useState(null)

  // Create job modal
  const [jobModalOpen, setJobModalOpen] = useState(false)
  const [clients, setClients] = useState([])
  const [clientPools, setClientPools] = useState([])
  const [jobForm, setJobForm] = useState({
    client_id: '', pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0],
    scheduled_time: '09:00', notes: '', price: '',
  })
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
      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: newClientForm.name.trim(),
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
      alert(err?.message || 'Failed to create client')
    } finally {
      setNewClientSaving(false)
    }
  }

  async function fetchData() {
    if (!business?.id) return
    setLoading(true)
    const { data } = await supabase.from('jobs')
      .select('*, clients(name, email, phone), pools(address, latitude, longitude)')
      .eq('business_id', business.id)
      .is('recurring_profile_id', null)
      .order('created_at', { ascending: false })
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!business?.id) return
    fetchData()

    const channel = supabase.channel(`work-orders-${business.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `business_id=eq.${business.id}` }, () => fetchData())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [business?.id])

  // Fetch clients when modal opens
  useEffect(() => {
    if (!jobModalOpen || !business?.id || clients.length > 0) return
    supabase.from('clients').select('id, name, address').eq('business_id', business.id).order('name')
      .then(({ data }) => setClients(data || []))
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
      scheduled_time: '09:00', notes: '', price: '',
    })
    setShowNewPool(false)
    setNewPoolForm(emptyPool)
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
      alert(err?.message || 'Failed to create pool')
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
      const { data, error } = await supabase.from('jobs').insert({
        business_id: business.id,
        client_id: jobForm.client_id,
        pool_id: jobForm.pool_id || null,
        title: jobForm.title.trim(),
        status: 'scheduled',
        scheduled_date: jobForm.scheduled_date || null,
        scheduled_time: jobForm.scheduled_time || null,
        price: jobForm.price ? Number(jobForm.price) : null,
        notes: jobForm.notes.trim() || null,
      }).select('*, clients(name), pools(address)').single()
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

  const filteredJobs = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  // Header action
  const headerAction = (
    <button
      onClick={() => setJobModalOpen(true)}
      className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
    >
      <svg className="w-6 h-6 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  )

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Work Orders" right={headerAction} />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title="Work Orders" right={headerAction} />
      <PageWrapper width="wide">
        {/* Subtitle on desktop */}
        <p className="hidden md:block text-sm text-gray-500 -mt-2 mb-4">One-off repairs, call-outs & extra work</p>

        {/* Action buttons — stacked mobile, side by side desktop */}
        <div className="mb-4 flex flex-col gap-2 md:flex-row">
          <button onClick={() => setJobModalOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-brand text-white shadow-md shadow-pool-500/20 text-sm font-semibold hover:shadow-lg active:scale-[0.98] transition-all min-h-tap">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Work Order
          </button>
          <button onClick={() => navigate('/quotes/new')}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-50 active:scale-[0.98] transition-all min-h-tap">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Quick Quote
          </button>
        </div>

        {/* Status filter — wraps on mobile, no horizontal scroll */}
        <div className="flex flex-wrap gap-1.5 pb-3">
          {JOB_STATUSES.map(status => (
            <button key={status} onClick={() => setStatusFilter(status)}
              className={cn('px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 whitespace-nowrap',
                statusFilter === status ? 'bg-gradient-brand text-white shadow-sm shadow-pool-500/20'
                  : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
              {status === 'all' ? `All (${jobs.length})` : `${JOB_STATUS_LABEL[status]} (${jobs.filter(j => j.status === status).length})`}
            </button>
          ))}
        </div>

        {filteredJobs.length === 0 ? (
          <EmptyState
            icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
            title="No work orders"
            description="Create a work order to track one-off repairs and extra work"
          />
        ) : (
          <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
            {filteredJobs.map(job => (
              <JobListCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
            ))}
          </div>
        )}

        {/* FAB */}
        <button onClick={() => setJobModalOpen(true)}
          className="md:hidden fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </PageWrapper>

      {/* Job Detail Modal */}
      <StopDetailModal
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        stop={selectedJob ? jobToStop(selectedJob) : null}
        stopNumber={1}
        onUpdated={() => { fetchData(); setSelectedJob(null) }}
      />

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
                className="mt-1.5 text-xs font-medium text-pool-600 hover:text-pool-700">
                + Add new client
              </button>
            </div>
          ) : (
            <div
              className="space-y-3 p-3 rounded-lg border border-pool-200 bg-pool-50/40 animate-fade-in"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateClientInline() } }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Client</span>
                <button type="button"
                  onClick={() => { setShowNewClient(false); setNewClientForm({ name: '', email: '', phone: '', address: '', notes: '' }) }}
                  className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
                  className="mt-1.5 text-xs font-medium text-pool-600 hover:text-pool-700">
                  + Add new pool
                </button>
              ) : (
                <div
                  className="mt-2 space-y-4 p-3 rounded-lg border border-pool-200 bg-pool-50/40 animate-fade-in"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault() } }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-pool-700 uppercase tracking-wide">New Pool</span>
                    <button type="button"
                      onClick={() => { setShowNewPool(false); setNewPoolForm(emptyPool) }}
                      className="text-gray-400 hover:text-gray-600">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
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

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            <p className="text-xs text-gray-500">
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

// ─── Rich job list card (with date badge + icons) ──────────
function JobListCard({ job, onClick }) {
  const statusVariant = JOB_STATUS_BADGE[job.status] || 'default'
  const statusLabel = JOB_STATUS_LABEL[job.status] || 'Scheduled'

  // Format date for badge: "10 Apr"
  const dateBadge = (() => {
    if (!job.scheduled_date) return null
    const d = new Date(job.scheduled_date + 'T00:00:00')
    if (isNaN(d.getTime())) return null
    const day = d.getDate()
    const month = d.toLocaleDateString('en-AU', { month: 'short' })
    return { day, month }
  })()

  // Format time: "10:03 pm"
  const timeDisplay = (() => {
    if (!job.scheduled_time) return null
    const [h, m] = job.scheduled_time.split(':').map(Number)
    const d = new Date()
    d.setHours(h || 0, m || 0, 0, 0)
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  })()

  const duration = job.estimated_duration_minutes || 60

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-card hover:shadow-card-hover active:scale-[0.99] transition-all overflow-hidden flex"
    >
      {/* Left date badge */}
      <div className={`flex flex-col items-center justify-center px-4 py-3 shrink-0 w-[72px] ${dateBadge ? 'bg-gradient-brand text-white' : 'bg-gray-100 text-gray-400'}`}>
        <svg className="w-5 h-5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {dateBadge ? (
          <span className="text-xs font-bold leading-tight">{dateBadge.day} {dateBadge.month}</span>
        ) : (
          <span className="text-[10px] font-semibold">Not scheduled</span>
        )}
      </div>

      {/* Right content */}
      <div className="flex-1 min-w-0 p-3.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="font-bold text-gray-900 truncate">{job.title || 'Job'}</h3>
          <Badge variant={statusVariant} className="shrink-0 text-[10px]">{statusLabel}</Badge>
        </div>

        {/* Client */}
        {job.clients?.name && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="truncate">{job.clients.name}</span>
          </div>
        )}

        {/* Address */}
        {job.pools?.address && (
          <div className="flex items-center gap-1.5 text-xs text-pool-600 mb-1">
            <svg className="w-3.5 h-3.5 text-pool-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="truncate">{job.pools.address}</span>
          </div>
        )}

        {/* Time · duration */}
        {timeDisplay && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{timeDisplay}</span>
            <span className="text-gray-300">·</span>
            <span>{duration}m</span>
          </div>
        )}
      </div>
    </button>
  )
}
