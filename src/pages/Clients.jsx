import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea } from '../components/ui/Input'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn, FREQUENCY_LABELS } from '../lib/utils'

// ─── CLIENT CARD ───────────────────────────────────
function ClientCard({ client, clientPools, onClick }) {
  const initials = client.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const poolCount = clientPools.length

  // Find the most urgent pool (soonest due or most overdue)
  const now = new Date()
  const nextDuePool = clientPools
    .filter(p => p.next_due_at)
    .sort((a, b) => new Date(a.next_due_at) - new Date(b.next_due_at))[0]

  const overduePools = clientPools.filter(p => p.next_due_at && new Date(p.next_due_at) < now)
  const isDueToday = nextDuePool && !overduePools.includes(nextDuePool) &&
    new Date(nextDuePool.next_due_at) <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-3.5">
        {/* Avatar with status indicator */}
        <div className="relative shrink-0">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shadow-sm',
            overduePools.length > 0 ? 'bg-red-500 shadow-red-500/20'
              : isDueToday ? 'bg-amber-500 shadow-amber-500/20'
              : 'bg-gradient-brand shadow-pool-500/20')}>
            <span className="text-sm font-bold text-white">{initials}</span>
          </div>
          {overduePools.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full text-[8px] text-white font-bold flex items-center justify-center">
              {overduePools.length}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{client.name}</h3>
            {poolCount > 0 && (
              <span className="text-[10px] font-semibold text-gray-400 shrink-0">
                {poolCount} pool{poolCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {/* Service status line */}
          {nextDuePool ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                overduePools.length > 0 ? 'bg-red-500' : isDueToday ? 'bg-amber-500' : 'bg-green-500')} />
              <p className={cn('text-xs truncate',
                overduePools.length > 0 ? 'text-red-600 font-medium'
                  : isDueToday ? 'text-amber-600 font-medium'
                  : 'text-gray-400')}>
                {overduePools.length > 0
                  ? `${overduePools.length} overdue`
                  : isDueToday
                  ? 'Due today'
                  : `Next: ${formatDate(nextDuePool.next_due_at)}`}
                {nextDuePool.schedule_frequency && (
                  <span className="text-gray-400 font-normal"> · {FREQUENCY_LABELS[nextDuePool.schedule_frequency] || nextDuePool.schedule_frequency}</span>
                )}
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">
              {poolCount === 0 ? 'No pools' : 'No schedule set'}
            </p>
          )}
        </div>

        <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Card>
  )
}

// ─── CRM STATUS LOGIC ──────────────────────────────
const STATUS_STYLES = {
  active: { color: 'text-green-600', bg: 'bg-green-50', label: 'Active', badge: 'success' },
  follow_up: { color: 'text-amber-600', bg: 'bg-amber-50', label: 'Follow Up', badge: 'warning' },
  new: { color: 'text-blue-600', bg: 'bg-blue-50', label: 'New', badge: 'primary' },
  inactive: { color: 'text-gray-500', bg: 'bg-gray-100', label: 'Inactive', badge: 'default' },
}

function useCRMData(businessId) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!businessId) return
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from('clients')
        .select('*, pools(id, address, next_due_at, last_serviced_at, service_records(id, serviced_at, status))')
        .eq('business_id', businessId)
        .order('name')

      const enriched = (data || []).map(client => {
        const allPools = client.pools || []
        const allServices = allPools.flatMap(p => (p.service_records || []))
        const completedServices = allServices.filter(s => s.status === 'completed')
        const lastService = completedServices.sort((a, b) => new Date(b.serviced_at) - new Date(a.serviced_at))[0]
        const daysSinceService = lastService
          ? Math.floor((Date.now() - new Date(lastService.serviced_at)) / (1000 * 60 * 60 * 24))
          : null
        const overduePools = allPools.filter(p => p.next_due_at && new Date(p.next_due_at) < new Date())

        return {
          ...client,
          totalServices: completedServices.length,
          lastServiceDate: lastService?.serviced_at,
          daysSinceService,
          poolCount: allPools.length,
          overduePools: overduePools.length,
          crmStatus: daysSinceService === null ? 'new'
            : daysSinceService > 60 ? 'inactive'
            : overduePools.length > 0 ? 'follow_up'
            : 'active',
        }
      })

      setClients(enriched)
      setLoading(false)
    }
    fetch()
  }, [businessId])

  const counts = {
    all: clients.length,
    active: clients.filter(c => c.crmStatus === 'active').length,
    follow_up: clients.filter(c => c.crmStatus === 'follow_up').length,
    new: clients.filter(c => c.crmStatus === 'new').length,
    inactive: clients.filter(c => c.crmStatus === 'inactive').length,
  }

  return { clients, loading, counts }
}

