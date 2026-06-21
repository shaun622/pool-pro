import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import CustomSelect from '../components/ui/CustomSelect'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useClients } from '../hooks/useClients'
import { usePools } from '../hooks/usePools'
import { useStaff } from '../hooks/useStaff'
import { useBusiness } from '../hooks/useBusiness'
import StaffCard from '../components/ui/StaffCard'
import LocationField from '../components/ui/LocationField'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/mapbox'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../components/PoolFormFields'
import EditPoolModal from '../components/ui/EditPoolModal'
import AddRecurringModal from '../components/ui/AddRecurringModal'
import { useToast } from '../contexts/ToastContext'
import { Briefcase, Calendar, ChevronRight, FileText, Mail, MapPin, Pencil, Phone, Plus, RotateCw, Trash2 } from 'lucide-react'
import {
  formatDate,
  getOverdueStatus,
  daysOverdue,
  statusDot,
  calculateNextDue,
  SCHEDULE_FREQUENCIES,
  FREQUENCY_LABELS,
  cn,
} from '../lib/utils'

export default function ClientDetail() {
  const toast = useToast()
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { updateClient, deleteClient } = useClients()
  const { pools, loading: poolsLoading, createPool, updatePool, deletePool, refetch: refetchPools } = usePools(id)
  const { staff: staffList, loading: staffLoading } = useStaff()
  const { business } = useBusiness()

  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recurringProfiles, setRecurringProfiles] = useState([])
  const [jobTypes, setJobTypes] = useState([])
  // The "Recurring services" cards open the SAME AddRecurringModal /recurring
  // uses (edit mode) — one shared module, no duplicate.
  const [recurEditProfile, setRecurEditProfile] = useState(null)
  const [recurModalOpen, setRecurModalOpen] = useState(false)

  // Edit client modal
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', address: '', notes: '', service_rate: '', assigned_staff_id: '', lat: null, lng: null })
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Add pool modal — auto-open if ?addPool=1
  const [poolModalOpen, setPoolModalOpen] = useState(false)

  useEffect(() => {
    if (searchParams.get('addPool') && !poolModalOpen) {
      setPoolModalOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams])
  const [poolForm, setPoolForm] = useState(emptyPool)
  const [poolSaving, setPoolSaving] = useState(false)
  const [poolToDelete, setPoolToDelete] = useState(null)
  const [poolToEdit, setPoolToEdit] = useState(null)
  const [poolDeleting, setPoolDeleting] = useState(false)


  // Create job modal
  const [jobModalOpen, setJobModalOpen] = useState(false)
  const [jobForm, setJobForm] = useState({ pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0], scheduled_time: '09:00', notes: '', price: '' })
  const [jobShowNewPool, setJobShowNewPool] = useState(false)
  const [jobNewPoolAddress, setJobNewPoolAddress] = useState('')
  const [jobNewPoolCoords, setJobNewPoolCoords] = useState({ lat: null, lng: null })
  const [jobNewPoolSaving, setJobNewPoolSaving] = useState(false)
  const [jobSaving, setJobSaving] = useState(false)
  const jobSubmittingRef = useRef(false)

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
          service_rate: data.service_rate || '',
          assigned_staff_id: data.assigned_staff_id || '',
          lat: data.latitude ?? null,
          lng: data.longitude ?? null,
        })
        setLoading(false)
      })
  }, [id, navigate])

  // Fetch this client's recurring services — full rows + pool join so the cards
  // can open the SAME edit modal /recurring uses. Refetched after a save.
  const loadRecurring = useCallback(() => {
    if (!id) return
    supabase
      .from('recurring_job_profiles')
      .select('*, pools(name, address)')
      .eq('client_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRecurringProfiles(data || []))
  }, [id])
  useEffect(() => { loadRecurring() }, [loadRecurring])

  // Job-type templates for the recurring modal's picker.
  useEffect(() => {
    if (!business?.id) return
    supabase
      .from('job_type_templates')
      .select('id, name, color, default_tasks, estimated_duration_minutes, default_price')
      .eq('business_id', business.id).eq('is_active', true)
      .then(({ data }) => setJobTypes(data || []))
  }, [business?.id])

  function openRecur(profile) {
    setRecurEditProfile(profile)
    setRecurModalOpen(true)
  }

  // Build a lookup: pool_id -> recurring profile (first per pool, for the pool
  // card's duration label).
  const profileByPool = {}
  for (const rp of recurringProfiles) {
    if (rp.pool_id) profileByPool[rp.pool_id] = rp
  }

  // Edit handlers
  const handleEditChange = (e) => {
    setEditForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    if (!editForm.name.trim()) return
    setEditSaving(true)
    try {
      // Sanitize: empty strings are invalid for numeric/uuid columns,
      // must be null so Postgres accepts the update.
      const updates = {
        name: editForm.name.trim(),
        email: editForm.email?.trim() || null,
        phone: editForm.phone?.trim() || null,
        address: editForm.address?.trim() || null,
        notes: editForm.notes?.trim() || null,
        service_rate: editForm.service_rate === '' || editForm.service_rate == null
          ? null
          : Number(editForm.service_rate),
        assigned_staff_id: editForm.assigned_staff_id || null,
        latitude: editForm.lat ?? null,
        longitude: editForm.lng ?? null,
        geocoded_at: editForm.lat != null ? new Date().toISOString() : null,
      }
      const updated = await updateClient(id, updates)
      setClient(updated)
      setEditOpen(false)
    } catch (err) {
      console.error('Error updating client:', err)
      toast.error(err?.message || 'Failed to save changes')
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

  const handlePoolSubmit = async (e) => {
    e.preventDefault()
    if (!poolForm.address.trim()) return
    setPoolSaving(true)
    try {
      const payload = await buildPoolPayload(poolForm)
      await createPool({ ...payload, client_id: id })
      setPoolModalOpen(false)
      setPoolForm(emptyPool)
    } catch (err) {
      console.error('Error creating pool:', err)
    } finally {
      setPoolSaving(false)
    }
  }

  const handleDeletePool = async () => {
    if (!poolToDelete) return
    setPoolDeleting(true)
    try {
      await deletePool(poolToDelete.id)
      setPoolToDelete(null)
    } catch (err) {
      console.error('Error deleting pool:', err)
      toast.error(err?.message || 'Failed to remove pool')
    } finally {
      setPoolDeleting(false)
    }
  }


  // Inline pool creation from Create Job modal
  const handleCreatePoolInline = async () => {
    if (!jobNewPoolAddress.trim()) return
    setJobNewPoolSaving(true)
    try {
      let { lat, lng } = jobNewPoolCoords
      if (lat == null || lng == null) {
        const geo = await geocodeAddress(jobNewPoolAddress.trim())
        lat = geo?.lat ?? null
        lng = geo?.lng ?? null
      }
      const created = await createPool({
        client_id: id,
        address: jobNewPoolAddress.trim(),
        latitude: lat,
        longitude: lng,
      })
      if (created?.id) {
        setJobForm(prev => ({ ...prev, pool_id: created.id }))
      }
      setJobNewPoolAddress('')
      setJobNewPoolCoords({ lat: null, lng: null })
      setJobShowNewPool(false)
    } catch (err) {
      console.error('Error creating pool inline:', err)
    } finally {
      setJobNewPoolSaving(false)
    }
  }

  // Create job handler
  const handleJobSubmit = async (e) => {
    e.preventDefault()
    if (!jobForm.title.trim()) return
    if (jobSubmittingRef.current) return // guard against double submission
    jobSubmittingRef.current = true
    setJobSaving(true)
    try {
      const { error } = await supabase.from('jobs').insert({
        business_id: client.business_id,
        client_id: id,
        pool_id: jobForm.pool_id || null,
        title: jobForm.title.trim(),
        status: 'scheduled',
        scheduled_date: jobForm.scheduled_date || null,
        scheduled_time: jobForm.scheduled_time || null,
        price: jobForm.price ? Number(jobForm.price) : null,
        notes: jobForm.notes.trim() || null,
      })
      if (error) throw error
      setJobModalOpen(false)
      setJobForm({ pool_id: '', title: '', scheduled_date: new Date().toISOString().split('T')[0], scheduled_time: '09:00', notes: '', price: '' })
      navigate('/work-orders')
    } catch (err) {
      console.error('Error creating job:', err)
    } finally {
      setJobSaving(false)
      jobSubmittingRef.current = false
    }
  }

  // Find assigned staff member
  const assignedStaff = staffList.find(s => s.id === client?.assigned_staff_id)

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


  return (
    <>
      <Header
        title={client.name}
        backTo="/clients"
        right={
          <div className="flex gap-1">
            <button
              onClick={() => setEditOpen(true)}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800"
            >
              <Pencil className="w-5 h-5 text-gray-600 dark:text-gray-400" strokeWidth={2} />
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800"
            >
              <Trash2 className="w-5 h-5 text-red-500" strokeWidth={2} />
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
                <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2} />
                <span className="text-gray-700 dark:text-gray-300 truncate">{client.email}</span>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2} />
                <span className="text-gray-700 dark:text-gray-300">{client.phone}</span>
              </div>
            )}
            {client.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" strokeWidth={2} />
                <span className="text-gray-700 dark:text-gray-300">{client.address}</span>
              </div>
            )}
            {client.service_rate && (
              <div className="flex items-center gap-2 text-sm pt-1 border-t border-gray-100 dark:border-gray-800 mt-2">
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-700 dark:text-gray-300">${client.service_rate}</span>
              </div>
            )}
            {client.notes && (
              <p className="text-sm text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800 mt-2">
                {client.notes}
              </p>
            )}
          </div>
        </Card>

        {/* Assigned Staff */}
        {assignedStaff && (
          <Card className="p-4 mb-4">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase font-semibold tracking-wide mb-2">Assigned Technician</p>
            <StaffCard staff={assignedStaff} variant="compact" />
          </Card>
        )}

        {/* Quick Actions */}
        <div className="flex gap-2 mb-4">
          <Button
            variant="secondary"
            className="flex-1 text-sm min-h-[44px]"
            onClick={() => {
              setJobForm(prev => ({ ...prev, pool_id: pools[0]?.id || '' }))
              setJobModalOpen(true)
            }}
          >
            <Briefcase className="w-4 h-4 mr-1.5 inline" strokeWidth={2} />
            Work Order
          </Button>
          <Button
            variant="secondary"
            className="flex-1 text-sm min-h-[44px]"
            onClick={() => navigate(`/quotes/new?client=${id}`)}
          >
            <FileText className="w-4 h-4 mr-1.5 inline" strokeWidth={2} />
            Create Quote
          </Button>
        </div>

        {/* Recurring Services Section — every schedule this client has, across
            all pools. Clicking one opens the SAME AddRecurringModal /recurring
            uses (edit mode). */}
        {recurringProfiles.length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Recurring services</h2>
            <div className="space-y-2">
              {recurringProfiles.map(rp => {
                const freq = FREQUENCY_LABELS[rp.recurrence_rule] || rp.recurrence_rule
                const st = rp.status || 'active'
                const stColor = st === 'active'
                  ? 'text-green-600 dark:text-green-400'
                  : st === 'paused' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'
                return (
                  <button key={rp.id} onClick={() => openRecur(rp)} className="block w-full text-left">
                    <Card className="p-3.5 hover:border-pool-200 dark:hover:border-pool-800 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <RotateCw className="w-4 h-4 text-pool-500 shrink-0" strokeWidth={2} />
                            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{rp.pools?.name || 'Pool'}</p>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {freq}{rp.next_generation_at ? ` · Next ${formatDate(rp.next_generation_at)}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn('text-xs font-semibold capitalize', stColor)}>{st}</span>
                          <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" strokeWidth={2} />
                        </div>
                      </div>
                    </Card>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Pools Section */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pools</h2>
          <button
            onClick={() => setPoolModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pool-50 dark:bg-pool-950/40 border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-100 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
            Add Pool
          </button>
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
              const poolStaff = staffList.find(s => s.id === pool.assigned_staff_id)
              return (
                <Card key={pool.id} className="p-4">
                  {/* Tappable pool info area */}
                  <div
                    onClick={() => navigate(`/pools/${pool.id}`)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {pool.name && (
                          <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{pool.name}</p>
                        )}
                        <p className={cn('truncate', pool.name ? 'text-xs text-gray-500 dark:text-gray-400' : 'font-medium text-gray-900 dark:text-gray-100')}>{pool.address}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant={pool.type}>{pool.type}</Badge>
                          {pool.schedule_frequency && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}
                              {profileByPool[pool.id] && (() => {
                                const rp = profileByPool[pool.id]
                                if (!rp.duration_type || rp.duration_type === 'ongoing') return ' · Ongoing'
                                if (rp.duration_type === 'until_date' && rp.end_date) return ` · Until ${new Date(rp.end_date).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`
                                if (rp.duration_type === 'num_visits' && rp.total_visits) return ` · ${rp.completed_visits || 0}/${rp.total_visits} visits`
                                return ''
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                      {overdueDays > 0 && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-2.5 h-2.5 rounded-full ${statusDot(overdueStatus)}`} />
                          <span className="text-xs font-medium text-red-600 dark:text-red-400">
                            {overdueDays}d overdue
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Service dates row */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {pool.last_serviced_at && (
                        <span>Last: {formatDate(pool.last_serviced_at)}</span>
                      )}
                      {pool.next_due_at && (
                        <span className={cn(overdueDays > 0 ? 'text-red-500 font-medium' : 'text-pool-600 dark:text-pool-400')}>
                          Next: {formatDate(pool.next_due_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Assigned tech */}
                  <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {poolStaff?.photo_url ? (
                      <img src={poolStaff.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : poolStaff ? (
                      <div className="w-7 h-7 rounded-full bg-pool-100 text-pool-600 dark:text-pool-400 flex items-center justify-center text-xs font-bold">
                        {poolStaff.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    ) : null}
                    <CustomSelect
                      inline
                      value={pool.assigned_staff_id || ''}
                      onChange={async (e) => {
                        const val = e.target.value || null
                        await updatePool(pool.id, { assigned_staff_id: val })
                      }}
                      placeholder="Assign technician..."
                      options={[{ value: '', label: 'Assign technician...' }, ...staffList.filter(s => s.is_active).map(s => ({ value: s.id, label: s.name }))]}
                      className="flex-1"
                    />
                  </div>

                  {/* Action buttons — servicing happens from the Schedule (with
                      occurrence identity), not a generic pool-level Start. */}
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      aria-label="Edit pool"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPoolToEdit(pool)
                      }}
                      className="shrink-0 w-11 h-11 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-pool-50 hover:border-pool-200 hover:text-pool-600 transition-colors flex items-center justify-center"
                    >
                      <Pencil className="w-4 h-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove pool"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPoolToDelete(pool)
                      }}
                      className="shrink-0 w-11 h-11 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* Quotes Section */}
        <QuotesSection clientId={id} navigate={navigate} />

        {/* Invoices Section */}
        <InvoicesSection clientId={id} navigate={navigate} />
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
          <LocationField
            label="Address"
            placeholder="Street address"
            address={editForm.address}
            lat={editForm.lat}
            lng={editForm.lng}
            onChange={({ address, lat, lng }) => setEditForm(prev => ({ ...prev, address, lat, lng }))}
          />

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Pricing</h3>
            <Input
              label="Service Rate ($) (optional)"
              name="service_rate"
              type="number"
              value={editForm.service_rate}
              onChange={handleEditChange}
              placeholder="e.g. 85"
            />
          </div>

          {/* Staff Assignment */}
          {staffList.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Staff Assignment</h3>
              <Select
                label="Assigned Technician"
                name="assigned_staff_id"
                value={editForm.assigned_staff_id}
                onChange={handleEditChange}
                options={[
                  { value: '', label: 'Not assigned' },
                  ...staffList.filter(s => s.is_active).map(s => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          )}

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
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Are you sure you want to delete <strong>{client.name}</strong>?
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
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

      {/* Remove Pool Confirmation Modal */}
      <Modal open={!!poolToDelete} onClose={() => !poolDeleting && setPoolToDelete(null)} title="Remove Pool">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Are you sure you want to remove <strong>{poolToDelete?.address}</strong>?
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          This will also delete all associated service records for this pool. This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => setPoolToDelete(null)}
            disabled={poolDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={poolDeleting}
            onClick={handleDeletePool}
          >
            Remove
          </Button>
        </div>
      </Modal>

      {/* Edit Pool Modal — attribute edits (name/address/details); the
          pool's schedule stays managed by the recurring flow + Schedule modal. */}
      <EditPoolModal
        open={!!poolToEdit}
        onClose={() => setPoolToEdit(null)}
        pool={poolToEdit}
        onSaved={() => { setPoolToEdit(null); refetchPools() }}
      />

      {/* The EXACT recurring-service editor /recurring uses — one shared module. */}
      <AddRecurringModal
        open={recurModalOpen}
        onClose={() => { setRecurModalOpen(false); setRecurEditProfile(null) }}
        business={business}
        staff={staffList}
        jobTypes={jobTypes}
        editProfile={recurEditProfile}
        onCreated={() => { setRecurModalOpen(false); setRecurEditProfile(null); loadRecurring(); refetchPools() }}
      />


      {/* Create Work Order Modal */}
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title="New Work Order">
        <form onSubmit={handleJobSubmit} className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{client?.name}</p>
            {client?.address && <p className="text-xs text-gray-500 dark:text-gray-400">{client.address}</p>}
          </div>
          <div>
            {!jobShowNewPool ? (
              <>
                <Select
                  label="Pool"
                  name="pool_id"
                  value={jobForm.pool_id}
                  onChange={e => setJobForm(prev => ({ ...prev, pool_id: e.target.value }))}
                  options={[
                    { value: '', label: pools.length ? 'No specific pool' : 'No pools yet' },
                    ...pools.map(p => ({ value: p.id, label: p.name ? `${p.name} — ${p.address}` : p.address })),
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setJobShowNewPool(true)}
                  className="mt-1.5 text-xs font-medium text-pool-600 dark:text-pool-400 hover:text-pool-700"
                >
                  + Add new pool
                </button>
              </>
            ) : (
              <div
                className="space-y-2 animate-fade-in"
                onKeyDown={(e) => {
                  // Prevent Enter inside the autocomplete from submitting the outer Create Job form
                  if (e.key === 'Enter') e.preventDefault()
                }}
              >
                <LocationField
                  label="New pool address"
                  placeholder="Start typing a street address..."
                  address={jobNewPoolAddress}
                  lat={jobNewPoolCoords.lat}
                  lng={jobNewPoolCoords.lng}
                  onChange={({ address, lat, lng }) => {
                    setJobNewPoolAddress(address)
                    setJobNewPoolCoords({ lat, lng })
                  }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); handleCreatePoolInline() }}
                    disabled={!jobNewPoolAddress.trim() || jobNewPoolSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-brand text-white text-sm font-semibold shadow-md shadow-pool-500/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all min-h-tap"
                  >
                    {jobNewPoolSaving ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : 'Add Pool'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      setJobShowNewPool(false)
                      setJobNewPoolAddress('')
                      setJobNewPoolCoords({ lat: null, lng: null })
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-tap"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <Input
            label="Job Title"
            value={jobForm.title}
            onChange={e => setJobForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="e.g. Filter replacement, Green pool cleanup"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={jobForm.scheduled_date}
              onChange={e => setJobForm(prev => ({ ...prev, scheduled_date: e.target.value }))}
            />
            <Input
              label="Time"
              type="time"
              value={jobForm.scheduled_time}
              onChange={e => setJobForm(prev => ({ ...prev, scheduled_time: e.target.value }))}
            />
          </div>
          <Input
            label="Price ($)"
            type="number"
            value={jobForm.price}
            onChange={e => setJobForm(prev => ({ ...prev, price: e.target.value }))}
            placeholder="Optional"
          />
          <TextArea
            label="Notes"
            value={jobForm.notes}
            onChange={e => setJobForm(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Job details..."
            rows={2}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setJobModalOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={jobSaving}>Create Job</Button>
          </div>
        </form>
      </Modal>

      {/* Add Pool Modal */}
      <Modal open={poolModalOpen} onClose={() => setPoolModalOpen(false)} title="Add Pool">
        <form onSubmit={handlePoolSubmit} className="space-y-4">
          <PoolFormFields
            poolForm={poolForm}
            setPoolForm={setPoolForm}
            clientAddress={client.address}
          />
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

// ─── Quotes Section (fetches its own data) ────────
const QUOTE_STATUS_BADGE = { draft: 'default', sent: 'primary', accepted: 'success', declined: 'danger', expired: 'default' }
const QUOTE_STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' }

function QuotesSection({ clientId, navigate }) {
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    supabase
      .from('quotes')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setQuotes(data || [])
        setLoading(false)
      })
  }, [clientId])

  const quoteTotal = (q) => (q.line_items || []).reduce((s, i) => s + (i.amount || (i.quantity || 0) * (i.unit_price || 0) || 0), 0)

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Quotes</h2>
        <button
          onClick={() => navigate(`/quotes/new?client=${clientId}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pool-50 dark:bg-pool-950/40 border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-100 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
          Create Quote
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : quotes.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No quotes for this client</p>
      ) : (
        <div className="space-y-2">
          {quotes.map(q => {
            const st = QUOTE_STATUS_BADGE[q.status] || 'default'
            const label = QUOTE_STATUS_LABEL[q.status] || q.status
            const total = quoteTotal(q)
            return (
              <Card key={q.id} onClick={() => navigate(`/quotes/${q.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {q.title || `Quote #${q.id.slice(0, 6)}`}
                      </p>
                      <Badge variant={st} className="text-[10px] shrink-0">{label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatDate(q.created_at)}</span>
                      {total > 0 && <span className="font-semibold text-gray-700 dark:text-gray-300">${total.toFixed(2)}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" strokeWidth={2} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Invoices Section (fetches its own data) ────────
const INVOICE_STATUS_BADGE = { draft: 'default', sent: 'primary', paid: 'success', overdue: 'danger', void: 'default' }
const INVOICE_STATUS_LABEL = { draft: 'Draft', sent: 'Invoice Sent', paid: 'Paid', overdue: 'Overdue', void: 'Void' }

function InvoicesSection({ clientId, navigate }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    supabase
      .from('invoices')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setInvoices(data || [])
        setLoading(false)
      })
  }, [clientId])

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Invoices</h2>
        <button
          onClick={() => navigate(`/invoices/new?client=${clientId}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pool-50 dark:bg-pool-950/40 border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-100 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
          Create Invoice
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No invoices for this client</p>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const st = INVOICE_STATUS_BADGE[inv.status] || 'default'
            const label = INVOICE_STATUS_LABEL[inv.status] || inv.status
            return (
              <Card key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {inv.invoice_number || `Invoice #${inv.id.slice(0, 6)}`}
                      </p>
                      <Badge variant={st} className="text-[10px] shrink-0">{label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatDate(inv.issued_date || inv.created_at)}</span>
                      {inv.total > 0 && <span className="font-semibold text-gray-700 dark:text-gray-300">${Number(inv.total).toFixed(2)}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" strokeWidth={2} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
