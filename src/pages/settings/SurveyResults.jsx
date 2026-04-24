import { useState, useEffect } from 'react'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { formatDate, cn } from '../../lib/utils'

function StarDisplay({ rating, size = 'sm' }) {
  const sizeClass = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <svg
          key={star}
          className={cn(sizeClass, star <= rating ? 'text-amber-400' : 'text-gray-200')}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  )
}

function RatingBar({ star, count, total }) {
  const percent = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-500 dark:text-gray-400 w-4 text-right">{star}</span>
      <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      <div className="flex-1 h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm text-gray-500 dark:text-gray-400 w-8 text-right">{count}</span>
    </div>
  )
}

export default function SurveyResults() {
  const { business } = useBusiness()
  const [surveys, setSurveys] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('all')

  useEffect(() => {
    if (business?.id) fetchSurveys()
  }, [business?.id])

  async function fetchSurveys() {
    setLoading(true)
    const { data, error } = await supabase
      .from('surveys')
      .select('*, clients(first_name, last_name)')
      .eq('business_id', business.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (error) console.error('Error fetching surveys:', error)
    setSurveys(data || [])
    setLoading(false)
  }

  // Filter by date range
  const filteredSurveys = surveys.filter(s => {
    if (dateFilter === 'all') return true
    const submitted = new Date(s.submitted_at)
    const now = new Date()
    if (dateFilter === '7d') return (now - submitted) / 86400000 <= 7
    if (dateFilter === '30d') return (now - submitted) / 86400000 <= 30
    if (dateFilter === '90d') return (now - submitted) / 86400000 <= 90
    return true
  })

  // Calculate stats
  const totalResponses = filteredSurveys.length
  const avgRating = totalResponses > 0
    ? (filteredSurveys.reduce((sum, s) => sum + s.rating, 0) / totalResponses).toFixed(1)
    : '0.0'
  const distribution = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: filteredSurveys.filter(s => s.rating === star).length,
  }))

  if (loading) {
    return (
      <>
        <Header title="Survey Results" backTo="/settings" />
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
      <Header title="Survey Results" backTo="/settings" />
      <PageWrapper>
        {surveys.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            }
            title="No survey responses yet"
            description="Survey results will appear here once clients submit feedback"
          />
        ) : (
          <>
            {/* Date Filter */}
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-5">
              {[
                { value: 'all', label: 'All Time' },
                { value: '7d', label: '7 Days' },
                { value: '30d', label: '30 Days' },
                { value: '90d', label: '90 Days' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={cn(
                    'flex-1 py-2 text-xs font-semibold text-center rounded-lg min-h-tap transition-all',
                    dateFilter === opt.value ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-card' : 'text-gray-500 dark:text-gray-400'
                  )}
                  onClick={() => setDateFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Average Rating */}
            <Card className="mb-4">
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-gray-900 dark:text-gray-100">{avgRating}</div>
                  <StarDisplay rating={Math.round(Number(avgRating))} size="lg" />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{totalResponses} response{totalResponses !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  {distribution.map(d => (
                    <RatingBar key={d.star} star={d.star} count={d.count} total={totalResponses} />
                  ))}
                </div>
              </div>
            </Card>

            {/* Recent Reviews */}
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5">
              Recent Reviews
            </h3>
            <div className="space-y-2.5">
              {filteredSurveys.map(survey => (
                <Card key={survey.id}>
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {survey.clients?.first_name} {survey.clients?.last_name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{formatDate(survey.submitted_at)}</p>
                    </div>
                    <StarDisplay rating={survey.rating} />
                  </div>
                  {survey.comment && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                      {survey.comment}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </PageWrapper>
    </>
  )
}
