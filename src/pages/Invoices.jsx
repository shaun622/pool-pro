import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'

const STATUS_TABS = ['all', 'draft', 'sent', 'paid', 'overdue']

const STATUS_BADGE = {
  draft: 'default',
  sent: 'primary',
  paid: 'success',
  overdue: 'danger',
  void: 'warning',
}

const STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Invoice Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

function InvoiceCard({ invoice, onClick }) {
  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-3.5">
        <div className={cn(
          'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm',
          invoice.status === 'paid'
            ? 'bg-emerald-500 shadow-emerald-500/20'
            : invoice.status === 'overdue'
            ? 'bg-red-500 shadow-red-500/20'
            : 'bg-gradient-brand shadow-pool-500/20'
        )}>
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{invoice.invoice_number}</h3>
            <Badge variant={STATUS_BADGE[invoice.status] || 'default'}>
              {STATUS_LABEL[invoice.status] || invoice.status}
            </Badge>
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {invoice.clients?.name || 'Unknown client'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(invoice.total)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(invoice.issued_date || invoice.created_at)}
          </p>
        </div>
        <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Card>
  )
}

export default function Invoices() {
  const { business } = useBusiness()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    if (!business?.id) return

    async function fetchInvoices() {
      setLoading(true)
      const { data, error } = await supabase
        .from('invoices')
        .select('*, clients(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching invoices:', error)
      } else {
        setInvoices(data || [])
      }
      setLoading(false)
    }

    fetchInvoices()
  }, [business?.id])

  const filtered = useMemo(() => {
    if (activeTab === 'all') return invoices
    return invoices.filter(inv => inv.status === activeTab)
  }, [invoices, activeTab])

  // Summary stats
  const outstanding = useMemo(() => {
    return invoices
      .filter(inv => inv.status === 'sent' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + (inv.total || 0), 0)
  }, [invoices])

  const paidThisMonth = useMemo(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    return invoices
      .filter(inv => inv.status === 'paid' && inv.paid_date >= startOfMonth)
      .reduce((sum, inv) => sum + (inv.paid_amount || inv.total || 0), 0)
  }, [invoices])

  return (
    <>
      <Header title="Invoices" />
      <PageWrapper>
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="card p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Outstanding</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(outstanding)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Paid This Month</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(paidThisMonth)}</p>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors min-h-tap',
                activeTab === tab
                  ? 'bg-pool-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Invoice list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            title={activeTab === 'all' ? 'No invoices yet' : `No ${activeTab} invoices`}
            description={activeTab === 'all' ? 'Create your first invoice to get started' : `No invoices with status "${activeTab}"`}
            action={activeTab === 'all' ? 'Create Invoice' : undefined}
            onAction={activeTab === 'all' ? () => navigate('/invoices/new') : undefined}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map(invoice => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                onClick={() => navigate(`/invoices/${invoice.id}`)}
              />
            ))}
          </div>
        )}

        {/* FAB */}
        {!loading && invoices.length > 0 && (
          <button
            onClick={() => navigate('/invoices/new')}
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
