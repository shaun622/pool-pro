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

export default function Jobs() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('jobs')
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!business?.id) return

    async function fetchData() {
      setLoading(true)
      const [jobsRes, quotesRes] = await Promise.all([
        supabase
          .from('jobs')
          .select('*, clients(name), pools(address)')
          .eq('business_id', business.id)
          .order('scheduled_at', { ascending: false }),
        supabase
          .from('quotes')
          .select('*, clients(name)')
          .eq('business_id', business.id)
          .order('created_at', { ascending: false }),
      ])

      if (jobsRes.error) console.error('Error fetching jobs:', jobsRes.error)
      if (quotesRes.error) console.error('Error fetching quotes:', quotesRes.error)

      setJobs(jobsRes.data || [])
      setQuotes(quotesRes.data || [])
      setLoading(false)
    }

    fetchData()
  }, [business?.id])

  const filteredJobs = statusFilter === 'all'
    ? jobs
    : jobs.filter((j) => j.status === statusFilter)

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Jobs & Quotes" />
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
      <Header title="Jobs & Quotes" />
      <PageWrapper>
        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          {['jobs', 'quotes'].map(tab => (
            <button
              key={tab}
              className={cn(
                'flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all duration-200',
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-card'
                  : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'jobs' ? 'Jobs' : 'Quotes'}
            </button>
          ))}
        </div>

        {/* Jobs tab */}
        {activeTab === 'jobs' && (
          <>
            {/* Status filter chips */}
            <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
              {JOB_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'shrink-0 px-4 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all duration-200',
                    statusFilter === status
                      ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                      : 'bg-white text-gray-600 border border-gray-200 shadow-card'
                  )}
                >
                  {status === 'all' ? 'All' : JOB_STATUS_LABEL[status]}
                </button>
              ))}
            </div>

            {filteredJobs.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                }
                title="No jobs found"
                description={statusFilter !== 'all' ? 'Try a different filter' : 'Jobs will appear here once created'}
              />
            ) : (
              <div className="space-y-2.5">
                {filteredJobs.map((job) => (
                  <Card key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="font-semibold text-gray-900 truncate flex-1">{job.clients?.name}</p>
                      <Badge variant={JOB_STATUS_BADGE[job.status]} className="ml-2 shrink-0">
                        {JOB_STATUS_LABEL[job.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 truncate">{job.pools?.address || job.title}</p>
                    {job.scheduled_at && (
                      <p className="text-xs text-gray-400 mt-1.5">{formatDate(job.scheduled_at)}</p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Quotes tab */}
        {activeTab === 'quotes' && (
          <>
            {quotes.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                }
                title="No quotes yet"
                description="Create your first quote to get started"
                action="Create Quote"
                onAction={() => navigate('/quotes/new')}
              />
            ) : (
              <div className="space-y-2.5">
                {quotes.map((quote) => (
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
          </>
        )}

        {/* FAB for new quote */}
        {activeTab === 'quotes' && (
          <button
            onClick={() => navigate('/quotes/new')}
            className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20"
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </PageWrapper>
    </>
  )
}
