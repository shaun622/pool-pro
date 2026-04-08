import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'

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

const JOB_STATUSES = ['all', 'scheduled', 'in_progress', 'on_hold', 'completed']

// ─── PIPELINE STAGES ──────────────────────────────
const PIPELINE_STAGES = [
  { key: 'draft', label: 'Draft', color: 'bg-gray-400', lightBg: 'bg-gray-50', textColor: 'text-gray-600', badgeVariant: 'default' },
  { key: 'sent', label: 'Sent', color: 'bg-blue-500', lightBg: 'bg-blue-50', textColor: 'text-blue-700', badgeVariant: 'primary' },
  { key: 'viewed', label: 'Viewed', color: 'bg-cyan-500', lightBg: 'bg-cyan-50', textColor: 'text-cyan-700', badgeVariant: 'chlorine' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-amber-500', lightBg: 'bg-amber-50', textColor: 'text-amber-700', badgeVariant: 'warning' },
  { key: 'accepted', label: 'Accepted', color: 'bg-emerald-500', lightBg: 'bg-emerald-50', textColor: 'text-emerald-700', badgeVariant: 'success' },
  { key: 'converted', label: 'Converted', color: 'bg-green-600', lightBg: 'bg-green-50', textColor: 'text-green-700', badgeVariant: 'success' },
  { key: 'declined', label: 'Declined', color: 'bg-red-500', lightBg: 'bg-red-50', textColor: 'text-red-700', badgeVariant: 'danger' },
]

function getQuoteStage(quote) {
  if (quote.pipeline_stage && quote.pipeline_stage !== 'draft') return quote.pipeline_stage
  if (quote.status === 'accepted') return 'accepted'
  if (quote.status === 'declined') return 'declined'
  if (quote.status === 'sent') return quote.viewed_at ? 'viewed' : 'sent'
  return 'draft'
}

// ─── JOBS TAB ──────────────────────────────────────
function JobsTab({ jobs, loading }) {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('all')

  const filteredJobs = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  if (loading) return <LoadingSpinner />

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
        {JOB_STATUSES.map(status => (
          <button key={status} onClick={() => setStatusFilter(status)}
            className={cn('shrink-0 px-4 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all duration-200',
              statusFilter === status ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
            {status === 'all' ? 'All' : JOB_STATUS_LABEL[status]}
          </button>
        ))}
      </div>

      {filteredJobs.length === 0 ? (
        <EmptyState
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
          title="No jobs found"
          description={statusFilter !== 'all' ? 'Try a different filter' : 'Jobs will appear here once created'}
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
    </>
  )
}

// ─── QUOTES TAB ────────────────────────────────────
function QuotesTab({ quotes, loading }) {
  const navigate = useNavigate()

  if (loading) return <LoadingSpinner />

  return (
    <>
      {quotes.length === 0 ? (
        <EmptyState
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
          title="No quotes yet"
          description="Create your first quote to get started"
          action="Create Quote"
          onAction={() => navigate('/quotes/new')}
        />
      ) : (
        <div className="space-y-2.5">
          {quotes.map(quote => (
            <Card key={quote.id} onClick={() => navigate(`/quotes/${quote.id}`)}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="font-semibold text-gray-900 truncate flex-1">{quote.clients?.name}</p>
                <Badge variant={QUOTE_STATUS_BADGE[quote.status]} className="ml-2 shrink-0">
                  {QUOTE_STATUS_LABEL[quote.status]}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-gray-700">{formatCurrency(quote.total)}</p>
            </Card>
          ))}
        </div>
      )}

      <button onClick={() => navigate('/quotes/new')}
        className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  )
}

// ─── PIPELINE TAB ──────────────────────────────────
function PipelineTab({ quotes, loading }) {
  const navigate = useNavigate()

  if (loading) return <LoadingSpinner />

  // Group quotes by stage
  const grouped = {}
  PIPELINE_STAGES.forEach(s => { grouped[s.key] = [] })
  quotes.forEach(q => {
    const stage = getQuoteStage(q)
    if (grouped[stage]) grouped[stage].push(q)
    else grouped.draft.push(q)
  })

  // Total pipeline value (exclude declined)
  const totalValue = quotes
    .filter(q => getQuoteStage(q) !== 'declined')
    .reduce((sum, q) => {
      const items = q.line_items || []
      return sum + items.reduce((s, item) => s + (item.amount || item.quantity * item.unit_price || 0), 0)
    }, 0)

  return (
    <>
      {/* Pipeline Summary */}
      <Card className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Pipeline Value</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(totalValue)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Quotes</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{quotes.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-4 pt-3 border-t overflow-x-auto scrollbar-hide">
          {PIPELINE_STAGES.map(stage => (
            <div key={stage.key}
              className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap',
                grouped[stage.key].length > 0 ? 'bg-gray-50 text-gray-700' : 'text-gray-300')}>
              <div className={cn('w-1.5 h-1.5 rounded-full', stage.color)} />
              {stage.label}: {grouped[stage.key].length}
            </div>
          ))}
        </div>
      </Card>

      {/* Kanban columns */}
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide snap-x snap-mandatory">
        {PIPELINE_STAGES.map(stage => {
          const stageQuotes = grouped[stage.key]
          const stageValue = stageQuotes.reduce((sum, q) => {
            const items = q.line_items || []
            return sum + items.reduce((s, item) => s + (item.amount || item.quantity * item.unit_price || 0), 0)
          }, 0)

          return (
            <div key={stage.key} className="shrink-0 w-[260px] snap-center">
              {/* Column header */}
              <div className={cn('flex items-center gap-2 px-3 py-2.5 rounded-t-xl', stage.lightBg)}>
                <div className={cn('w-2.5 h-2.5 rounded-full', stage.color)} />
                <h3 className={cn('text-sm font-bold', stage.textColor)}>{stage.label}</h3>
                <span className="text-xs text-gray-400 ml-auto">{stageQuotes.length}</span>
              </div>

              {/* Column body */}
              <div className="bg-gray-50/50 border border-gray-100 border-t-0 rounded-b-xl p-2 min-h-[160px] space-y-2">
                {stageQuotes.length > 0 && (
                  <p className="text-[11px] text-gray-400 px-1">{formatCurrency(stageValue)}</p>
                )}
                {stageQuotes.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center mt-2">
                    <p className="text-xs text-gray-300">No quotes</p>
                  </div>
                ) : (
                  stageQuotes.map(quote => (
                    <div key={quote.id} onClick={() => navigate(`/quotes/${quote.id}`)}
                      className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98]">
                      <p className="text-sm font-semibold text-gray-900 truncate">{quote.clients?.name || 'Unknown'}</p>
                      <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(
                        (quote.line_items || []).reduce((s, i) => s + (i.amount || i.quantity * i.unit_price || 0), 0)
                      )}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(quote.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-center text-[11px] text-gray-300 mt-2">← Swipe to see all stages →</p>
    </>
  )
}

// ─── SHARED ────────────────────────────────────────
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ─── MAIN COMPONENT ────────────────────────────────
export default function Jobs() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('jobs')
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!business?.id) return
    async function fetchData() {
      setLoading(true)
      const [jobsRes, quotesRes] = await Promise.all([
        supabase.from('jobs').select('*, clients(name), pools(address)')
          .eq('business_id', business.id)
          .order('scheduled_at', { ascending: false }),
        supabase.from('quotes').select('*, clients(name)')
          .eq('business_id', business.id)
          .order('created_at', { ascending: false }),
      ])
      setJobs(jobsRes.data || [])
      setQuotes(quotesRes.data || [])
      setLoading(false)
    }
    fetchData()
  }, [business?.id])

  if (bizLoading) {
    return (
      <>
        <Header title="Jobs" />
        <PageWrapper><LoadingSpinner /></PageWrapper>
      </>
    )
  }

  const TABS = [
    { key: 'jobs', label: 'Jobs' },
    { key: 'quotes', label: 'Quotes' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'recurring', label: 'Recurring' },
  ]

  return (
    <>
      <Header title={
        activeTab === 'jobs' ? 'Jobs' :
        activeTab === 'quotes' ? 'Quotes' :
        activeTab === 'pipeline' ? 'Pipeline' : 'Jobs'
      } />
      <PageWrapper>
        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={cn(
                'flex-1 py-2.5 text-xs font-semibold text-center rounded-lg min-h-tap transition-all duration-200',
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => tab.key === 'recurring' ? navigate('/recurring-jobs') : setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'jobs' && <JobsTab jobs={jobs} loading={loading} />}
        {activeTab === 'quotes' && <QuotesTab quotes={quotes} loading={loading} />}
        {activeTab === 'pipeline' && <PipelineTab quotes={quotes} loading={loading} />}
      </PageWrapper>
    </>
  )
}
