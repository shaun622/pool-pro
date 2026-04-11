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
import { formatDate, formatCurrency, cn } from '../lib/utils'

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

// Quote pipeline
const QUOTE_STATUS_BADGE = {
  draft: 'default',
  sent: 'primary',
  accepted: 'success',
  declined: 'danger',
  expired: 'default',
}

const QUOTE_STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
}

const PIPELINE_STAGES = [
  { key: 'draft', label: 'Draft', color: 'bg-gray-400', textColor: 'text-gray-600' },
  { key: 'sent', label: 'Sent', color: 'bg-blue-500', textColor: 'text-blue-700' },
  { key: 'viewed', label: 'Viewed', color: 'bg-cyan-500', textColor: 'text-cyan-700' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-amber-500', textColor: 'text-amber-700' },
  { key: 'accepted', label: 'Accepted', color: 'bg-emerald-500', textColor: 'text-emerald-700' },
  { key: 'converted', label: 'Converted', color: 'bg-green-600', textColor: 'text-green-700' },
  { key: 'declined', label: 'Declined', color: 'bg-red-500', textColor: 'text-red-700' },
]

function getQuoteStage(quote) {
  if (quote.pipeline_stage && quote.pipeline_stage !== 'draft') return quote.pipeline_stage
  if (quote.status === 'accepted') return 'accepted'
  if (quote.status === 'declined') return 'declined'
  if (quote.status === 'sent') return quote.viewed_at ? 'viewed' : 'sent'
  return 'draft'
}

function getQuoteTotal(quote) {
  return (quote.line_items || []).reduce((s, i) => s + (i.amount || i.quantity * i.unit_price || 0), 0)
}

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

export default function Jobs() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [tab, setTab] = useState('jobs') // 'jobs' | 'quotes'
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
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
    is_recurring: false, recurrence_rule: 'weekly', custom_interval_days: '', preferred_day_of_week: '',
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
    const [jobsRes, quotesRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name, email, phone), pools(address, latitude, longitude)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false }),
      supabase.from('quotes').select('*, clients(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false }),
    ])
    setJobs(jobsRes.data || [])
    setQuotes(quotesRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!business?.id) return
    fetchData()

    // Realtime subscriptions — auto-refresh on changes
    const channel = supabase.channel(`jobs-quotes-${business.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes', filter: `business_id=eq.${business.id}` }, () => fetchData())
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
      is_recurring: false, recurrence_rule: 'weekly', custom_interval_days: '', preferred_day_of_week: '',
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

      if (jobForm.is_recurring) {
        const intervals = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90, custom: Number(jobForm.custom_interval_days) || 7 }
        const days = intervals[jobForm.recurrence_rule] || 7
        const nextGen = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        await supabase.from('recurring_job_profiles').insert({
          business_id: business.id,
          client_id: jobForm.client_id,
          pool_id: jobForm.pool_id || null,
          title: jobForm.title.trim(),
          recurrence_rule: jobForm.recurrence_rule,
          custom_interval_days: jobForm.recurrence_rule === 'custom' ? Number(jobForm.custom_interval_days) || 7 : null,
          preferred_day_of_week: jobForm.preferred_day_of_week !== '' ? Number(jobForm.preferred_day_of_week) : null,
          preferred_time: jobForm.scheduled_time || null,
          price: jobForm.price ? Number(jobForm.price) : null,
          notes: jobForm.notes.trim() || null,
          next_generation_at: nextGen.toISOString(),
          last_generated_at: new Date().toISOString(),
        })
      }

      // Log activity
      await supabase.from('activity_feed').insert({
        business_id: business.id,
        type: 'job_created',
        title: `Job created: ${jobForm.title.trim()}`,
        description: data.clients?.name || '',
        link_to: `/jobs/${data.id}`,
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

  async function convertQuoteToJob(quote) {
    try {
      const items = quote.line_items || []
      const recurringItems = items.filter(li => li.description && li.recurring)
      const jobTitle = recurringItems.length > 0
        ? recurringItems[0].description
        : items.find(li => li.description)?.description || 'Job from quote'
      const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0)

      const { data: job, error } = await supabase.from('jobs').insert({
        business_id: business.id,
        client_id: quote.client_id,
        pool_id: quote.pool_id || null,
        quote_id: quote.id,
        title: jobTitle,
        status: 'scheduled',
        scheduled_date: new Date().toISOString().split('T')[0],
        price: total || null,
      }).select('*, clients(name), pools(address)').single()
      if (error) throw error

      // Create recurring profiles for recurring line items
      for (const item of recurringItems) {
        const intervals = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }
        const days = intervals[item.recurring] || 30
        const nextGen = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        await supabase.from('recurring_job_profiles').insert({
          business_id: business.id,
          client_id: quote.client_id,
          pool_id: quote.pool_id || null,
          title: item.description,
          recurrence_rule: item.recurring,
          price: item.unit_price ? Number(item.unit_price) * (item.quantity || 1) : null,
          next_generation_at: nextGen.toISOString(),
          last_generated_at: new Date().toISOString(),
        })
      }

      // Mark quote as converted
      await supabase.from('quotes').update({ status: 'accepted', pipeline_stage: 'converted' }).eq('id', quote.id)

      setJobs(prev => [job, ...prev])
      setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, status: 'accepted', pipeline_stage: 'converted' } : q))
      setTab('jobs')
    } catch (err) {
      console.error('Error converting quote to job:', err)
    }
  }

  const filteredJobs = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  // Quote pipeline data
  const grouped = {}
  PIPELINE_STAGES.forEach(s => { grouped[s.key] = [] })
  quotes.forEach(q => {
    const stage = getQuoteStage(q)
    if (grouped[stage]) grouped[stage].push(q)
    else grouped.draft.push(q)
  })

  const pendingQuotes = quotes.filter(q => q.status === 'sent').length
  const totalPipelineValue = quotes
    .filter(q => getQuoteStage(q) !== 'declined')
    .reduce((sum, q) => sum + getQuoteTotal(q), 0)

  const filteredQuotes = stageFilter === 'all' ? quotes : quotes.filter(q => getQuoteStage(q) === stageFilter)

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
        <Header title="Jobs" right={headerAction} />
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
      <Header title="Jobs" right={headerAction} />
      <PageWrapper width="wide">
        {/* Jobs / Quotes toggle */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          <button
            onClick={() => setTab('jobs')}
            className={cn('flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all text-center',
              tab === 'jobs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
            Jobs{jobs.length > 0 ? ` (${jobs.length})` : ''}
          </button>
          <button
            onClick={() => setTab('quotes')}
            className={cn('flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all text-center relative',
              tab === 'quotes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
            Quotes{quotes.length > 0 ? ` (${quotes.length})` : ''}
            {pendingQuotes > 0 && tab !== 'quotes' && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {pendingQuotes}
              </span>
            )}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setJobModalOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-brand text-white shadow-md shadow-pool-500/20 text-xs font-semibold hover:shadow-lg active:scale-[0.98] transition-all min-h-tap">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Job
          </button>
          <button onClick={() => navigate('/quotes/new')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-gray-200 shadow-card text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all min-h-tap">
            <svg className="w-4 h-4 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Create Quote
          </button>
        </div>

        {tab === 'jobs' ? (
          /* ─── JOBS TAB ─── */
          <>
            {/* Status filter pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide">
              {JOB_STATUSES.map(status => (
                <button key={status} onClick={() => setStatusFilter(status)}
                  className={cn('shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 whitespace-nowrap',
                    statusFilter === status ? 'bg-gradient-brand text-white shadow-sm shadow-pool-500/20'
                      : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
                  {status === 'all' ? `All (${jobs.length})` : `${JOB_STATUS_LABEL[status]} (${jobs.filter(j => j.status === status).length})`}
                </button>
              ))}
            </div>

            {filteredJobs.length === 0 ? (
              <EmptyState
                icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                title="No jobs found"
                description={statusFilter !== 'all' ? 'Try a different filter' : 'Create a job or send a quote to get started'}
              />
            ) : (
              <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
                {filteredJobs.map(job => (
                  <JobListCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ─── QUOTES TAB ─── */
          <>
            {/* Pipeline summary */}
            {quotes.length > 0 && (
              <Card className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Pipeline Value</p>
                    <p className="text-xl font-bold text-gray-900">{formatCurrency(totalPipelineValue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total</p>
                    <p className="text-xl font-bold text-gray-900">{quotes.length}</p>
                  </div>
                </div>
                {/* Mini stage indicators */}
                <div className="flex gap-1 pt-2 border-t border-gray-100">
                  {PIPELINE_STAGES.map(stage => (
                    <button key={stage.key} className="flex-1 text-center"
                      onClick={() => setStageFilter(stageFilter === stage.key ? 'all' : stage.key)}>
                      <div className={cn('w-2 h-2 rounded-full mx-auto mb-0.5', stage.color,
                        grouped[stage.key].length === 0 && 'opacity-20',
                        stageFilter === stage.key && 'ring-2 ring-offset-1 ring-pool-400')} />
                      <p className="text-[9px] font-bold text-gray-500">{grouped[stage.key].length}</p>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {/* Stage filter pills */}
            <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
              {[
                { key: 'all', label: `All (${quotes.length})` },
                ...PIPELINE_STAGES.filter(s => grouped[s.key].length > 0).map(s => ({
                  key: s.key, label: `${s.label} (${grouped[s.key].length})`
                }))
              ].map(f => (
                <button key={f.key} onClick={() => setStageFilter(f.key)}
                  className={cn('shrink-0 px-4 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all duration-200',
                    stageFilter === f.key ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                      : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
                  {f.label}
                </button>
              ))}
            </div>

            {filteredQuotes.length === 0 ? (
              <EmptyState
                icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                title="No quotes yet"
                description="Create your first quote to get started"
                action="Create Quote"
                onAction={() => navigate('/quotes/new')}
              />
            ) : (
              <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
                {filteredQuotes.map(quote => {
                  const stage = getQuoteStage(quote)
                  const stageDef = PIPELINE_STAGES.find(s => s.key === stage) || PIPELINE_STAGES[0]
                  return (
                    <Card key={quote.id} onClick={() => navigate(`/quotes/${quote.id}`)}>
                      <div className="flex items-center gap-3">
                        <div className={cn('w-2 h-full min-h-[40px] rounded-full shrink-0', stageDef.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="font-semibold text-gray-900 truncate">{quote.clients?.name}</p>
                            <Badge variant={QUOTE_STATUS_BADGE[quote.status]} className="ml-2 shrink-0 text-[10px]">
                              {QUOTE_STATUS_LABEL[quote.status]}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-gray-700">{formatCurrency(getQuoteTotal(quote))}</p>
                            <p className="text-xs text-gray-400">{formatDate(quote.created_at)}</p>
                          </div>
                        </div>
                      </div>
                      {/* Convert to Job button for accepted quotes */}
                      {quote.status === 'accepted' && stage !== 'converted' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); convertQuoteToJob(quote) }}
                          className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-brand text-white text-xs font-semibold shadow-sm active:scale-[0.98] transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Convert to Job
                        </button>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* FAB - Create Job */}
        <button onClick={() => tab === 'jobs' ? setJobModalOpen(true) : navigate('/quotes/new')}
          className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
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
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title="Create Job">
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

          {/* Recurring toggle */}
          <label className="flex items-center justify-between min-h-tap cursor-pointer">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Make this recurring</span>
            </div>
            <div className={cn('relative w-11 h-6 rounded-full transition-colors',
              jobForm.is_recurring ? 'bg-pool-500' : 'bg-gray-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                jobForm.is_recurring ? 'translate-x-[22px]' : 'translate-x-0.5')} />
              <input type="checkbox" className="sr-only"
                checked={jobForm.is_recurring}
                onChange={e => setJobForm(prev => ({ ...prev, is_recurring: e.target.checked }))} />
            </div>
          </label>

          {jobForm.is_recurring && (
            <div className="space-y-3 animate-fade-in">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Frequency"
                  value={jobForm.recurrence_rule}
                  onChange={e => setJobForm(prev => ({ ...prev, recurrence_rule: e.target.value }))}
                  options={RECURRENCE_OPTIONS}
                />
                {jobForm.recurrence_rule === 'custom' ? (
                  <Input
                    label="Interval (days)"
                    type="number"
                    value={jobForm.custom_interval_days}
                    onChange={e => setJobForm(prev => ({ ...prev, custom_interval_days: e.target.value }))}
                    placeholder="10"
                  />
                ) : (
                  <Select
                    label="Preferred Day"
                    value={jobForm.preferred_day_of_week}
                    onChange={e => setJobForm(prev => ({ ...prev, preferred_day_of_week: e.target.value }))}
                    options={DAY_OPTIONS}
                  />
                )}
              </div>
              <div className="bg-pool-50 border border-pool-200 rounded-lg p-2.5">
                <p className="text-xs text-pool-600">
                  <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Creates the first job now and auto-generates future jobs on this frequency.
                </p>
              </div>
            </div>
          )}

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
            <Button type="submit" className="flex-1" loading={jobSaving}>Create Job</Button>
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
      <div className="bg-gradient-brand text-white flex flex-col items-center justify-center px-4 py-3 shrink-0 w-[72px]">
        <svg className="w-5 h-5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {dateBadge ? (
          <>
            <span className="text-xs font-bold leading-tight">{dateBadge.day} {dateBadge.month}</span>
          </>
        ) : (
          <span className="text-[10px] font-semibold opacity-80">No date</span>
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
