import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { Select, TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
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

export default function Jobs() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  // Create job modal
  const [jobModalOpen, setJobModalOpen] = useState(false)
  const [clients, setClients] = useState([])
  const [clientPools, setClientPools] = useState([])
  const [jobForm, setJobForm] = useState({
    client_id: '', pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0],
    scheduled_time: '', notes: '', price: '',
    is_recurring: false, recurrence_rule: 'weekly', custom_interval_days: '', preferred_day_of_week: '',
  })
  const [jobSaving, setJobSaving] = useState(false)

  useEffect(() => {
    if (!business?.id) return
    async function fetchData() {
      setLoading(true)
      const [jobsRes, quotesRes] = await Promise.all([
        supabase.from('jobs').select('*, clients(name), pools(address)')
          .eq('business_id', business.id)
          .order('scheduled_at', { ascending: false }),
        supabase.from('quotes').select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('status', 'sent'),
      ])
      setJobs(jobsRes.data || [])
      setQuotes({ pending: quotesRes.count || 0 })
      setLoading(false)
    }
    fetchData()
  }, [business?.id])

  // Fetch clients when modal opens
  useEffect(() => {
    if (!jobModalOpen || !business?.id || clients.length > 0) return
    supabase.from('clients').select('id, name').eq('business_id', business.id).order('name')
      .then(({ data }) => setClients(data || []))
  }, [jobModalOpen, business?.id])

  // Fetch pools when client changes
  useEffect(() => {
    if (!jobForm.client_id) { setClientPools([]); return }
    supabase.from('pools').select('id, address').eq('client_id', jobForm.client_id)
      .then(({ data }) => setClientPools(data || []))
  }, [jobForm.client_id])

  const resetJobForm = () => setJobForm({
    client_id: '', pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0],
    scheduled_time: '', notes: '', price: '',
    is_recurring: false, recurrence_rule: 'weekly', custom_interval_days: '', preferred_day_of_week: '',
  })

  async function handleJobSubmit(e) {
    e.preventDefault()
    if (!jobForm.client_id || !jobForm.title.trim()) return
    setJobSaving(true)
    try {
      // Create the job
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

      // Also create recurring profile if toggled
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

      setJobs(prev => [data, ...prev])
      setJobModalOpen(false)
      resetJobForm()
    } catch (err) {
      console.error('Error creating job:', err)
    } finally {
      setJobSaving(false)
    }
  }

  const filteredJobs = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  // Header action - quotes link
  const headerAction = (
    <button
      onClick={() => navigate('/quotes')}
      className="min-h-tap flex items-center gap-1.5 px-3 rounded-xl hover:bg-gray-100/80 transition-colors"
    >
      <span className="text-sm font-semibold text-pool-600">Quotes</span>
      {quotes.pending > 0 && (
        <span className="w-5 h-5 rounded-full bg-pool-500 text-white text-[10px] font-bold flex items-center justify-center">{quotes.pending}</span>
      )}
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
      <PageWrapper>
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

        {/* Status filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
          {JOB_STATUSES.map(status => (
            <button key={status} onClick={() => setStatusFilter(status)}
              className={cn('shrink-0 px-4 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all duration-200',
                statusFilter === status ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                  : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
              {status === 'all' ? `All (${jobs.length})` : `${JOB_STATUS_LABEL[status]} (${jobs.filter(j => j.status === status).length})`}
            </button>
          ))}
        </div>

        {filteredJobs.length === 0 ? (
          <EmptyState
            icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
            title="No jobs found"
            description={statusFilter !== 'all' ? 'Try a different filter' : 'Jobs appear when quotes are accepted or created manually'}
          />
        ) : (
          <div className="space-y-2.5">
            {filteredJobs.map(job => (
              <Card key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-semibold text-gray-900 truncate flex-1">{job.clients?.name}</p>
                  <Badge variant={JOB_STATUS_BADGE[job.status]} className="ml-2 shrink-0">
                    {JOB_STATUS_LABEL[job.status]}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 truncate">{job.pools?.address || job.title}</p>
                {job.scheduled_at && <p className="text-xs text-gray-400 mt-1.5">{formatDate(job.scheduled_at)}</p>}
              </Card>
            ))}
          </div>
        )}

        {/* FAB - Create Job */}
        <button onClick={() => setJobModalOpen(true)}
          className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </PageWrapper>

      {/* Create Job Modal */}
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title="Create Job">
        <form onSubmit={handleJobSubmit} className="space-y-4">
          <Select
            label="Client"
            value={jobForm.client_id}
            onChange={e => setJobForm(prev => ({ ...prev, client_id: e.target.value, pool_id: '' }))}
            options={[{ value: '', label: 'Select client...' }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
            required
          />
          {clientPools.length > 0 && (
            <Select
              label="Pool"
              value={jobForm.pool_id}
              onChange={e => setJobForm(prev => ({ ...prev, pool_id: e.target.value }))}
              options={[{ value: '', label: 'No specific pool' }, ...clientPools.map(p => ({ value: p.id, label: p.address }))]}
            />
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
