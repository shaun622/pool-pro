import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea } from '../components/ui/Input'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { cn } from '../lib/utils'

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
  const { clients, loading: clientsLoading, createClient } = useClients()
  const { pools, loading: poolsLoading } = usePools()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)

  const loading = clientsLoading || poolsLoading

  const poolsByClient = useMemo(() => {
    const map = {}
    for (const p of pools) {
      if (!map[p.client_id]) map[p.client_id] = []
      map[p.client_id].push(p)
    }
    return map
  }, [pools])

  const enriched = useMemo(() => {
    return clients.map(c => {
      const cp = poolsByClient[c.id] || []
      return { ...c, _pools: cp, _status: computeStatus(cp) }
    })
  }, [clients, poolsByClient])

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

  return (
    <>
      <PageWrapper width="wide">
        <PageHero
          title="Clients"
          subtitle={subtitle}
          action={
            <Button leftIcon={Plus} onClick={() => setModalOpen(true)}>
              Add Client
            </Button>
          }
        />

        {/* Search */}
        <div className="mb-3">
          <Input
            placeholder="Search by name, email, phone, or address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {filters.map(f => {
            const active = filter === f.key
            const count = counts[f.key]
            const st = f.key === 'all' ? null : STATUS[f.key]
            const activeClass = f.key === 'all'
              ? 'bg-gradient-brand text-white shadow-md shadow-pool-500/20'
              : st.pillActive
            const idleClass = f.key === 'all'
              ? 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
              : st.pillIdle
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all flex items-center gap-1.5',
                  active ? activeClass : idleClass
                )}
              >
                <span>{f.label}</span>
                <span className={cn('text-[10px] font-bold opacity-80')}>{count}</span>
              </button>
            )
          })}
        </div>

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
          <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
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
