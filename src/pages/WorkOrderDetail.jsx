import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { Select, TextArea } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import ConfirmModal from '../components/ui/ConfirmModal'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency, cn } from '../lib/utils'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../lib/mapbox'
import { useToast } from '../contexts/ToastContext'

// Numbered pin factory (matches StopDetailModal)
function pinIcon(color = '#0CA5EB') {
  return L.divIcon({
    className: 'numbered-pin',
    html: `<div style="
      background:${color};color:white;width:34px;height:34px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
      border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);
    "><svg style="transform:rotate(45deg);width:14px;height:14px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z"/></svg></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  })
}

const JOB_STATUS_BADGE = {
  scheduled: 'primary',
  in_progress: 'warning',
  on_hold: 'default',
  completed: 'success',
}

const JOB_STATUS_LABEL = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
}

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
]

export default function JobDetail() {
  const toast = useToast()
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [staffList, setStaffList] = useState([])
  const [showAddTech, setShowAddTech] = useState(false)
  const [newTechForm, setNewTechForm] = useState({ name: '', email: '', phone: '', role: 'tech' })
  const [newTechSaving, setNewTechSaving] = useState(false)

  useEffect(() => {
    loadJob()
  }, [id])

  async function loadJob() {
    setLoading(true)
    try {
      // Fetch job first
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .single()

      if (jobError) throw jobError

      // Fetch related data in parallel
      const promises = []

      if (jobData.client_id) {
        promises.push(
          supabase.from('clients').select('id, name, email, phone, address')
            .eq('id', jobData.client_id).single().then(r => ({ clients: r.data }))
        )
      }
      if (jobData.pool_id) {
        promises.push(
          supabase.from('pools').select('id, address, pool_type, type, latitude, longitude')
            .eq('id', jobData.pool_id).single().then(r => ({ pools: r.data }))
        )
      }
      if (jobData.quote_id) {
        promises.push(
          supabase.from('quotes').select('id, line_items, scope, total, status, responded_at')
            .eq('id', jobData.quote_id).single().then(r => ({ quote: r.data }))
        )
      }

      const results = await Promise.all(promises)
      const related = results.reduce((acc, r) => ({ ...acc, ...r }), {})

      setJob({ ...jobData, clients: related.clients || null, pools: related.pools || null })
      if (related.quote) setQuote(related.quote)
    } catch (err) {
      console.error('Error loading job:', err)
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(newStatus) {
    setStatusUpdating(true)
    try {
      const updates = { status: newStatus }
      if (newStatus === 'completed') {
        updates.completed_at = new Date().toISOString()
      }
      const { error } = await supabase
        .from('jobs')
        .update(updates)
        .eq('id', id)
      if (error) throw error
      setJob(prev => ({ ...prev, ...updates }))

      // Log activity
      await supabase.from('activity_feed').insert({
        business_id: job.business_id,
        type: newStatus === 'completed' ? 'job_completed' : 'job_updated',
        title: newStatus === 'completed'
          ? `Job completed: ${job.title}`
          : `Job status changed to ${JOB_STATUS_LABEL[newStatus]}`,
        description: job.clients?.name || '',
        link_to: `/work-orders/${id}`,
      })
    } catch (err) {
      console.error('Error updating status:', err)
    } finally {
      setStatusUpdating(false)
    }
  }

  function openEditModal() {
    setEditForm({
      title: job.title || '',
      scheduled_date: job.scheduled_date || '',
      scheduled_time: job.scheduled_time || '',
      price: job.price || '',
      notes: job.notes || '',
      status: job.status || 'scheduled',
      assigned_staff_id: job.assigned_staff_id || '',
    })
    setShowAddTech(false)
    // Fetch staff if not loaded
    if (!staffList.length && job.business_id) {
      supabase.from('staff_members').select('id, name').eq('business_id', job.business_id).eq('is_active', true).order('name')
        .then(({ data }) => setStaffList(data || []))
    }
    setEditModalOpen(true)
  }

  async function handleAddTech() {
    if (!newTechForm.name.trim() || !job.business_id) return
    setNewTechSaving(true)
    try {
      const { data, error } = await supabase
        .from('staff_members')
        .insert({ ...newTechForm, business_id: job.business_id })
        .select('id, name')
        .single()
      if (error) throw error
      setStaffList(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setEditForm(f => ({ ...f, assigned_staff_id: data.id }))
      setShowAddTech(false)
      setNewTechForm({ name: '', email: '', phone: '', role: 'tech' })
    } catch (err) {
      console.error('Error adding technician:', err)
      toast.error(err.message || 'Failed to add technician')
    } finally {
      setNewTechSaving(false)
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const updates = {
        title: editForm.title.trim(),
        scheduled_date: editForm.scheduled_date || null,
        scheduled_time: editForm.scheduled_time || null,
        price: editForm.price ? Number(editForm.price) : null,
        notes: editForm.notes.trim() || null,
        status: editForm.status,
        assigned_staff_id: editForm.assigned_staff_id || null,
      }
      if (editForm.status === 'completed' && job.status !== 'completed') {
        updates.completed_at = new Date().toISOString()
      }
      const { error } = await supabase.from('jobs').update(updates).eq('id', id)
      if (error) throw error
      setJob(prev => ({ ...prev, ...updates }))
      setEditModalOpen(false)
    } catch (err) {
      console.error('Error updating job:', err)
    } finally {
      setSaving(false)
    }
  }

  async function deleteJob() {
    const { error } = await supabase.from('jobs').delete().eq('id', id)
    if (error) { console.error('Error deleting job:', error); throw error }
    navigate('/work-orders', { replace: true })
  }

  const headerAction = job ? (
    <button onClick={openEditModal}
      className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800/80 transition-colors">
      <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    </button>
  ) : null

  if (loading) {
    return (
      <>
        <Header title="Work Order" backTo="/work-orders" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  if (!job) {
    return (
      <>
        <Header title="Work Order" backTo="/work-orders" />
        <PageWrapper>
          <div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400">Job not found</p>
            <Button className="mt-4" onClick={() => navigate('/work-orders')}>Back to Work Orders</Button>
          </div>
        </PageWrapper>
      </>
    )
  }

  const hasCoords = job.pools?.latitude != null && job.pools?.longitude != null
  const lat = hasCoords ? Number(job.pools.latitude) : null
  const lng = hasCoords ? Number(job.pools.longitude) : null

  // Format time as "9:00 am"
  const timeLabel = (() => {
    if (!job.scheduled_time) return null
    const [h, m] = job.scheduled_time.split(':').map(Number)
    const d = new Date()
    d.setHours(h || 0, m || 0, 0, 0)
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  })()

  return (
    <>
      <Header title="Work Order" backTo="/work-orders" right={headerAction} />
      <PageWrapper>
        {/* Mini map hero */}
        {hasCoords && MAPBOX_TILE_URL && (
          <div className="h-44 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-card mb-4">
            <MapContainer
              center={[lat, lng]}
              zoom={15}
              scrollWheelZoom={false}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
              <Marker position={[lat, lng]} icon={pinIcon()} />
            </MapContainer>
          </div>
        )}

        {/* Hero title card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{job.title}</h2>
              {job.clients?.name && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{job.clients.name}</p>
              )}
            </div>
            <Badge variant={JOB_STATUS_BADGE[job.status]} className="shrink-0">
              {JOB_STATUS_LABEL[job.status]}
            </Badge>
          </div>

          {/* Key facts row */}
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            {job.scheduled_date && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatDate(job.scheduled_date)}</span>
              </div>
            )}
            {timeLabel && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium text-gray-700 dark:text-gray-300">{timeLabel}</span>
              </div>
            )}
            {job.price && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="font-bold text-pool-700">{formatCurrency(job.price)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Status Actions */}
        {job.status !== 'completed' && (
          <div className="flex gap-2 mb-4">
            {job.status === 'scheduled' && (
              <button
                onClick={() => updateStatus('in_progress')}
                disabled={statusUpdating}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gradient-brand text-white text-sm font-semibold shadow-md shadow-pool-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Start Job
              </button>
            )}
            {(job.status === 'scheduled' || job.status === 'in_progress') && (
              <button
                onClick={() => updateStatus('completed')}
                disabled={statusUpdating}
                className={cn('flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50',
                  job.status === 'in_progress'
                    ? 'flex-1 bg-gradient-brand text-white shadow-md shadow-pool-500/20'
                    : 'flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 shadow-card hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-800'
                )}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Complete
              </button>
            )}
            {job.status === 'in_progress' && (
              <button
                onClick={() => updateStatus('on_hold')}
                disabled={statusUpdating}
                className="px-4 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold shadow-card active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Hold
              </button>
            )}
            {job.status === 'on_hold' && (
              <button
                onClick={() => updateStatus('in_progress')}
                disabled={statusUpdating}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gradient-brand text-white text-sm font-semibold shadow-md shadow-pool-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                Resume Job
              </button>
            )}
          </div>
        )}

        {/* Completed banner — pool-blue theme */}
        {job.status === 'completed' && (
          <div className="mb-4">
            <div className="p-3.5 bg-pool-50 dark:bg-pool-950/40 border border-pool-100 rounded-2xl flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shrink-0 shadow-md shadow-pool-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-pool-900">Job Completed</p>
                {job.completed_at && (
                  <p className="text-xs text-pool-600 dark:text-pool-400">{formatDate(job.completed_at)}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                const params = new URLSearchParams()
                if (job.client_id) params.set('client', job.client_id)
                if (job.title) params.set('desc', job.title)
                if (job.price) params.set('price', job.price)
                params.set('ref', `work-order:${job.id}`)
                navigate(`/invoices/new?${params.toString()}`)
              }}
              className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl bg-white dark:bg-gray-900 border border-pool-200 text-pool-700 text-sm font-semibold hover:bg-pool-50 active:scale-[0.98] transition-all min-h-tap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Create Invoice
            </button>
          </div>
        )}

        {/* Details Card */}
        <Card className="mb-3">
          <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Details</h3>
          <div className="space-y-3">
            {job.scheduled_date && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Scheduled</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {formatDate(job.scheduled_date)}
                    {job.scheduled_time && ` at ${job.scheduled_time}`}
                  </p>
                </div>
              </div>
            )}
            {job.price && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Price</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatCurrency(job.price)}</p>
                </div>
              </div>
            )}
            {job.notes && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Notes</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{job.notes}</p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Client Card */}
        {job.clients && (
          <Card className="mb-3" onClick={() => navigate(`/clients/${job.clients.id}`)}>
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Client</h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-white">
                  {job.clients.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{job.clients.name}</p>
                {job.clients.phone && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{job.clients.phone}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                {job.clients.phone && (
                  <a href={`tel:${job.clients.phone}`} onClick={e => e.stopPropagation()}
                    className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors">
                    <svg className="w-4 h-4 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </a>
                )}
                {job.clients.email && (
                  <a href={`mailto:${job.clients.email}`} onClick={e => e.stopPropagation()}
                    className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors">
                    <svg className="w-4 h-4 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Pool Card */}
        {job.pools && (
          <Card className="mb-3" onClick={() => navigate(`/pools/${job.pools.id}`)}>
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Pool</h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{job.pools.address}</p>
                {job.pools.pool_type && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{job.pools.pool_type}</p>
                )}
              </div>
              <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Card>
        )}

        {/* Quote Reference */}
        {quote && (
          <Card className="mb-3">
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">From Quote</h3>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">Quote: {formatCurrency(quote.total)}</p>
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold',
                quote.status === 'accepted' || quote.status === 'converted' ? 'bg-green-50 dark:bg-green-950/40 text-green-700' :
                quote.status === 'sent' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400')}>
                {quote.status === 'converted' ? 'Converted' : quote.status === 'accepted' ? 'Accepted' : quote.status?.charAt(0).toUpperCase() + quote.status?.slice(1)}
              </span>
            </div>
            {quote.responded_at && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                {quote.status === 'accepted' ? 'Accepted' : 'Responded'} {new Date(quote.responded_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
            <div className="space-y-1 mb-3">
              {(quote.line_items || []).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 truncate flex-1">{item.description}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100 shrink-0 ml-2">{formatCurrency((item.quantity || 1) * (item.unit_price || 0))}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate(`/quotes/${quote.id}`)}
              className="text-sm font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700 flex items-center gap-1"
            >
              View Quote
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </Card>
        )}

        {/* Delete */}
        <div className="mt-6 mb-4">
          <button onClick={() => setConfirmDeleteOpen(true)}
            className="w-full py-3 text-sm font-medium text-red-500 hover:text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors">
            Delete Job
          </button>
        </div>
      </PageWrapper>

      {/* Edit Modal */}
      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Job">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <Input
            label="Job Title"
            value={editForm.title || ''}
            onChange={e => setEditForm(prev => ({ ...prev, title: e.target.value }))}
            required
          />
          <Select
            label="Status"
            value={editForm.status || 'scheduled'}
            onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value }))}
            options={STATUS_OPTIONS}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={editForm.scheduled_date || ''}
              onChange={e => setEditForm(prev => ({ ...prev, scheduled_date: e.target.value }))}
            />
            <Input
              label="Time"
              type="time"
              value={editForm.scheduled_time || ''}
              onChange={e => setEditForm(prev => ({ ...prev, scheduled_time: e.target.value }))}
            />
          </div>
          <Input
            label="Price ($)"
            type="number"
            value={editForm.price || ''}
            onChange={e => setEditForm(prev => ({ ...prev, price: e.target.value }))}
          />
          <Select
            label="Assign Technician"
            value={editForm.assigned_staff_id || ''}
            onChange={e => {
              if (e.target.value === '__add__') {
                setShowAddTech(true)
                setEditForm(f => ({ ...f, assigned_staff_id: '' }))
              } else {
                setEditForm(f => ({ ...f, assigned_staff_id: e.target.value }))
                setShowAddTech(false)
              }
            }}
            options={[
              { value: '', label: 'Unassigned' },
              ...staffList.map(s => ({ value: s.id, label: s.name })),
              { value: '__add__', label: '+ Add Technician' },
            ]}
          />
          {showAddTech && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">New Technician</h4>
              <Input
                label="Name"
                value={newTechForm.name}
                onChange={e => setNewTechForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
              <Input
                label="Email"
                type="email"
                value={newTechForm.email}
                onChange={e => setNewTechForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
              />
              <Input
                label="Phone"
                type="tel"
                value={newTechForm.phone}
                onChange={e => setNewTechForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="04XX XXX XXX"
              />
              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowAddTech(false)}>
                  Cancel
                </Button>
                <Button type="button" className="flex-1" onClick={handleAddTech} loading={newTechSaving} disabled={!newTechForm.name.trim()}>
                  Add
                </Button>
              </div>
            </div>
          )}
          <TextArea
            label="Notes"
            value={editForm.notes || ''}
            onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditModalOpen(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete this job?"
        description="This cannot be undone."
        destructive
        confirmLabel="Delete"
        onConfirm={deleteJob}
      />
    </>
  )
}