// ─── MAIN COMPONENT ────────────────────────────────
const emptyClient = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Clients() {
  const navigate = useNavigate()
  const { clients: rawClients, loading: clientsLoading, createClient } = useClients()
  const { pools } = usePools()
  const { business } = useBusiness()
  const [view, setView] = useState('list') // 'list' | 'crm'
  const [search, setSearch] = useState('')
  const [crmFilter, setCrmFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)


  // CRM data (only fetched when in CRM view)
  const { clients: crmClients, loading: crmLoading, counts } = useCRMData(
    view === 'crm' ? business?.id : null
  )

  const poolsByClient = pools.reduce((acc, pool) => {
    if (!acc[pool.client_id]) acc[pool.client_id] = []
    acc[pool.client_id].push(pool)
    return acc
  }, {})

  // Active clients = those with at least one pool
  const activeClients = rawClients.filter(c => (poolsByClient[c.id] || []).length > 0)
  const filtered = activeClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const filteredCRM = crmFilter === 'all' ? crmClients : crmClients.filter(c => c.crmStatus === crmFilter)

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const clientData = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      }
      const created = await createClient(clientData)
      if (!created?.id) throw new Error('No client ID returned')
      setModalOpen(false)
      setForm(emptyClient)
      // Navigate to client detail with flag to auto-open pool modal
      navigate(`/clients/${created.id}?addPool=1`)
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setSaving(false)
    }
  }

  // Header actions
  const headerAction = (
    <div className="flex items-center gap-1">
      {view === 'list' ? (
        <button
          onClick={() => setView('crm')}
          className="min-h-tap px-3 flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
        >
          <span className="text-xs font-semibold text-pool-600">View All</span>
        </button>
      ) : (
        <button
          onClick={() => setView('list')}
          className="min-h-tap px-3 flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
        >
          <span className="text-xs font-semibold text-pool-600">Active</span>
        </button>
      )}
      <button
        onClick={() => setModalOpen(true)}
        className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
      >
        <svg className="w-6 h-6 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  )

  return (
    <>
      <Header title={view === 'list' ? 'Active Clients' : 'All Clients'} right={headerAction} />
      <PageWrapper width="wide">
        {view === 'list' ? (
          /* ─── LIST VIEW ─── */
          <>
            <div className="mb-5">
              <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {clientsLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              search ? (
                <EmptyState
                  icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
                  title="No results"
                  description={`No clients matching "${search}"`}
                />
              ) : (
                <EmptyState
                  icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                  title="No clients yet"
                  description="Add your first client to get started"
                  action="Add Client"
                  onAction={() => setModalOpen(true)}
                />
              )
            ) : (
              <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
                {filtered.map(client => (
                  <ClientCard key={client.id} client={client} clientPools={poolsByClient[client.id] || []}
                    onClick={() => navigate(`/clients/${client.id}`)} />
                ))}
              </div>
            )}
          </>
        ) : (
          /* ─── CRM VIEW ─── */
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { key: 'active', count: counts.active, color: 'text-green-600', bg: 'from-green-50' },
                { key: 'follow_up', count: counts.follow_up, color: 'text-amber-600', bg: 'from-amber-50', label: 'Follow Up' },
                { key: 'new', count: counts.new, color: 'text-blue-600', bg: 'from-blue-50' },
                { key: 'inactive', count: counts.inactive, color: 'text-gray-500', bg: 'from-gray-50' },
              ].map(s => (
                <button key={s.key} onClick={() => setCrmFilter(crmFilter === s.key ? 'all' : s.key)}
                  className={cn('rounded-xl py-3 text-center transition-all bg-gradient-to-br to-white',
                    s.bg, crmFilter === s.key && 'ring-2 ring-pool-400 ring-offset-1')}>
                  <p className={cn('text-lg font-bold', s.color)}>{s.count}</p>
                  <p className="text-[9px] text-gray-500 uppercase font-semibold">{s.label || s.key}</p>
                </button>
              ))}
            </div>

            {/* Filter pills */}
            <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide">
              {[
                { key: 'all', label: `All (${counts.all})` },
                { key: 'active', label: `Active (${counts.active})` },
                { key: 'follow_up', label: `Follow Up (${counts.follow_up})` },
                { key: 'new', label: `New (${counts.new})` },
                { key: 'inactive', label: `Inactive (${counts.inactive})` },
              ].map(f => (
                <button key={f.key} onClick={() => setCrmFilter(f.key)}
                  className={cn('shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all',
                    crmFilter === f.key ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                      : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
                  {f.label}
                </button>
              ))}
            </div>

            {/* CRM client list */}
            {crmLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredCRM.length === 0 ? (
              <EmptyState
                icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                title="No clients in this filter"
                description="Try a different filter"
              />
            ) : (
              <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
                {filteredCRM.map(client => {
                  const st = STATUS_STYLES[client.crmStatus] || STATUS_STYLES.active
                  return (
                    <Card key={client.id} onClick={() => navigate(`/clients/${client.id}`)}>
                      <div className="flex items-start gap-3">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold', st.bg, st.color)}>
                          {(client.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 truncate">{client.name}</p>
                            <Badge variant={st.badge} className="text-[10px] shrink-0">{st.label}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-400">{client.poolCount} pool{client.poolCount !== 1 ? 's' : ''}</span>
                            <span className="text-xs text-gray-400">{client.totalServices} services</span>
                            {client.lastServiceDate && (
                              <span className="text-xs text-gray-400">Last: {formatDate(client.lastServiceDate)}</span>
                            )}
                          </div>
                          {client.overduePools > 0 && (
                            <p className="text-xs text-amber-600 font-medium mt-1">{client.overduePools} overdue pool{client.overduePools > 1 ? 's' : ''}</p>
                          )}
                        </div>
                        {/* Quick actions */}
                        <div className="flex gap-1 shrink-0">
                          {client.phone && (
                            <a href={`tel:${client.phone}`} onClick={e => e.stopPropagation()}
                              className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-green-50 transition-colors">
                              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                            </a>
                          )}
                          {client.email && (
                            <a href={`mailto:${client.email}`} onClick={e => e.stopPropagation()}
                              className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-blue-50 transition-colors">
                              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </a>
                          )}
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
        {!clientsLoading && rawClients.length > 0 && (
          <button onClick={() => setModalOpen(true)}
            className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </PageWrapper>

      {/* Add Client Modal */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setForm(emptyClient) }} title="Add Client">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Name" name="name" value={form.name} onChange={handleChange} required placeholder="Full name" />
          <Input label="Email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="email@example.com" />
          <Input label="Phone" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="0400 000 000" />
          <AddressAutocomplete
            label="Address"
            value={form.address}
            onChange={(v) => setForm(prev => ({ ...prev, address: v }))}
            onSelect={({ address }) => setForm(prev => ({ ...prev, address }))}
            placeholder="Start typing a street address..."
          />
          <TextArea label="Notes" name="notes" value={form.notes} onChange={handleChange} placeholder="Any additional notes..." />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => { setModalOpen(false); setForm(emptyClient) }}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Next</Button>
          </div>
          <p className="text-xs text-center text-gray-400">You'll be taken to add their pool next</p>
        </form>
      </Modal>
    </>
  )
}
