import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight,
  Plus, Receipt, Send, Wallet,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatCurrency, cn } from '../lib/utils'

// Typed status colour for the table column (no pill — matches Clients/Quotes)
const STATE_TEXT = {
  draft:    'text-gray-500 dark:text-gray-400',
  sent:     'text-gray-700 dark:text-gray-300',
  paid:     'text-emerald-600 dark:text-emerald-400',
  overdue:  'text-red-600 dark:text-red-400',
  void:     'text-gray-400 dark:text-gray-500',
}
const STATE_LABEL = {
  draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Void',
}
// Detail-panel pill — solid for paid, soft for everything else
const STATE_BADGE = {
  draft: 'neutral',
  sent: 'neutral',
  paid: 'success-solid',
  overdue: 'danger',
  void: 'neutral',
}

function getInvoiceRef(inv) {
  if (inv.invoice_number) return inv.invoice_number
  const head = (inv.id || '').replace(/-/g, '').slice(0, 4).toUpperCase()
  return head ? `INV-${head}` : 'INV-????'
}

const PAGE_SIZE = 25

export default function Invoices() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [page, setPage] = useState(0)
  const [stateFilter, setStateFilter] = useState('all')

  useEffect(() => {
    if (!business?.id) return
    async function fetchInvoices() {
      setLoading(true)
      const { data } = await supabase
        .from('invoices')
        .select('*, clients(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
      setInvoices(data || [])
      setLoading(false)
    }
    fetchInvoices()
  }, [business?.id])

  const enriched = useMemo(
    () => invoices.map(inv => ({ ...inv, _ref: getInvoiceRef(inv), _total: Number(inv.total) || 0 })),
    [invoices],
  )

  const outstanding = useMemo(
    () => enriched.filter(inv => inv.status === 'sent' || inv.status === 'overdue').reduce((s, inv) => s + inv._total, 0),
    [enriched],
  )
  const sentCount = useMemo(
    () => enriched.filter(inv => inv.status === 'sent').length,
    [enriched],
  )
  const overdueCount = useMemo(
    () => enriched.filter(inv => inv.status === 'overdue').length,
    [enriched],
  )

  // Per-state counts for the filter pills
  const stateCounts = useMemo(() => ({
    all:     enriched.length,
    draft:   enriched.filter(i => i.status === 'draft').length,
    sent:    enriched.filter(i => i.status === 'sent').length,
    paid:    enriched.filter(i => i.status === 'paid').length,
    overdue: enriched.filter(i => i.status === 'overdue').length,
  }), [enriched])

  const filteredInvoices = useMemo(() => {
    if (stateFilter === 'all') return enriched
    return enriched.filter(inv => inv.status === stateFilter)
  }, [enriched, stateFilter])

  // Reset to page 0 when the filter changes (otherwise we could land out of range)
  useEffect(() => { setPage(0) }, [stateFilter])

  const pageCount = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredInvoices.length)
  const pagedInvoices = useMemo(() => filteredInvoices.slice(pageStart, pageEnd), [filteredInvoices, pageStart, pageEnd])

  const selectedInvoice = useMemo(() => {
    if (!filteredInvoices.length) return null
    return filteredInvoices.find(i => i.id === selectedInvoiceId) || filteredInvoices[0]
  }, [filteredInvoices, selectedInvoiceId])

  const heroTitle = enriched.length === 0
    ? 'No invoices yet'
    : `${enriched.length} ${enriched.length === 1 ? 'invoice' : 'invoices'} · ${formatCurrency(outstanding)} outstanding`

  async function markPaid(invoice) {
    if (!invoice) return
    const { error } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', invoice.id)
    if (!error) {
      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, status: 'paid' } : i))
    }
  }

  if (bizLoading || loading) {
    return (
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Receipt className="w-3.5 h-3.5" strokeWidth={2.5} />
              Billing
            </span>
          }
          title="Invoices"
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
            <Receipt className="w-3.5 h-3.5" strokeWidth={2.5} />
            Billing
          </span>
        }
        title={heroTitle}
        action={
          <Button leftIcon={Plus} onClick={() => navigate('/invoices/new')}>
            New invoice
          </Button>
        }
      />

      {/* KPI strip */}
      {enriched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">
          <Card tinted className="!p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Outstanding</p>
                <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                  {formatCurrency(outstanding)}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-pool-100 dark:bg-pool-900/50 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" strokeWidth={2} />
              </div>
            </div>
          </Card>
          <StatCard label="Sent"    value={sentCount}    icon={Send}           iconTone="gray" />
          <StatCard label="Overdue" value={overdueCount} icon={AlertTriangle}  iconTone={overdueCount > 0 ? 'red' : 'gray'} />
        </div>
      )}

      {enriched.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-8 h-8" strokeWidth={1.5} />}
          title="No invoices yet"
          description="Create your first invoice"
          action="New invoice"
          onAction={() => navigate('/invoices/new')}
        />
      ) : (
        <>
          {/* State filter pills — uniform shape, single brand-tinted active */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { key: 'all',     label: 'All' },
              { key: 'draft',   label: 'Draft' },
              { key: 'sent',    label: 'Sent' },
              { key: 'paid',    label: 'Paid' },
              { key: 'overdue', label: 'Overdue' },
            ].map(f => {
              const active = stateFilter === f.key
              const count = stateCounts[f.key] || 0
              return (
                <button
                  key={f.key}
                  onClick={() => setStateFilter(f.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                    active
                      ? 'bg-pool-50 dark:bg-pool-950/40 border-pool-200 dark:border-pool-800/60 text-pool-700 dark:text-pool-300 ring-1 ring-pool-300/40'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                  )}
                >
                  <span>{f.label}</span>
                  <span className={cn(
                    'tabular-nums text-[11px]',
                    active ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500',
                  )}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* MOBILE: stacked card list */}
          <div className="md:hidden space-y-2.5">
            {filteredInvoices.map(inv => (
              <Card key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold tabular-nums text-pool-600 dark:text-pool-400 shrink-0">
                    {inv._ref}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{inv.clients?.name || 'Unknown'}</p>
                  </div>
                  <Badge variant={STATE_BADGE[inv.status] || 'neutral'} className="shrink-0">{STATE_LABEL[inv.status] || inv.status}</Badge>
                  <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100 shrink-0 ml-2">
                    {formatCurrency(inv._total)}
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
                <span>Client</span>
                <span className="text-left">State</span>
                <span className="text-right">Value</span>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {pagedInvoices.map(inv => {
                  const isSelected = selectedInvoice && inv.id === selectedInvoice.id
                  return (
                    <li key={inv.id}>
                      <button
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        onDoubleClick={() => navigate(`/invoices/${inv.id}`)}
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
                          {inv._ref}
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {inv.clients?.name || 'Unknown'}
                        </span>
                        <span className={cn('text-left text-sm font-medium', STATE_TEXT[inv.status] || 'text-gray-500')}>
                          {STATE_LABEL[inv.status] || inv.status}
                        </span>
                        <span className="text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                          {formatCurrency(inv._total)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {pageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40">
                  <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    Showing {pageStart + 1}–{pageEnd} of {filteredInvoices.length}
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
              {selectedInvoice && (
                <Card className="!p-5 sticky top-24">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[11px] font-semibold tabular-nums text-pool-600 dark:text-pool-400">
                      {selectedInvoice._ref}
                    </p>
                    <Badge variant={STATE_BADGE[selectedInvoice.status] || 'neutral'}>
                      {STATE_LABEL[selectedInvoice.status] || selectedInvoice.status}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                    {selectedInvoice.clients?.name || 'Unknown'}
                  </h3>

                  {/* Line items */}
                  <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      Line items
                    </p>
                    {(selectedInvoice.line_items || []).length === 0 ? (
                      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>—</span>
                        <span className="tabular-nums">{formatCurrency(0)}</span>
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {(selectedInvoice.line_items || []).slice(0, 4).map((item, i) => (
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
                        {(selectedInvoice.line_items || []).length > 4 && (
                          <li className="text-xs text-gray-400 dark:text-gray-500 italic">
                            +{selectedInvoice.line_items.length - 4} more
                          </li>
                        )}
                      </ul>
                    )}
                  </div>

                  {/* Total */}
                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Total</p>
                    <p className="text-2xl font-bold tabular-nums text-pool-700 dark:text-pool-300">
                      {formatCurrency(selectedInvoice._total)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <button
                      onClick={() => navigate(`/invoices/${selectedInvoice.id}`)}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300 transition-colors group"
                    >
                      Open invoice
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
                    </button>
                    {selectedInvoice.status !== 'paid' && selectedInvoice.status !== 'void' && (
                      <Button
                        size="sm"
                        leftIcon={CheckCircle2}
                        onClick={() => markPaid(selectedInvoice)}
                        className="!bg-emerald-500 !shadow-emerald-500/20 hover:!brightness-110"
                      >
                        Mark paid
                      </Button>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </PageWrapper>
  )
}
