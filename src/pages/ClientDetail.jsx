import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { supabase } from '../lib/supabase'
import {
  formatDate,
  getOverdueStatus,
  daysOverdue,
  statusDot,
  POOL_TYPES,
  POOL_SHAPES,
  SCHEDULE_FREQUENCIES,
} from '../lib/utils'

const emptyPool = {
  address: '',
  sameAsClient: false,
  type: 'chlorine',
  volume_litres: '',
  shape: 'rectangular',
  schedule_frequency: 'weekly',
  access_notes: '',
  pump_model: '',
  filter_type: '',
  heater: '',
  first_service_date: new Date().toISOString().split('T')[0],
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { updateClient, deleteClient } = useClients()
  const { pools, loading: poolsLoading, createPool } = usePools(id)

  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)

  // Edit client modal
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', address: '', notes: '', billing_frequency: '', service_rate: '' })
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Add pool modal
  const [poolModalOpen, setPoolModalOpen] = useState(false)
  const [poolForm, setPoolForm] = useState(emptyPool)
  const [poolSaving, setPoolSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase
      .from('clients')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('Error fetching client:', error)
          navigate('/clients')
          return
        }
        setClient(data)
        setEditForm({
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
          notes: data.notes || '',
          billing_frequency: data.billing_frequency || '',
          service_rate: data.service_rate || '',
        })
        setLoading(false)
      })
  }, [id, navigate])

  // Edit handlers
  const handleEditChange = (e) => {
    setEditForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    if (!editForm.name.trim()) return
    setEditSaving(true)
    try {
      const updated = await updateClient(id, editForm)
      setClient(updated)
      setEditOpen(false)
    } catch (err) {
      console.error('Error updating client:', err)
    } finally {
      setEditSaving(false)
    }
  }

  // Delete handler
  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteClient(id)
      navigate('/clients')
    } catch (err) {
      console.error('Error deleting client:', err)
    } finally {
      setDeleting(false)
    }
  }

  // Pool form handlers
  const handlePoolChange = (e) => {
    setPoolForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSameAsClient = (e) => {
    const checked = e.target.checked
    setPoolForm(prev => ({
      ...prev,
      sameAsClient: checked,
      address: checked ? (client?.address || '') : '',
    }))
  }

  const handlePoolSubmit = async (e) => {
    e.preventDefault()
    if (!poolForm.address.trim()) return
    setPoolSaving(true)
    try {
      const { pump_model, filter_type, heater, volume_litres, sameAsClient, route_day, first_service_date, ...rest } = poolForm
      await createPool({
        ...rest,
        client_id: id,
        volume_litres: volume_litres ? Number(volume_litres) : null,
        equipment: { pump_model, filter_type, heater },
        next_due_at: first_service_date || new Date().toISOString(),
      })
      setPoolModalOpen(false)
      setPoolForm(emptyPool)
    } catch (err) {
      console.error('Error creating pool:', err)
    } finally {
      setPoolSaving(false)
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Client" backTo="/clients" />
        <PageWrapper>
          <div className="flex justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-pool-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </PageWrapper>
      </>
    )
  }

  if (!client) return null

  const typeOptions = POOL_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))
  const shapeOptions = POOL_SHAPES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
  const freqOptions = SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1) }))
  const billingOptions = [
    { value: '', label: 'Not set' },
    { value: 'per_visit', label: 'Per visit' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'fortnightly', label: 'Fortnightly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
  ]

  return (
    <>
      <Header
        title={client.name}
        backTo="/clients"
        right={
          <div className="flex gap-1">
            <button
              onClick={() => setEditOpen(true)}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-full hover:bg-gray-100"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-full hover:bg-gray-100"
            >
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        }
      />
      <PageWrapper>
        {/* Client Info */}
        <Card className="p-4 mb-4">
          <div className="space-y-2">
            {client.email && (
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-gray-700 truncate">{client.email}</span>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span className="text-gray-700">{client.phone}</span>
              </div>
            )}
            {client.address && (
              <div className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-gray-700">{client.address}</span>
              </div>
            )}
            {(client.service_rate || client.billing_frequency) && (
              <div className="flex items-center gap-2 text-sm pt-1 border-t border-gray-100 mt-2">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-700">
                  {client.service_rate ? `$${client.service_rate}` : ''}
                  {client.service_rate && client.billing_frequency ? ' / ' : ''}
                  {client.billing_frequency ? client.billing_frequency.replace('_', ' ') : ''}
                </span>
              </div>
            )}
            {client.notes && (
              <p className="text-sm text-gray-500 pt-1 border-t border-gray-100 mt-2">
                {client.notes}
              </p>
            )}
          </div>
        </Card>

        {/* Pools Section */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Pools</h2>
          <Button
            variant="ghost"
            className="text-sm"
            onClick={() => setPoolModalOpen(true)}
          >
            + Add Pool
          </Button>
        </div>

        {poolsLoading ? (
          <div className="flex justify-center py-8">
            <svg className="animate-spin h-6 w-6 text-pool-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : pools.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
            title="No pools yet"
            description="Add a pool for this client"
            action="Add Pool"
            onAction={() => setPoolModalOpen(true)}
          />
        ) : (
          <div className="space-y-3">
            {pools.map(pool => {
              const overdueStatus = getOverdueStatus(pool.next_due_at)
              const overdueDays = daysOverdue(pool.next_due_at)
              return (
                <Card
                  key={pool.id}
                  onClick={() => navigate(`/pools/${pool.id}`)}
                  className="p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{pool.address}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={pool.type}>{pool.type}</Badge>
                        {pool.schedule_frequency && (
                          <span className="text-xs text-gray-400">{pool.schedule_frequency}</span>
                        )}
                        {pool.last_serviced_at && (
                          <span className="text-xs text-gray-500">
                            Last: {formatDate(pool.last_serviced_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    {overdueDays > 0 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-2.5 h-2.5 rounded-full ${statusDot(overdueStatus)}`} />
                        <span className="text-xs font-medium text-gray-600">
                          {overdueDays}d overdue
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Quick service button */}
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      className="w-full text-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/pools/${pool.id}/service`)
                      }}
                    >
                      Start Service
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </PageWrapper>

      {/* Edit Client Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Client">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <Input
            label="Name"
            name="name"
            value={editForm.name}
            onChange={handleEditChange}
            required
            placeholder="Full name"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            value={editForm.email}
            onChange={handleEditChange}
            placeholder="email@example.com"
          />
          <Input
            label="Phone"
            name="phone"
            type="tel"
            value={editForm.phone}
            onChange={handleEditChange}
            placeholder="0400 000 000"
          />
          <Input
            label="Address"
            name="address"
            value={editForm.address}
            onChange={handleEditChange}
            placeholder="Street address"
          />

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Pricing</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Service Rate ($)"
                name="service_rate"
                type="number"
                value={editForm.service_rate}
                onChange={handleEditChange}
                placeholder="e.g. 85"
              />
              <Select
                label="Billing Frequency"
                name="billing_frequency"
                value={editForm.billing_frequency}
                onChange={handleEditChange}
                options={billingOptions}
              />
            </div>
          </div>

          <TextArea
            label="Notes"
            name="notes"
            value={editForm.notes}
            onChange={handleEditChange}
            placeholder="Any additional notes..."
          />
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={editSaving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Client">
        <p className="text-sm text-gray-600 mb-2">
          Are you sure you want to delete <strong>{client.name}</strong>?
        </p>
        <p className="text-sm text-gray-500 mb-6">
          This will also delete all associated pools and service records. This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => setDeleteOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={deleting}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </Modal>

      {/* Add Pool Modal */}
      <Modal open={poolModalOpen} onClose={() => setPoolModalOpen(false)} title="Add Pool">
        <form onSubmit={handlePoolSubmit} className="space-y-4">
          {/* Same as client address checkbox */}
          {client.address && (
            <label className="flex items-center gap-2 min-h-tap cursor-pointer">
              <input
                type="checkbox"
                checked={poolForm.sameAsClient}
                onChange={handleSameAsClient}
                className="w-5 h-5 rounded border-gray-300 text-pool-500 focus:ring-pool-500"
              />
              <span className="text-sm text-gray-700">Same address as client</span>
            </label>
          )}

          <Input
            label="Pool Address"
            name="address"
            value={poolForm.address}
            onChange={handlePoolChange}
            required
            placeholder="Pool location address"
            disabled={poolForm.sameAsClient}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Pool Type"
              name="type"
              value={poolForm.type}
              onChange={handlePoolChange}
              options={typeOptions}
            />
            <Select
              label="Shape"
              name="shape"
              value={poolForm.shape}
              onChange={handlePoolChange}
              options={shapeOptions}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Volume (litres)"
              name="volume_litres"
              type="number"
              value={poolForm.volume_litres}
              onChange={handlePoolChange}
              placeholder="e.g. 50000"
            />
            <Select
              label="Schedule"
              name="schedule_frequency"
              value={poolForm.schedule_frequency}
              onChange={handlePoolChange}
              options={freqOptions}
            />
          </div>
          <Input
            label="First Service Date"
            name="first_service_date"
            type="date"
            value={poolForm.first_service_date}
            onChange={handlePoolChange}
          />
          <TextArea
            label="Access Notes"
            name="access_notes"
            value={poolForm.access_notes}
            onChange={handlePoolChange}
            placeholder="Gate code, dog, key location..."
          />

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Equipment</h3>
            <div className="space-y-3">
              <Input
                label="Pump Model"
                name="pump_model"
                value={poolForm.pump_model}
                onChange={handlePoolChange}
                placeholder="e.g. Astral CTX 280"
              />
              <Input
                label="Filter Type"
                name="filter_type"
                value={poolForm.filter_type}
                onChange={handlePoolChange}
                placeholder="e.g. Sand / Cartridge"
              />
              <Input
                label="Heater"
                name="heater"
                value={poolForm.heater}
                onChange={handlePoolChange}
                placeholder="e.g. Raypak 266A"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setPoolModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={poolSaving}>
              Add Pool
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
