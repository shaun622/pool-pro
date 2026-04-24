import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'

const STAGES = [
  { key: 'draft', label: 'Draft', color: 'bg-gray-400', badgeVariant: 'default' },
  { key: 'sent', label: 'Sent', color: 'bg-blue-500', badgeVariant: 'primary' },
  { key: 'viewed', label: 'Viewed', color: 'bg-cyan-500', badgeVariant: 'chlorine' },
  { key: 'follow_up', label: 'Follow Up', color: 'bg-amber-500', badgeVariant: 'warning' },
  { key: 'accepted', label: 'Accepted', color: 'bg-emerald-500', badgeVariant: 'success' },
  { key: 'converted', label: 'Converted', color: 'bg-green-600', badgeVariant: 'success' },
  { key: 'declined', label: 'Declined', color: 'bg-red-500', badgeVariant: 'danger' },
]

function PipelineCard({ quote, onClick }) {
  const total = (quote.line_items || []).reduce(
    (sum, item) => sum + (item.amount || item.quantity * item.unit_price || 0),
    0
  )

  return (
    <div
      onClick={onClick}
      className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-xl p-3 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98]"
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
        {quote.clients?.name || 'Unknown Client'}
      </p>
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-1">
        {formatCurrency(total)}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatDate(quote.created_at)}</p>
    </div>
  )
}

function StageColumn({ stage, quotes, onCardClick }) {
  const totalValue = quotes.reduce((sum, q) => {
    const items = q.line_items || []
    return sum + items.reduce((s, item) => s + (item.amount || item.quantity * item.unit_price || 0), 0)
  }, 0)

  return (
    <div className="flex-shrink-0 w-64">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', stage.color)} />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{stage.label}</span>
          <Badge variant={stage.badgeVariant} className="text-[10px]">
            {quotes.length}
          </Badge>
        </div>
      </div>

      {/* Value */}
      {quotes.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 px-1">{formatCurrency(totalValue)}</p>
      )}

      {/* Cards */}
      <div className="space-y-2 min-h-[80px]">
        {quotes.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">No quotes</p>
          </div>
        ) : (
          quotes.map(quote => (
            <PipelineCard
              key={quote.id}
              quote={quote}
              onClick={() => onCardClick(quote)}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default function Pipeline() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!business?.id) return
    fetchQuotes()
  }, [business?.id])

  async function fetchQuotes() {
    setLoading(true)
    const { data, error } = await supabase
      .from('quotes')
      .select('*, clients(name)')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching quotes:', error)
    setQuotes(data || [])
    setLoading(false)
  }

  function getStage(quote) {
    // Use pipeline_stage if set, otherwise infer from status
    if (quote.pipeline_stage && quote.pipeline_stage !== 'draft') {
      return quote.pipeline_stage
    }
    // Fallback: map old status to pipeline stage
    if (quote.status === 'accepted') return 'accepted'
    if (quote.status === 'declined') return 'declined'
    if (quote.status === 'sent') return quote.viewed_at ? 'viewed' : 'sent'
    return 'draft'
  }

  function handleCardClick(quote) {
    navigate(`/quotes/${quote.id}`)
  }

  // Group quotes by stage
  const grouped = {}
  STAGES.forEach(s => { grouped[s.key] = [] })
  quotes.forEach(q => {
    const stage = getStage(q)
    if (grouped[stage]) {
      grouped[stage].push(q)
    } else {
      grouped.draft.push(q)
    }
  })

  // Total pipeline value (exclude declined)
  const totalPipelineValue = quotes
    .filter(q => getStage(q) !== 'declined')
    .reduce((sum, q) => {
      const items = q.line_items || []
      return sum + items.reduce((s, item) => s + (item.amount || item.quantity * item.unit_price || 0), 0)
    }, 0)

  if (loading || bizLoading) {
    return (
      <>
        <Header title="Sales Pipeline" backTo="/work-orders" />
        <main className="max-w-full mx-auto pb-24 px-4 pt-4">
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header title="Sales Pipeline" backTo="/work-orders" />
      <main className="pb-24">
        {/* Pipeline Summary */}
        <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
          <Card className="mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">Pipeline Value</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{formatCurrency(totalPipelineValue)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">Total Quotes</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{quotes.length}</p>
              </div>
            </div>

            {/* Stage mini-summary */}
            <div className="flex items-center gap-1.5 mt-4 pt-3 border-t overflow-x-auto">
              {STAGES.map(stage => (
                <div
                  key={stage.key}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap',
                    grouped[stage.key].length > 0 ? 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'
                  )}
                >
                  <div className={cn('w-1.5 h-1.5 rounded-full', stage.color)} />
                  {stage.label}: {grouped[stage.key].length}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Kanban Board - Horizontally scrollable */}
        <div className="overflow-x-auto">
          <div className="flex gap-4 px-4 pb-4 min-w-max">
            {STAGES.map(stage => (
              <StageColumn
                key={stage.key}
                stage={stage}
                quotes={grouped[stage.key]}
                onCardClick={handleCardClick}
              />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
