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

// ─── CLIENTS LIST TAB ──────────────────────────────
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

function ClientsListTab({ clients, loading, pools, onAdd }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const poolCounts = pools.reduce((acc, pool) => {
    acc[pool.client_id] = (acc[pool.client_id] || 0) + 1
    return acc
  }, {})

  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <div className="mb-5">
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        search ? (
          <EmptyState
            icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
            title="No results"
            description={`No clients matching "${search}"`}
          />
        ) : (
          <EmptyState
            icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
            title="No clients yet"
            description="Add your first client to get started"
            action="Add Client"
            onAction={onAdd}
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

      {!loading && clients.length > 0 && (
        <button onClick={onAdd}
          className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}
    </>
  )
}

// ─── CRM TAB ───────────────────────────────────────
const STATUS_STYLES = {
  active: { color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500', label: 'Active' },
  follow_up: { color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Follow Up' },
  new: { color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500', label: 'New' },
  inactive: { color: 'text-gray-500', bg: 'bg-gray-100', dot: 'bg-gray-400', label: 'Inactive' },
}

function CRMTab({ businessId }) {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

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
          status: daysSinceService === null ? 'new'
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

  if (loading) return <LoadingSpinner />

  const filteredClients = filter === 'all' ? clients : clients.filter(c => c.status === filter)

  const statusCounts = {
    all: clients.length,
    active: clients.filter(c => c.status === 'active').length,
    follow_up: clients.filter(c => c.status === 'follow_up').length,
    new: clients.filter(c => c.status === 'new').length,
    inactive: clients.filter(c => c.status === 'inactive').length,
  }

  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        <Card className="text-center py-3 bg-gradient-to-br from-green-50 to-white">
          <p className="text-lg font-bold text-green-600">{statusCounts.active}</p>
          <p className="text-[9px] text-gray-500 uppercase font-semibold">Active</p>
        </Card>
        <Card className="text-center py-3 bg-gradient-to-br from-amber-50 to-white">
          <p className="text-lg font-bold text-amber-600">{statusCounts.follow_up}</p>
          <p className="text-[9px] text-gray-500 uppercase font-semibold">Follow Up</p>
        </Card>
        <Card className="text-center py-3 bg-gradient-to-br from-blue-50 to-white">
          <p className="text-lg font-bold text-blue-600">{statusCounts.new}</p>
          <p className="text-[9px] text-gray-500 uppercase font-semibold">New</p>
        </Card>
        <Card className="text-center py-3 bg-gradient-to-br from-gray-50 to-white">
          <p className="text-lg font-bold text-gray-500">{statusCounts.inactive}</p>
          <p className="text-[9px] text-gray-500 uppercase font-semibold">Inactive</p>
        </Card>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
        {[
          { key: 'all', label: `All (${statusCounts.all})` },
          { key: 'active', label: `Active (${statusCounts.active})` },
          { key: 'follow_up', label: `Follow Up (${statusCounts.follow_up})` },
          { key: 'new', label: `New (${statusCounts.new})` },
          { key: 'inactive', label: `Inactive (${statusCounts.inactive})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn('shrink-0 px-3.5 py-2 rounded-xl text-xs font-semibold min-h-tap transition-all',
              filter === f.key ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                : 'bg-white text-gray-600 border border-gray-200 shadow-card')}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Client list */}
      {filteredClients.length === 0 ? (
        <EmptyState
          icon={<svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          title="No clients in this filter"
          description="Try a different filter"
        />
      ) : (
        <div className="space-y-2">
          {filteredClients.map(client => {
            const st = STATUS_STYLES[client.status] || STATUS_STYLES.active
            return (
              <Card key={client.id} onClick={() => navigate(`/clients/${client.id}`)}>
                <div className="flex items-start gap-3">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold', st.bg, st.color)}>
                    {(client.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">{client.name}</p>
                      <Badge variant={client.status === 'follow_up' ? 'warning' : client.status === 'new' ? 'primary' : client.status === 'inactive' ? 'default' : 'success'}
                        className="text-[10px] shrink-0">
                        {st.label}
                      </Badge>
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
  )
}

// ─── SHARED ────────────────────────────────────────
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ─── MAIN COMPONENT ────────────────────────────────
const emptyClient = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Clients() {
  const navigate = useNavigate()
  const { clients, loading, createClient } = useClients()
  const { pools } = usePools()
  const { business } = useBusiness()
  const [activeTab, setActiveTab] = useState('clients')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)

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

  return (
    <>
      <Header title={activeTab === 'clients' ? 'Clients' : 'CRM'} />
      <PageWrapper>
        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          {[
            { key: 'clients', label: 'Clients' },
            { key: 'crm', label: 'CRM' },
          ].map(tab => (
            <button
              key={tab.key}
              className={cn(
                'flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all duration-200',
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'clients' && (
          <ClientsListTab clients={clients} loading={loading} pools={pools} onAdd={() => setModalOpen(true)} />
        )}
        {activeTab === 'crm' && <CRMTab businessId={business?.id} />}
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
