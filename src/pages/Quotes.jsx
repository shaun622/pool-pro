import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LayoutGrid, List } from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'

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
  { key: 'draft', label: 'Draft', color: 'bg-gray-400', textColor: 'text-gray-600 dark:text-gray-400' },
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

export default function Quotes() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'pipeline'
  const [stageFilter, setStageFilter] = useState('all')

  useEffect(() => {
    if (!business?.id) return
    async function fetch() {
      setLoading(true)
      const { data } = await supabase.from('quotes').select('*, clients(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      setQuotes(data || [])
      setLoading(false)
    }
    fetch()
  }, [business?.id])

  // Group for pipeline view
  const grouped = {}
  PIPELINE_STAGES.forEach(s => { grouped[s.key] = [] })
  quotes.forEach(q => {
    const stage = getQuoteStage(q)
    if (grouped[stage]) grouped[stage].push(q)
    else grouped.draft.push(q)
  })

  const totalValue = quotes
    .filter(q => getQuoteStage(q) !== 'declined')
    .reduce((sum, q) => sum + getQuoteTotal(q), 0)

  const filteredQuotes = stageFilter === 'all' ? quotes : quotes.filter(q => getQuoteStage(q) === stageFilter)

  // Hero
  const pendingCount = quotes.filter(q => ['sent', 'viewed', 'follow_up'].includes(getQuoteStage(q))).length
  const acceptedCount = quotes.filter(q => getQuoteStage(q) === 'accepted').length
  const heroSubtitle = quotes.length === 0
    ? 'No quotes yet'
    : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}${acceptedCount > 0 ? ` · ${acceptedCount} accepted` : ''}`

  const heroAction = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setView(v => v === 'list' ? 'pipeline' : 'list')}
        className="min-h-tap min-w-tap flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label="Toggle view"
      >
        {view === 'list'
          ? <LayoutGrid className="w-4 h-4 text-gray-600 dark:text-gray-400" strokeWidth={2} />
          : <List className="w-4 h-4 text-gray-600 dark:text-gray-400" strokeWidth={2} />
        }
      </button>
      <Button leftIcon={Plus} onClick={() => navigate('/quotes/new')}>New Quote</Button>
    </div>
  )

  if (bizLoading || loading) {
    return (
      <PageWrapper>
        <PageHero title="Quotes" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  return (
    <>
      <PageWrapper>
        <PageHero title="Quotes" subtitle={heroSubtitle} action={heroAction} />
        {/* Pipeline summary bar */}
        {quotes.length > 0 && (
          <Card className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">Pipeline Value</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(totalValue)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold">Total</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{quotes.length}</p>
              </div>
            </div>
            {/* Mini stage indicators */}
            <div className="flex gap-1 pt-2 border-t border-gray-100 dark:border-gray-800">
              {PIPELINE_STAGES.map(stage => (
                <div key={stage.key} className="flex-1 text-center">
                  <div className={cn('w-2 h-2 rounded-full mx-auto mb-0.5', stage.color,
                    grouped[stage.key].length === 0 && 'opacity-20')} />
                  <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400">{grouped[stage.key].length}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {view === 'pipeline' ? (
          /* ─── PIPELINE VIEW (vertical grouped list) ─── */
          <>
            {PIPELINE_STAGES.map(stage => {
              const stageQuotes = grouped[stage.key]
              if (stageQuotes.length === 0) return null
              const stageValue = stageQuotes.reduce((sum, q) => sum + getQuoteTotal(q), 0)
              return (
                <div key={stage.key} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn('w-2.5 h-2.5 rounded-full', stage.color)} />
                    <h3 className={cn('text-sm font-bold', stage.textColor)}>{stage.label}</h3>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{stageQuotes.length}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{formatCurrency(stageValue)}</span>
                  </div>
                  <div className="space-y-2">
                    {stageQuotes.map(quote => (
                      <Card key={quote.id} onClick={() => navigate(`/quotes/${quote.id}`)} className="py-3">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{quote.clients?.name || 'Unknown'}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(quote.created_at)}</p>
                          </div>
                          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 ml-3">{formatCurrency(getQuoteTotal(quote))}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )
            })}
            {quotes.length === 0 && (
              <EmptyState
                icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                title="No quotes yet"
                description="Create your first quote"
                action="Create Quote"
                onAction={() => navigate('/quotes/new')}
              />
            )}
          </>
        ) : (
          /* ─── LIST VIEW ─── */
          <>
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
                      : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 shadow-card')}>
                  {f.label}
                </button>
              ))}
            </div>

            {filteredQuotes.length === 0 ? (
              <EmptyState
                icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                title="No quotes yet"
                description="Create your first quote"
                action="Create Quote"
                onAction={() => navigate('/quotes/new')}
              />
            ) : (
              <div className="space-y-2.5">
                {filteredQuotes.map(quote => {
                  const stage = getQuoteStage(quote)
                  const stageDef = PIPELINE_STAGES.find(s => s.key === stage) || PIPELINE_STAGES[0]
                  return (
                    <Card key={quote.id} onClick={() => navigate(`/quotes/${quote.id}`)}>
                      <div className="flex items-center gap-3">
                        <div className={cn('w-2 h-full min-h-[40px] rounded-full shrink-0', stageDef.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{quote.clients?.name}</p>
                            <Badge variant={QUOTE_STATUS_BADGE[quote.status]} className="ml-2 shrink-0 text-[10px]">
                              {QUOTE_STATUS_LABEL[quote.status]}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatCurrency(getQuoteTotal(quote))}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">{formatDate(quote.created_at)}</p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* FAB */}
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
