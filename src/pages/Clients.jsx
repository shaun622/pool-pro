import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Briefcase, CheckCircle2, Plus, Search, Users } from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import Input, { TextArea } from '../components/ui/Input'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useBusiness } from '../hooks/useBusiness'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { supabase } from '../lib/supabase'
import { formatDate, cn } from '../lib/utils'

// ─── STATUS LOGIC ──────────────────────────────────
const STATUS = {
  overdue:     { label: 'Overdue',     badge: 'danger',  dot: 'bg-red-500',    text: 'text-red-600 dark:text-red-400',    pillActive: 'bg-red-500 text-white',    pillIdle: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40' },
  due_soon:    { label: 'Due Soon',    badge: 'warning', dot: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400',  pillActive: 'bg-amber-500 text-white',  pillIdle: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40' },
  up_to_date:  { label: 'Up to Date',  badge: 'success', dot: 'bg-green-500',  text: 'text-green-600 dark:text-green-400',  pillActive: 'bg-green-500 text-white',  pillIdle: 'text-green-700 bg-green-50 dark:bg-green-950/40' },
  no_schedule: { label: 'No Schedule', badge: 'default', dot: 'bg-gray-300',   text: 'text-gray-500 dark:text-gray-400',   pillActive: 'bg-gray-700 text-white',   pillIdle: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800' },
}

function computeStatus(clientPools) {
  if (!clientPools.length) return 'no_schedule'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const soonCutoff = new Date(startOfToday)
  soonCutoff.setDate(soonCutoff.getDate() + 3)

  let hasSchedule = false
  let anyOverdue = false
  let anyDueSoon = false
  for (const p of clientPools) {
    if (!p.next_due_at) continue
    hasSchedule = true
    const due = new Date(p.next_due_at)
    if (due < startOfToday) anyOverdue = true
    else if (due <= soonCutoff) anyDueSoon = true
  }
  if (anyOverdue) return 'overdue'
  if (anyDueSoon) return 'due_soon'
  if (hasSchedule) return 'up_to_date'
  return 'no_schedule'
}

// ─── CLIENT CARD ───────────────────────────────────
function ClientCard({ client, clientPools, status, onClick }) {
  const initials = (client.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const st = STATUS[status]
  const poolCount = clientPools.length

  return (
    <Card onClick={onClick}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-brand shadow-sm shadow-pool-500/20 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-white">{initials}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{client.name}</h3>
            <Badge variant={st.badge} className="text-[10px] shrink-0">{st.label}</Badge>
          </div>

          {client.email && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{client.email}</p>}
          {client.phone && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{client.phone}</p>}

          <div className="flex items-center gap-1.5 mt-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full', st.dot)} />
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {poolCount} pool{poolCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Card>
  )
}

// ─── MAIN COMPONENT ────────────────────────────────
const emptyClient = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Clients() {
  const navigate = useNavigate()
  const { business } = useBusiness()
  const { clients, loading: clientsLoading, createClient } = useClients()
  const { pools, loading: poolsLoading } = usePools()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState(null)
  const [jobs, setJobs] = useState([])

  const loading = clientsLoading || poolsLoading

  // Fetch jobs for KPI strip + per-client services YTD + recent jobs panel
  useEffect(() => {
    if (!business?.id) return
    supabase
      .from('jobs')
      .select('id, client_id, status, scheduled_date, title')
      .eq('business_id', business.id)
      .then(({ data }) => setJobs(data || []))
  }, [business?.id])

  const startOfYear = useMemo(
    () => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    [],
  )

  const poolsByClient = useMemo(() => {
    const map = {}
    for (const p of pools) {
      if (!map[p.client_id]) map[p.client_id] = []
      map[p.client_id].push(p)
    }
    return map
  }, [pools])

  // Per-client completed-jobs count this calendar year
  const servicesYtdByClient = useMemo(() => {
    const map = {}
    for (const j of jobs) {
      if (j.status !== 'completed') continue
      if (!j.client_id) continue
      if (!j.scheduled_date || j.scheduled_date < startOfYear) continue
      map[j.client_id] = (map[j.client_id] || 0) + 1
    }
    return map
  }, [jobs, startOfYear])

  const recentJobsByClient = useMemo(() => {
    const map = {}
    const sorted = [...jobs].sort((a, b) =>
      (b.scheduled_date || '').localeCompare(a.scheduled_date || '')
    )
    for (const j of sorted) {
      if (!j.client_id) continue
      if (!map[j.client_id]) map[j.client_id] = []
      if (map[j.client_id].length < 4) map[j.client_id].push(j)
    }
    return map
  }, [jobs])

  const activeJobsCount = useMemo(
    () => jobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length,
    [jobs],
  )

  // Total completed services YTD (across all clients) — drives the KPI tile
  const servicesYtdTotal = useMemo(
    () => Object.values(servicesYtdByClient).reduce((sum, n) => sum + n, 0),
    [servicesYtdByClient],
  )

  const enriched = useMemo(() => {
    return clients.map(c => {
      const cp = poolsByClient[c.id] || []
      return {
        ...c,
        _pools: cp,
        _status: computeStatus(cp),
        _servicesYtd: servicesYtdByClient[c.id] || 0,
      }
    })
  }, [clients, poolsByClient, servicesYtdByClient])

  const counts = useMemo(() => ({
    all: enriched.length,
    overdue: enriched.filter(c => c._status === 'overdue').length,
    due_soon: enriched.filter(c => c._status === 'due_soon').length,
    up_to_date: enriched.filter(c => c._status === 'up_to_date').length,
    no_schedule: enriched.filter(c => c._status === 'no_schedule').length,
  }), [enriched])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(c => {
      if (filter !== 'all' && c._status !== filter) return false
      if (!q) return true
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      )
    })
  }, [enriched, filter, search])

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const created = await createClient({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      })
      if (!created?.id) throw new Error('No client ID returned')
      setModalOpen(false)
      setForm(emptyClient)
      navigate(`/clients/${created.id}?addPool=1`)
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setSaving(false)
    }
  }

  const filters = [
    { key: 'all',         label: 'All' },
    { key: 'overdue',     label: 'Overdue' },
    { key: 'due_soon',    label: 'Due Soon' },
    { key: 'up_to_date',  label: 'Up to Date' },
    { key: 'no_schedule', label: 'No Schedule' },
  ]

  const subtitle = counts.all === 0
    ? 'No clients yet'
    : `${counts.all} ${counts.all === 1 ? 'client' : 'clients'}${counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ''}`

  // Default detail-panel selection: first filtered client.
  // Reset if the current selection isn't in the filtered set.
  const selectedClient = useMemo(() => {
    if (!filtered.length) return null
    const found = filtered.find(c => c.id === selectedClientId)
    return found || filtered[0]
  }, [filtered, selectedClientId])

  return (
    <>
      <PageWrapper width="wide">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Users className="w-3.5 h-3.5" strokeWidth={2.5} />
              CRM
            </span>
          }
          title="Clients"
          subtitle={subtitle}
          action={
            <Button leftIcon={Plus} onClick={() => setModalOpen(true)}>
              Add Client
            </Button>
          }
        />

        {/* Mobile-only search (desktop search lives inside the table card) */}
        <div className="md:hidden mb-3">
          <Input
            placeholder="Search by name, email, phone, or address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter pills — uniform shape, single brand-tinted active */}
        <div className="flex flex-wrap gap-2 mb-4">
          {filters.map(f => {
            const active = filter === f.key
            const count = counts[f.key]
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
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

        {/* KPI strip */}
        {!loading && counts.all > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4">
            <StatCard label="Total clients" value={counts.all}      icon={Users}     iconTone="gray" />
            <StatCard label="Active jobs"   value={activeJobsCount} icon={Briefcase} iconTone="gray" />
            <Card tinted className="!p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Services YTD</p>
                  <p className="mt-2 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                    {servicesYtdTotal}
                  </p>
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Completed this year</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-pool-100 dark:bg-pool-900/50 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" strokeWidth={2} />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          search || filter !== 'all' ? (
            <EmptyState
              icon={<svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
              title="No results"
              description={search ? `No clients matching "${search}"` : 'No clients in this filter'}
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
          <>
            {/* MOBILE: stacked card list */}
            <div className="md:hidden space-y-2.5">
              {filtered.map(client => (
                <ClientCard
                  key={client.id}
                  client={client}
                  clientPools={client._pools}
                  status={client._status}
                  onClick={() => navigate(`/clients/${client.id}`)}
                />
              ))}
            </div>

            {/* DESKTOP: master-detail (table + sticky detail panel) */}
            <div className="hidden md:grid md:grid-cols-12 gap-4">
              {/* Table */}
              <Card className="!p-0 md:col-span-7 overflow-hidden">
                {/* Search bar inside the card */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" strokeWidth={2} />
                    <input
                      type="search"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search clients..."
                      className="w-full pl-9 pr-3 h-9 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-pool-500/30"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_9rem_5rem_7rem] gap-3 px-4 py-2 bg-gray-50/60 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <span>Client</span>
                  <span className="text-left">Status</span>
                  <span className="text-right">Pools</span>
                  <span className="text-right">Services YTD</span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filtered.map(client => {
                    const st = STATUS[client._status]
                    const isSelected = selectedClient && client.id === selectedClient.id
                    return (
                      <li key={client.id}>
                        <button
                          onClick={() => setSelectedClientId(client.id)}
                          onDoubleClick={() => navigate(`/clients/${client.id}`)}
                          className={cn(
                            'w-full grid grid-cols-[minmax(0,1fr)_9rem_5rem_7rem] gap-3 px-4 py-3 text-left transition-colors items-center',
                            isSelected
                              ? 'bg-pool-50 dark:bg-pool-950/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                          )}
                        >
                          <span className={cn(
                            'text-sm font-semibold truncate',
                            isSelected ? 'text-pool-700 dark:text-pool-300' : 'text-gray-900 dark:text-gray-100',
                          )}>
                            {client.name}
                          </span>
                          <span className={cn('text-left text-sm font-medium', st.text)}>
                            {st.label}
                          </span>
                          <span className="text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                            {client._pools.length || <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </span>
                          <span className="text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                            {client._servicesYtd > 0 ? client._servicesYtd : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Card>

              {/* Detail panel */}
              <div className="md:col-span-5">
                {selectedClient && (
                  <Card className="!p-5 sticky top-24">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pool-600 dark:text-pool-400 inline-flex items-center gap-2">
                        <Users className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Client detail
                      </p>
                      <Badge variant={STATUS[selectedClient._status].badge}>
                        {STATUS[selectedClient._status].label}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                      {selectedClient.name}
                    </h3>
                    {selectedClient.email && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{selectedClient.email}</p>
                    )}
                    {selectedClient.phone && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{selectedClient.phone}</p>
                    )}

                    <div className="grid grid-cols-2 gap-4 mt-5">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Pools</p>
                        <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none mt-1.5">
                          {selectedClient._pools.length}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Services YTD</p>
                        <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none mt-1.5">
                          {selectedClient._servicesYtd}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 inline-flex items-center gap-2 mb-2">
                        <Briefcase className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Recent jobs
                      </p>
                      {(recentJobsByClient[selectedClient.id] || []).length === 0 ? (
                        <p className="text-sm text-gray-400 dark:text-gray-500 italic">No jobs yet</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {(recentJobsByClient[selectedClient.id] || []).map(j => (
                            <li key={j.id} className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-gray-900 dark:text-gray-100 truncate">{j.title || 'Job'}</span>
                              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                                {j.scheduled_date ? formatDate(j.scheduled_date) : '—'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <button
                      onClick={() => navigate(`/clients/${selectedClient.id}`)}
                      className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 dark:hover:text-pool-300 transition-colors group"
                    >
                      Open profile
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
                    </button>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}

        {/* FAB */}
        {!loading && clients.length > 0 && (
          <button
            onClick={() => setModalOpen(true)}
            className="md:hidden fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20"
            aria-label="Add client"
          >
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
          <p className="text-xs text-center text-gray-400 dark:text-gray-500">You'll be taken to add their pool next</p>
        </form>
      </Modal>
    </>
  )
}
