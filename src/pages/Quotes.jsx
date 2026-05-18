import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, CheckCircle2, ChevronLeft, ChevronRight,
  Eye, FileText, Plus, Send, Trash2, Wallet,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import ConfirmModal from '../components/ui/ConfirmModal'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'

// Status display in the table column (typed text, no pill — matches Clients pattern)
const STATE_TEXT = {
  draft:    'text-gray-500 dark:text-gray-400',
  sent:     'text-gray-700 dark:text-gray-300',
  viewed:   'text-sky-600 dark:text-sky-400',
  follow_up:'text-amber-600 dark:text-amber-400',
  accepted: 'text-emerald-600 dark:text-emerald-400',
  declined: 'text-red-600 dark:text-red-400',
  expired:  'text-gray-400 dark:text-gray-500',
}
const STATE_LABEL = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', follow_up: 'Follow up',
  accepted: 'Accepted', declined: 'Declined', expired: 'Expired',
}
// Detail-panel pill style (right-corner) — solid for accepted, neutral for the rest
const STATE_BADGE = {
  draft: 'neutral',
  sent: 'neutral',
  viewed: 'info',
  follow_up: 'warning',
  accepted: 'success-solid',
  declined: 'danger',
  expired: 'neutral',
}

function getQuoteStage(q) {
  if (q.pipeline_stage && q.pipeline_stage !== 'draft') return q.pipeline_stage
  if (q.status === 'accepted') return 'accepted'
  if (q.status === 'declined') return 'declined'
  if (q.status === 'sent') return q.viewed_at ? 'viewed' : 'sent'
  return 'draft'
}

function getQuoteTotal(q) {
  return (q.line_items || []).reduce((s, i) => s + (i.amount || (i.quantity * i.unit_price) || 0), 0)
}

function getQuoteRef(q) {
  if (q.quote_number) return q.quote_number
  // Fall back to first 4 hex chars of UUID, prefixed PM-
  const head = (q.id || '').replace(/-/g, '').slice(0, 4).toUpperCase()
  return head ? `PM-${head}` : 'PM-????'
}

function getQuoteWork(q) {
  if (q.title) return q.title
  const first = (q.line_items || [])[0]
  if (first?.description) return first.description
  return 'Quote'
}

const PAGE_SIZE = 25

