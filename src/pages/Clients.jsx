import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { cn } from '../lib/utils'

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
          {client.email && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{client.email}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            'text-xs font-semibold px-2.5 py-1 rounded-lg',
            poolCount > 0 ? 'bg-pool-50 text-pool-600' : 'bg-gray-50 text-gray-400'
          )}>
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

const emptyClient = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Clients() {
  const navigate = useNavigate()
  const { clients, loading, createClient } = useClients()
  const { pools } = usePools()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyClient)
  const [saving, setSaving] = useState(false)

  const poolCounts = pools.reduce((acc, pool) => {
    acc[pool.client_id] = (acc[pool.client_id] || 0) + 1
    return acc
  }, {})

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

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
      <Header title="Clients" />
      <PageWrapper>
        {/* Search */}
        <div className="mb-5">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          search ? (
            <EmptyState
              icon={
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              title="No results"
              description={`No clients matching "${search}"`}
            />
          ) : (
            <EmptyState
              icon={
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
              title="No clients yet"
              description="Add your first client to get started"
              action="Add Client"
              onAction={() => setModalOpen(true)}
            />
          )
        ) : (
          <div className="space-y-2.5">
            {filtered.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                poolCount={poolCounts[client.id] || 0}
                onClick={() => navigate(`/clients/${client.id}`)}
              />
            ))}
          </div>
        )}

        {/* Floating add button */}
        {!loading && clients.length > 0 && (
          <button
            onClick={() => setModalOpen(true)}
            className="fixed bottom-20 right-4 w-14 h-14 bg-gradient-brand text-white rounded-2xl shadow-elevated shadow-pool-500/30 flex items-center justify-center hover:shadow-glow active:scale-95 transition-all duration-200 z-20"
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </PageWrapper>

      {/* Add Client Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Client">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            placeholder="Full name"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="email@example.com"
          />
          <Input
            label="Phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            placeholder="0400 000 000"
          />
          <Input
            label="Address"
            name="address"
            value={form.address}
            onChange={handleChange}
            placeholder="Street address"
          />
          <TextArea
            label="Notes"
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Any additional notes..."
          />
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              Add Client
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
