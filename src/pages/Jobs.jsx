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

const JOB_STATUSES = ['all', 'scheduled', 'in_progress', 'on_hold', 'completed']

export default function Jobs() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

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

  const filteredJobs = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  // Header "+" button
  const headerAction = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => navigate('/quotes')}
        className="min-h-tap flex items-center gap-1.5 px-3 rounded-xl hover:bg-gray-100/80 transition-colors"
      >
        <span className="text-sm font-semibold text-pool-600">Quotes</span>
        {quotes.pending > 0 && (
          <span className="w-5 h-5 rounded-full bg-pool-500 text-white text-[10px] font-bold flex items-center justify-center">{quotes.pending}</span>
        )}
      </button>
      <button
        onClick={() => navigate('/quotes/new')}
        className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
      >
        <svg className="w-6 h-6 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
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
        {/* Quick links */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => navigate('/recurring-jobs')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-card text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Recurring
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

        {/* FAB - Create Quote */}
        <button onClick={() => navigate('/quotes/new')}
          className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </PageWrapper>
    </>
  )
}
