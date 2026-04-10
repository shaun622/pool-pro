import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
import { useStaff } from '../hooks/useStaff'
import StaffCard from '../components/ui/StaffCard'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/mapbox'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../components/PoolFormFields'
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
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { updateClient, deleteClient } = useClients()
  const { pools, loading: poolsLoading, createPool, updatePool, deletePool } = usePools(id)
  const { staff: staffList, loading: staffLoading } = useStaff()

  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)

  // Edit client modal
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', address: '', notes: '', service_rate: '', assigned_staff_id: '' })
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
  const [poolDeleting, setPoolDeleting] = useState(false)

  // Schedule modal
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [schedulePoolId, setSchedulePoolId] = useState(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleFreq, setScheduleFreq] = useState('weekly')
  const [scheduleRecurring, setScheduleRecurring] = useState(true)
  const [schedulePrice, setSchedulePrice] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleSaving, setScheduleSaving] = useState(false)

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
      }
      const updated = await updateClient(id, updates)
      setClient(updated)
      setEditOpen(false)
    } catch (err) {
      console.error('Error updating client:', err)
      alert(err?.message || 'Failed to save changes')
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
      alert(err?.message || 'Failed to remove pool')
    } finally {
      setPoolDeleting(false)
    }
  }

  // Schedule handler
  const openSchedule = (poolId) => {
    setSchedulePoolId(poolId)
    const pool = pools.find(p => p.id === poolId)
    setScheduleDate(pool?.next_due_at ? new Date(pool.next_due_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0])
    setScheduleFreq(pool?.schedule_frequency || 'weekly')
    setScheduleRecurring(!!pool?.schedule_frequency)
    setSchedulePrice(
      pool?.service_price != null
        ? String(pool.service_price)
        : (client?.service_rate != null && client?.service_rate !== '' ? String(client.service_rate) : '')
    )
    setScheduleTime('09:00')
    setScheduleOpen(true)
  }

  const handleQuickDate = (option) => {
    const today = new Date()
    let d
    switch (option) {
      case 'today': d = today; break
      case 'tomorrow': d = new Date(today); d.setDate(d.getDate() + 1); break
      case 'next_monday': {
        d = new Date(today)
        const day = d.getDay()
        d.setDate(d.getDate() + ((8 - day) % 7 || 7))
        break
      }
      case 'next_week': d = new Date(today); d.setDate(d.getDate() + 7); break
      case 'in_2_weeks': d = new Date(today); d.setDate(d.getDate() + 14); break
      case 'next_month': d = new Date(today); d.setMonth(d.getMonth() + 1); break
      default: return
    }
    setScheduleDate(d.toISOString().split('T')[0])
  }

  const handleScheduleSave = async () => {
    if (!scheduleDate || !schedulePoolId) return
    setScheduleSaving(true)
    try {
      await updatePool(schedulePoolId, {
        next_due_at: new Date(scheduleDate).toISOString(),
        schedule_frequency: scheduleRecurring ? scheduleFreq : null,
        service_price: schedulePrice ? Number(schedulePrice) : null,
      })
    } catch (err) {
      console.error('Error scheduling:', err)
    } finally {
      setScheduleSaving(false)
      setScheduleOpen(false)
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
        next_due_at: new Date().toISOString(),
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
      navigate('/jobs')
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
            {client.service_rate && (
              <div className="flex items-center gap-2 text-sm pt-1 border-t border-gray-100 mt-2">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-700">${client.service_rate}</span>
              </div>
            )}
            {client.notes && (
              <p className="text-sm text-gray-500 pt-1 border-t border-gray-100 mt-2">
                {client.notes}
              </p>
            )}
          </div>
        </Card>

        {/* Assigned Staff */}
        {assignedStaff && (
          <Card className="p-4 mb-4">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">Assigned Technician</p>
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
            <svg className="w-4 h-4 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Create Job
          </Button>
          <Button
            variant="secondary"
            className="flex-1 text-sm min-h-[44px]"
            onClick={() => navigate(`/quotes/new?client=${id}`)}
          >
            <svg className="w-4 h-4 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Create Quote
          </Button>
        </div>

        {/* Pools Section */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Pools</h2>
          <button
            onClick={() => setPoolModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pool-50 border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-100 active:scale-[0.98] transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
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
                        <p className="font-medium text-gray-900 truncate">{pool.address}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant={pool.type}>{pool.type}</Badge>
                          {pool.schedule_frequency && (
                            <span className="text-xs text-gray-400">{FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}</span>
                          )}
                        </div>
                      </div>
                      {overdueDays > 0 && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`w-2.5 h-2.5 rounded-full ${statusDot(overdueStatus)}`} />
                          <span className="text-xs font-medium text-red-600">
                            {overdueDays}d overdue
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Service dates row */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      {pool.last_serviced_at && (
                        <span>Last: {formatDate(pool.last_serviced_at)}</span>
                      )}
                      {pool.next_due_at && (
                        <span className={cn(overdueDays > 0 ? 'text-red-500 font-medium' : 'text-pool-600')}>
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
                      <div className="w-7 h-7 rounded-full bg-pool-100 text-pool-600 flex items-center justify-center text-xs font-bold">
                        {poolStaff.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    ) : null}
                    <select
                      value={pool.assigned_staff_id || ''}
                      onChange={async (e) => {
                        const val = e.target.value || null
                        await updatePool(pool.id, { assigned_staff_id: val })
                      }}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 min-h-[36px]"
                    >
                      <option value="">Assign technician...</option>
                      {staffList.filter(s => s.is_active).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="secondary"
                      className="flex-1 text-sm min-h-[44px]"
                      onClick={(e) => {
                        e.stopPropagation()
                        openSchedule(pool.id)
                      }}
                    >
                      <svg className="w-4 h-4 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Schedule
                    </Button>
                    <Button
                      className="flex-1 text-sm min-h-[44px]"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/pools/${pool.id}/service${pool.assigned_staff_id ? `?staff=${pool.assigned_staff_id}` : ''}`)
                      }}
                    >
                      <svg className="w-4 h-4 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Start Service
                    </Button>
                    <button
                      type="button"
                      aria-label="Remove pool"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPoolToDelete(pool)
                      }}
                      className="shrink-0 w-11 h-11 rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors flex items-center justify-center"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
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
          <AddressAutocomplete
            label="Address"
            value={editForm.address}
            onChange={(v) => setEditForm(prev => ({ ...prev, address: v }))}
            onSelect={({ address }) => setEditForm(prev => ({ ...prev, address }))}
            placeholder="Street address"
          />

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Pricing</h3>
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
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Staff Assignment</h3>
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

      {/* Remove Pool Confirmation Modal */}
      <Modal open={!!poolToDelete} onClose={() => !poolDeleting && setPoolToDelete(null)} title="Remove Pool">
        <p className="text-sm text-gray-600 mb-2">
          Are you sure you want to remove <strong>{poolToDelete?.address}</strong>?
        </p>
        <p className="text-sm text-gray-500 mb-6">
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

      {/* Schedule Modal */}
      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule Service">
        <div className="space-y-4">
          {/* Quick pick options */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Quick Pick</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'today', label: 'Today' },
                { key: 'tomorrow', label: 'Tomorrow' },
                { key: 'next_monday', label: 'Next Monday' },
                { key: 'next_week', label: 'In 1 Week' },
                { key: 'in_2_weeks', label: 'In 2 Weeks' },
                { key: 'next_month', label: 'In 1 Month' },
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleQuickDate(opt.key)}
                  className="px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-pool-50 hover:border-pool-300 hover:text-pool-700 transition-colors min-h-[44px]"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date picker */}
          <Input
            label="Or pick a date"
            type="date"
            value={scheduleDate}
            onChange={e => setScheduleDate(e.target.value)}
          />

          {/* Recurring toggle */}
          <label className="flex items-center justify-between min-h-tap cursor-pointer">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Recurring service</span>
            </div>
            <div className={cn('relative w-11 h-6 rounded-full transition-colors',
              scheduleRecurring ? 'bg-pool-500' : 'bg-gray-200')}>
              <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                scheduleRecurring ? 'translate-x-[22px]' : 'translate-x-0.5')} />
              <input type="checkbox" className="sr-only"
                checked={scheduleRecurring}
                onChange={e => setScheduleRecurring(e.target.checked)} />
            </div>
          </label>

          {/* Frequency (only when recurring) */}
          {scheduleRecurring && (
            <Select
              label="Repeats"
              value={scheduleFreq}
              onChange={e => setScheduleFreq(e.target.value)}
              options={SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: FREQUENCY_LABELS[f] || f }))}
            />
          )}

          {/* Service price */}
          <Input
            label={scheduleRecurring ? 'Price per service ($)' : 'Service price ($)'}
            type="number"
            value={schedulePrice}
            onChange={e => setSchedulePrice(e.target.value)}
            placeholder="Optional"
          />

          {/* Summary */}
          {scheduleDate && (
            <div className="bg-pool-50 border border-pool-200 rounded-lg p-3">
              <p className="text-sm text-pool-700">
                <span className="font-semibold">Next service:</span>{' '}
                {new Date(scheduleDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <p className="text-xs text-pool-500 mt-1">
                {scheduleRecurring
                  ? `Repeating ${(FREQUENCY_LABELS[scheduleFreq] || scheduleFreq).toLowerCase()}`
                  : 'One-off service (no repeat)'}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1 min-h-tap"
              onClick={() => setScheduleOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 min-h-tap"
              onClick={handleScheduleSave}
              loading={scheduleSaving}
            >
              Save Schedule
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Job Modal */}
      <Modal open={jobModalOpen} onClose={() => setJobModalOpen(false)} title="Create Job">
        <form onSubmit={handleJobSubmit} className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 mb-1">
            <p className="text-sm font-medium text-gray-900">{client?.name}</p>
            {client?.address && <p className="text-xs text-gray-500">{client.address}</p>}
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
                    ...pools.map(p => ({ value: p.id, label: p.address })),
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setJobShowNewPool(true)}
                  className="mt-1.5 text-xs font-medium text-pool-600 hover:text-pool-700"
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
                <AddressAutocomplete
                  label="New pool address"
                  value={jobNewPoolAddress}
                  onChange={(v) => {
                    setJobNewPoolAddress(v)
                    setJobNewPoolCoords({ lat: null, lng: null })
                  }}
                  onSelect={({ address, lat, lng }) => {
                    setJobNewPoolAddress(address)
                    setJobNewPoolCoords({ lat, lng })
                  }}
                  placeholder="Start typing a street address..."
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
                    className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 min-h-tap"
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
