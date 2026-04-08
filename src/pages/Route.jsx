import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, daysOverdue, getOverdueStatus, FREQUENCY_LABELS, cn } from '../lib/utils'

export default function Route() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [pools, setPools] = useState([])
  const [allPools, setAllPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('due') // 'due' | 'all'

  useEffect(() => {
    if (!business?.id) return

    async function fetchPools() {
      setLoading(true)

      const endOfToday = new Date()
      endOfToday.setHours(23, 59, 59, 999)

      const [dueRes, allRes] = await Promise.all([
        supabase
          .from('pools')
          .select('*, clients(name, email, phone)')
          .eq('business_id', business.id)
          .lte('next_due_at', endOfToday.toISOString())
          .order('route_order', { ascending: true }),
        supabase
          .from('pools')
          .select('*, clients(name, email, phone)')
          .eq('business_id', business.id)
          .order('route_order', { ascending: true }),
      ])

      if (dueRes.error) console.error('Error fetching route pools:', dueRes.error)
      if (allRes.error) console.error('Error fetching all pools:', allRes.error)

      setPools(dueRes.data || [])
      setAllPools(allRes.data || [])
      setLoading(false)
    }

    fetchPools()
  }, [business?.id])

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Route" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  const displayPools = filter === 'due' ? pools : allPools

  return (
    <>
      <Header title="Route" />
      <PageWrapper>
        {/* Date header */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-900">{formatDate(new Date())}</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {pools.length} pool{pools.length !== 1 ? 's' : ''} due today
          </p>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-5">
          {[
            { key: 'due', label: `Due Today (${pools.length})` },
            { key: 'all', label: `All Pools (${allPools.length})` },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold min-h-tap transition-all duration-200',
                filter === f.key
                  ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                  : 'bg-white text-gray-600 border border-gray-200 shadow-card hover:shadow-card-hover'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {displayPools.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            title={filter === 'due' ? 'No pools due today' : 'No pools yet'}
            description={filter === 'due' ? 'All pools are up to date!' : 'Add clients and pools to get started.'}
            action={filter === 'all' ? 'Add Client' : undefined}
            onAction={filter === 'all' ? () => navigate('/clients') : undefined}
          />
        ) : (
          <div className="space-y-3">
            {displayPools.map((pool, idx) => {
              const days = daysOverdue(pool.next_due_at)
              const isOverdue = days > 0
              const isDueToday = pool.next_due_at && !isOverdue && new Date(pool.next_due_at) <= new Date(new Date().setHours(23,59,59,999))

              return (
                <Card key={pool.id} className="overflow-hidden animate-slide-up" style={{ animationDelay: `${idx * 50}ms` }}>
                  <div
                    className="flex items-start gap-3.5 cursor-pointer"
                    onClick={() => navigate(`/pools/${pool.id}`)}
                  >
                    {/* Status indicator */}
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                      isOverdue ? 'bg-red-50' : isDueToday ? 'bg-amber-50' : 'bg-emerald-50'
                    )}>
                      <div className={cn(
                        'w-3 h-3 rounded-full',
                        isOverdue ? 'bg-red-500' : isDueToday ? 'bg-amber-500' : 'bg-emerald-500'
                      )} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-gray-900 truncate">{pool.clients?.name}</p>
                        <Badge variant={pool.type || 'default'} className="shrink-0">{pool.type}</Badge>
                      </div>

                      <p className="text-sm text-gray-500 truncate">{pool.address}</p>

                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {pool.schedule_frequency && (
                          <span className="text-xs text-gray-400">{FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}</span>
                        )}
                        {pool.last_serviced_at && (
                          <span className="text-xs text-gray-400">Last: {formatDate(pool.last_serviced_at)}</span>
                        )}
                        {isOverdue && (
                          <span className="text-xs font-semibold text-red-500">{days}d overdue</span>
                        )}
                        {!pool.last_serviced_at && !isOverdue && (
                          <span className="text-xs text-gray-400">Never serviced</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Service button */}
                  <div className="mt-3.5 pt-3 border-t border-gray-100">
                    <Button
                      variant="primary"
                      className="w-full min-h-tap"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/pools/${pool.id}/service`)
                      }}
                    >
                      Start Service
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </PageWrapper>
    </>
  )
}