export default function Quotes() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const toast = useToast()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  // Delete-from-detail-card dialog state. We track the target quote
  // separately from selectedQuoteId so the panel keeps its contents
  // while the confirm dialog is open.
  const [confirmDeleteQuote, setConfirmDeleteQuote] = useState(null)
  const [deletingQuote, setDeletingQuote] = useState(false)
  const [selectedQuoteId, setSelectedQuoteId] = useState(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!business?.id) return
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from('quotes')
        .select('*, clients(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      setQuotes(data || [])
      setLoading(false)
    }
    fetch()
  }, [business?.id])

  const enriched = useMemo(
    () => quotes.map(q => ({ ...q, _stage: getQuoteStage(q), _total: getQuoteTotal(q), _ref: getQuoteRef(q), _work: getQuoteWork(q) })),
    [quotes],
  )

  const pipelineValue = useMemo(
    () => enriched.filter(q => q._stage !== 'declined' && q._stage !== 'expired').reduce((sum, q) => sum + q._total, 0),
    [enriched],
  )
  const sentCount = useMemo(
    () => enriched.filter(q => q._stage === 'sent' || q._stage === 'viewed').length,
    [enriched],
  )
  const acceptedCount = useMemo(
    () => enriched.filter(q => q._stage === 'accepted').length,
    [enriched],
  )

  // Pagination
  const pageCount = Math.max(1, Math.ceil(enriched.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, enriched.length)
  const pagedQuotes = useMemo(
    () => enriched.slice(pageStart, pageEnd),
    [enriched, pageStart, pageEnd],
  )

  const selectedQuote = useMemo(() => {
    if (!enriched.length) return null
    return enriched.find(q => q.id === selectedQuoteId) || enriched[0]
  }, [enriched, selectedQuoteId])

  const heroTitle = enriched.length === 0
    ? 'No quotes yet'
    : `${enriched.length} ${enriched.length === 1 ? 'quote' : 'quotes'} · ${formatCurrency(pipelineValue)} in pipeline`

  async function markAccepted(quote) {
    if (!quote) return
    const { error } = await supabase
      .from('quotes')
      .update({ status: 'accepted', pipeline_stage: 'accepted' })
      .eq('id', quote.id)
    if (!error) {
      setQuotes(prev => prev.map(q => q.id === quote.id ? { ...q, status: 'accepted', pipeline_stage: 'accepted' } : q))
    }
  }

  // Hard-delete a quote. Two-step because jobs.quote_id → quotes is a
  // FK with no ON DELETE clause; deleting a quote that's been converted
  // to a job would FK-violate. Null the back-ref first, then delete the
  // quote row. line_items is JSONB on the quotes row, no extra cleanup
  // needed.
  async function handleDeleteQuote() {
    if (!confirmDeleteQuote) return
    setDeletingQuote(true)
    try {
      const id = confirmDeleteQuote.id
      const { error: jobsErr } = await supabase
        .from('jobs')
        .update({ quote_id: null })
        .eq('quote_id', id)
      if (jobsErr) throw jobsErr
      const { error } = await supabase.from('quotes').delete().eq('id', id)
      if (error) throw error
      setQuotes(prev => prev.filter(q => q.id !== id))
      if (selectedQuoteId === id) setSelectedQuoteId(null)
      toast.success('Quote deleted')
      setConfirmDeleteQuote(null)
    } catch (err) {
      toast.error(err?.message || 'Failed to delete quote')
    } finally {
      setDeletingQuote(false)
    }
  }

  if (bizLoading || loading) {
    return (
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
              Sales pipeline
            </span>
          }
          title="Quotes"
        />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper width="wide">
      <PageHero
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
            Sales pipeline
          </span>
        }
        title={heroTitle}
        action={
          <Button leftIcon={Plus} onClick={() => navigate('/quotes/new')}>
            New quote
          </Button>
        }
      />

      {/* KPI strip */}
      {enriched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">
          <Card tinted className="!p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pipeline value</p>
                <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                  {formatCurrency(pipelineValue)}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-pool-100 dark:bg-pool-900/50 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" strokeWidth={2} />
              </div>
            </div>
          </Card>
          <StatCard label="Sent"     value={sentCount}     icon={Send}         iconTone="gray" />
          <StatCard label="Accepted" value={acceptedCount} icon={CheckCircle2} iconTone={acceptedCount > 0 ? 'brand' : 'gray'} />
        </div>
      )}

      {enriched.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8" strokeWidth={1.5} />}
          title="No quotes yet"
          description="Create your first quote"
          action="New quote"
          onAction={() => navigate('/quotes/new')}
        />
      ) : (
        <>
          {/* MOBILE: stacked card list */}
          <div className="md:hidden space-y-2.5">
            {enriched.map(q => (
              <Card key={q.id} onClick={() => navigate(`/quotes/${q.id}`)}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold tabular-nums text-pool-600 dark:text-pool-400 shrink-0">
                    {q._ref}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{q.clients?.name || 'Unknown'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{q._work}</p>
                  </div>
                  <Badge variant={STATE_BADGE[q._stage] || 'neutral'} className="shrink-0">{STATE_LABEL[q._stage]}</Badge>
                  <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100 shrink-0 ml-2">
                    {formatCurrency(q._total)}
                  </p>
                </div>
              </Card>
            ))}
          </div>

          {/* DESKTOP: master-detail */}
          <div className="hidden md:grid md:grid-cols-12 gap-4">
            {/* Table */}
            <Card className="!p-0 md:col-span-7 overflow-hidden">
              <div className="grid grid-cols-[6rem_minmax(0,1fr)_8rem_7rem] gap-3 px-4 py-2 bg-gray-50/60 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <span>Ref</span>
                <span>Client / Work</span>
                <span className="text-left">State</span>
                <span className="text-right">Value</span>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {pagedQuotes.map(q => {
                  const isSelected = selectedQuote && q.id === selectedQuote.id
                  return (
                    <li key={q.id}>
                      <button
                        onClick={() => setSelectedQuoteId(q.id)}
                        onDoubleClick={() => navigate(`/quotes/${q.id}`)}
                        className={cn(
                          'w-full grid grid-cols-[6rem_minmax(0,1fr)_8rem_7rem] gap-3 px-4 py-3 text-left transition-colors items-center',
                          isSelected
                            ? 'bg-pool-50 dark:bg-pool-950/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                        )}
                      >
                        <span className={cn(
                          'text-[11px] font-semibold tabular-nums truncate',
                          isSelected ? 'text-pool-700 dark:text-pool-300' : 'text-pool-600 dark:text-pool-400',
                        )}>
                          {q._ref}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{q.clients?.name || 'Unknown'}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{q._work}</span>
                        </span>
                        <span className={cn('text-left text-sm font-medium', STATE_TEXT[q._stage])}>
                          {STATE_LABEL[q._stage]}
                        </span>
                        <span className="text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                          {formatCurrency(q._total)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {pageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40">
                  <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    Showing {pageStart + 1}–{pageEnd} of {enriched.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                    </button>
                    <span className="px-3 h-8 inline-flex items-center text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                      {safePage + 1} / {pageCount}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Detail panel */}
            <div className="md:col-span-5">
              {selectedQuote && (
                <Card className="!p-5 sticky top-24">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[11px] font-semibold tabular-nums text-pool-600 dark:text-pool-400">
                      {selectedQuote._ref}
                    </p>
                    <Badge variant={STATE_BADGE[selectedQuote._stage] || 'neutral'}>
                      {STATE_LABEL[selectedQuote._stage]}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                    {selectedQuote.clients?.name || 'Unknown'}
                  </h3>
                  {selectedQuote._work && selectedQuote._work !== 'Quote' && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {selectedQuote._work}
                    </p>
                  )}

                  {/* Line items */}
                  <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      Line items
                    </p>
                    {(selectedQuote.line_items || []).length === 0 ? (
                      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>—</span>
                        <span className="tabular-nums">{formatCurrency(0)}</span>
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {(selectedQuote.line_items || []).slice(0, 4).map((item, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-gray-700 dark:text-gray-300 truncate">
                              {item.description || item.name || 'Item'}
                              {item.quantity > 1 && (
                                <span className="text-gray-400 dark:text-gray-500"> · ×{item.quantity}</span>
                              )}
                            </span>
                            <span className="tabular-nums text-gray-900 dark:text-gray-100 shrink-0">
                              {formatCurrency(item.amount || (item.quantity * item.unit_price) || 0)}
                            </span>
                          </li>
                        ))}
                        {(selectedQuote.line_items || []).length > 4 && (
                          <li className="text-xs text-gray-400 dark:text-gray-500 italic">
                            +{selectedQuote.line_items.length - 4} more
                          </li>
                        )}
                      </ul>
                    )}
                  </div>

                  {/* Total */}
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Total</p>
                    <p className="text-2xl font-bold tabular-nums text-pool-700 dark:text-pool-300">
                      {formatCurrency(selectedQuote._total)}
                    </p>
                  </div>

                  {/* Actions. Delete pushes far-right via ml-auto so
                      "Mark accepted" sits between it and "Open quote"
                      when it's shown; if "Mark accepted" is hidden
                      (already accepted/declined), Delete simply lands
                      on the far right next to the link. Matches the
                      /recurring detail card pattern. */}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => navigate(`/quotes/${selectedQuote.id}`)}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300 transition-colors group"
                    >
                      Open quote
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
                    </button>
                    {/* Preview opens the customer-facing quote page in a
                        new tab, in read-only preview mode (Accept/Decline
                        suppressed). */}
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={Eye}
                      onClick={() => window.open(`/quote/${selectedQuote.public_token}?preview=1`, '_blank', 'noopener,noreferrer')}
                    >
                      Preview
                    </Button>
                    {selectedQuote._stage !== 'accepted' && selectedQuote._stage !== 'declined' && (
                      <Button
                        size="sm"
                        leftIcon={CheckCircle2}
                        onClick={() => markAccepted(selectedQuote)}
                        className="!bg-emerald-500 !shadow-emerald-500/20 hover:!brightness-110"
                      >
                        Mark accepted
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={Trash2}
                      onClick={() => setConfirmDeleteQuote(selectedQuote)}
                      className="ml-auto"
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* Hard-delete confirmation. handleDeleteQuote nulls jobs.quote_id
          first so a converted quote can be removed without FK violation;
          the job itself stays. line_items is JSONB on the row so the
          quote delete cleans up everything in one shot. */}
      <ConfirmModal
        open={!!confirmDeleteQuote}
        onClose={() => !deletingQuote && setConfirmDeleteQuote(null)}
        title="Delete this quote?"
        description={confirmDeleteQuote
          ? `Permanently removes ${getQuoteRef(confirmDeleteQuote)} and any line items. If this quote was converted to a job, the job stays but loses its quote reference. Cannot be undone.`
          : ''}
        destructive
        confirmLabel={deletingQuote ? 'Deleting…' : 'Delete quote'}
        onConfirm={handleDeleteQuote}
      />
    </PageWrapper>
  )
}
