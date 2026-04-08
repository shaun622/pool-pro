import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'

// ─── CLIENT CARD ───────────────────────────────────
function ClientCard({ client, poolCount, onClick }) {
  const initials = client.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-gradient-brand flex items-center justify-center shrink-0 shadow-sm shadow-pool-500/20">
          <span className="text-sm font-bold text-white">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{client.name}</h3>
          {client.email && <p className="text-xs text-gray-400 truncate mt-0.5">{client.email}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-lg',
            poolCount > 0 ? 'bg-pool-50 text-pool-600' : 'bg-gray-50 text-gray-400')}>
            {poolCount} {poolCount === 1 ? 'pool' : 'pools'}
          </span>
          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
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

  const poolCounts = pools.reduce((acc, pool) => {
    acc[pool.client_id] = (acc[pool.client_id] || 0) + 1
    return acc
  }, {})

  const filtered = rawClients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const filteredCRM = crmFilter === 'all' ? crmClients : crmClients.filter(c => c.crmStatus === crmFilter)

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const created = await createClient(form)
      setModalOpen(false)
      setForm(emptyClient)
      navigate(`/clients/${created.id}`)
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setSaving(false)
    }
  }

  // Header actions: CRM toggle + Add
  const headerAction = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setView(v => v === 'list' ? 'crm' : 'list')}
        className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors"
        title={view === 'list' ? 'CRM view' : 'List view'}
      >
        {view === 'list' ? (
          // Bar chart icon → switch to CRM
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        ) : (
          // List icon → switch to list
          <svg className="w-5 h-5 text-pool-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        )}
      </button>
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
      <Header title={view === 'list' ? 'Clients' : 'CRM'} right={headerAction} />
      <PageWrapper>
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
              <div className="space-y-2.5">
                {filtered.map(client => (
                  <ClientCard key={client.id} client={client} poolCount={poolCounts[client.id] || 0}
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
              <div className="space-y-2">
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Client">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Name" name="name" value={form.name} onChange={handleChange} required placeholder="Full name" />
          <Input label="Email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="email@example.com" />
          <Input label="Phone" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="0400 000 000" />
          <Input label="Address" name="address" value={form.address} onChange={handleChange} placeholder="Street address" />
          <TextArea label="Notes" name="notes" value={form.notes} onChange={handleChange} placeholder="Any additional notes..." />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Add Client</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
