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
import { formatDate, daysOverdue, getOverdueStatus, cn } from '../lib/utils'

const POOL_TYPE_BADGE = {
  chlorine: 'chlorine',
  salt: 'salt',
  mineral: 'mineral',
  freshwater: 'freshwater',
}

export default function Route() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const endOfToday = new Date(today)
  endOfToday.setHours(23, 59, 59, 999)

  useEffect(() => {
    if (!business?.id) return

    async function fetchRoutePools() {
      setLoading(true)
      const { data, error } = await supabase
        .from('pools')
        .select('*, clients(name, email)')
        .eq('business_id', business.id)
        .lte('next_due_at', endOfToday.toISOString())
        .order('route_order', { ascending: true })

      if (error) console.error('Error fetching route pools:', error)
      setPools(data || [])
      setLoading(false)
    }

    fetchRoutePools()
  }, [business?.id])

  if (bizLoading || loading) {
    return (
      <>
        <Header title="Today's Route" />
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
      <Header title="Today's Route" />
      <PageWrapper>
        {/* Date header */}
        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-900">
            {formatDate(today)}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {pools.length} pool{pools.length !== 1 ? 's' : ''} scheduled
          </p>
        </div>

        {pools.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            title="No pools scheduled"
            description="All pools are up to date. Enjoy the break!"
          />
        ) : (
          <div className="space-y-3">
            {pools.map((pool) => {
              const days = daysOverdue(pool.next_due_at)
              const isOverdue = days > 0
              const status = getOverdueStatus(pool.next_due_at)

              return (
                <Card key={pool.id} className="p-4">
                  <div
                    className="flex items-start gap-3 min-h-tap cursor-pointer"
                    onClick={() => navigate(`/pools/${pool.id}`)}
                  >
                    {/* Overdue indicator dot */}
                    <div className="pt-1.5 shrink-0">
                      <div
                        className={cn(
                          'w-3 h-3 rounded-full',
                          isOverdue ? 'bg-red-500' : 'bg-green-500'
                        )}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-gray-900 truncate">
                          {pool.clients?.name}
                        </p>
                        <Badge variant={POOL_TYPE_BADGE[pool.pool_type] || 'default'} className="shrink-0">
                          {pool.pool_type}
                        </Badge>
                      </div>

                      <p className="text-sm text-gray-500 truncate">
                        {pool.address}
                      </p>

                      <div className="flex items-center gap-3 mt-1.5">
                        {pool.last_serviced_at && (
                          <span className="text-xs text-gray-400">
                            Last: {formatDate(pool.last_serviced_at)}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="text-xs font-medium text-red-600">
                            {days} day{days !== 1 ? 's' : ''} overdue
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick action */}
                  <div className="mt-3 pl-6">
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
