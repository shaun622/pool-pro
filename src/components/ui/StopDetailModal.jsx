import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import Modal from './Modal'
import Button from './Button'
import Badge from './Badge'
import Input, { TextArea, Select } from './Input'
import AddressAutocomplete from './AddressAutocomplete'
import { supabase } from '../../lib/supabase'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION, geocodeAddress } from '../../lib/mapbox'
import { FREQUENCY_LABELS, SCHEDULE_FREQUENCIES, cn } from '../../lib/utils'

// Numbered pin factory
function numberedIcon(n, color = '#0CA5EB') {
  return L.divIcon({
    className: 'numbered-pin',
    html: `<div style="
      background:${color};color:white;width:34px;height:34px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
      border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-weight:700;font-size:13px;
    "><span style="transform:rotate(45deg);">${n}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  })
}

const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: '6_weekly', label: 'Every 6 Weeks' },
  { value: 'quarterly', label: 'Quarterly' },
]

const RECURRENCE_DAYS = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }

const STATUS_VARIANTS = {
  scheduled: 'primary',
  in_progress: 'warning',
  completed: 'success',
  on_hold: 'default',
  due: 'primary',
  overdue: 'danger',
}

export default function StopDetailModal({ open, onClose, stop, stopNumber, onUpdated }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({})

  useEffect(() => {
    if (stop) {
      if (stop.type === 'job') {
        setForm({
          title: stop.title || '',
          address: stop.address || '',
          address_lat: stop.lat ?? null,
          address_lng: stop.lng ?? null,
          scheduled_date: stop.scheduled_date || '',
          scheduled_time: stop.scheduled_time || '',
          estimated_duration_minutes: stop.duration || '',
          price: stop.price || '',
          status: stop.status || 'scheduled',
          notes: stop.notes || '',
          is_recurring: false,
          recurrence_rule: 'weekly',
          recurring_profile_id: null,
        })
        // Fetch any matching recurring profile so the toggle reflects reality.
        if (stop.client_id) {
          supabase
            .from('recurring_job_profiles')
            .select('id, recurrence_rule')
            .eq('client_id', stop.client_id)
            .eq('title', stop.title || '')
            .limit(1)
            .then(({ data }) => {
              const profile = data?.[0]
              if (profile) {
                setForm(f => ({ ...f, is_recurring: true, recurrence_rule: profile.recurrence_rule || 'weekly', recurring_profile_id: profile.id }))
              }
            })
        }
      } else {
        setForm({
          next_due_at: stop.next_due_at ? stop.next_due_at.split('T')[0] : '',
          next_due_time: stop.next_due_at ? new Date(stop.next_due_at).toTimeString().slice(0, 5) : '',
          schedule_frequency: stop.schedule_frequency || 'weekly',
          access_notes: stop.access_notes || '',
        })
      }
      setEditing(false)
    }
  }, [stop])

  if (!stop) return null

  async function handleSave() {
    setSaving(true)
    try {
      if (stop.type === 'job') {
        // Resolve target job id. If this is a projected stop (no real row), materialize it.
        let jobId = stop.id
        let businessId = null
        let poolId = stop.pool_id || null
        const isProjected = !!stop.projected || (typeof stop.id === 'string' && stop.id.startsWith('profile-'))

        if (isProjected) {
          // Need a business_id — pull it from the recurring profile
          if (form.recurring_profile_id) {
            const { data: profileRow } = await supabase
              .from('recurring_job_profiles')
              .select('business_id, pool_id')
              .eq('id', form.recurring_profile_id)
              .single()
            businessId = profileRow?.business_id || null
            if (!poolId) poolId = profileRow?.pool_id || null
          }
          if (!businessId) throw new Error('Could not determine business for new job')
          const { data: inserted, error: insErr } = await supabase.from('jobs').insert({
            business_id: businessId,
            client_id: stop.client_id,
            pool_id: poolId,
            recurring_profile_id: form.recurring_profile_id || null,
            title: form.title,
            status: form.status || 'scheduled',
            scheduled_date: form.scheduled_date || null,
            scheduled_time: form.scheduled_time || null,
            estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
            price: form.price ? Number(form.price) : null,
            notes: form.notes || null,
          }).select('id').single()
          if (insErr) throw insErr
          jobId = inserted.id
        } else {
          const updates = {
            title: form.title,
            scheduled_date: form.scheduled_date || null,
            scheduled_time: form.scheduled_time || null,
            estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
            price: form.price ? Number(form.price) : null,
            status: form.status,
            notes: form.notes || null,
          }
          const { error } = await supabase.from('jobs').update(updates).eq('id', jobId)
          if (error) throw error
        }

        // Sync pool address (job's address comes from its linked pool)
        const newAddr = (form.address || '').trim()
        const oldAddr = (stop.address || '').trim()
        if (newAddr && newAddr !== oldAddr) {
          let lat = form.address_lat
          let lng = form.address_lng
          if (lat == null || lng == null) {
            try {
              const geo = await geocodeAddress(newAddr)
              if (geo) { lat = geo.lat; lng = geo.lng }
            } catch { /* non-fatal */ }
          }
          if (poolId) {
            await supabase.from('pools').update({
              address: newAddr,
              latitude: lat ?? null,
              longitude: lng ?? null,
            }).eq('id', poolId)
          } else if (stop.client_id) {
            // No pool linked yet — create one and link the job to it
            if (!businessId) {
              const { data: jobRow } = await supabase.from('jobs').select('business_id').eq('id', jobId).single()
              businessId = jobRow?.business_id || null
            }
            if (businessId) {
              const { data: newPool, error: poolErr } = await supabase.from('pools').insert({
                business_id: businessId,
                client_id: stop.client_id,
                address: newAddr,
                latitude: lat ?? null,
                longitude: lng ?? null,
                type: 'chlorine',
                shape: 'rectangular',
                geocoded_at: lat != null ? new Date().toISOString() : null,
              }).select('id').single()
              if (poolErr) throw poolErr
              if (newPool?.id) {
                poolId = newPool.id
                await supabase.from('jobs').update({ pool_id: poolId }).eq('id', jobId)
              }
            }
          }
        }

        // Sync recurring profile
        if (form.is_recurring) {
          const days = RECURRENCE_DAYS[form.recurrence_rule] || 7
          const nextGen = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
          if (form.recurring_profile_id) {
            await supabase.from('recurring_job_profiles').update({
              title: form.title,
              pool_id: poolId || null,
              recurrence_rule: form.recurrence_rule,
              preferred_time: form.scheduled_time || null,
              price: form.price ? Number(form.price) : null,
              notes: form.notes || null,
            }).eq('id', form.recurring_profile_id)
            // Make sure the job points at the profile so dedupe works
            await supabase.from('jobs').update({ recurring_profile_id: form.recurring_profile_id }).eq('id', jobId)
          } else if (stop.client_id) {
            if (!businessId) {
              const { data: jobRow } = await supabase.from('jobs').select('business_id').eq('id', jobId).single()
              businessId = jobRow?.business_id || null
            }
            if (businessId) {
              const { data: newProfile, error: profErr } = await supabase.from('recurring_job_profiles').insert({
                business_id: businessId,
                client_id: stop.client_id,
                pool_id: poolId || null,
                title: form.title,
                recurrence_rule: form.recurrence_rule,
                preferred_time: form.scheduled_time || null,
                price: form.price ? Number(form.price) : null,
                notes: form.notes || null,
                next_generation_at: nextGen,
                last_generated_at: new Date().toISOString(),
              }).select('id').single()
              if (profErr) throw profErr
              if (newProfile?.id) {
                await supabase.from('jobs').update({ recurring_profile_id: newProfile.id }).eq('id', jobId)
              }
            }
          }
        } else if (form.recurring_profile_id) {
          // Toggle was turned off — delete the profile
          await supabase.from('recurring_job_profiles').delete().eq('id', form.recurring_profile_id)
        }
      } else {
        let nextDue = null
        if (form.next_due_at) {
          const t = form.next_due_time || '09:00'
          nextDue = new Date(`${form.next_due_at}T${t}:00`).toISOString()
        }
        const updates = {
          next_due_at: nextDue,
          schedule_frequency: form.schedule_frequency || null,
          access_notes: form.access_notes || null,
        }
        const { error } = await supabase.from('pools').update(updates).eq('id', stop.id)
        if (error) throw error
      }
      setEditing(false)
      onUpdated?.()
    } catch (err) {
      console.error('Save error:', err?.message, err?.details, err?.hint, err)
      alert(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleStartJob() {
    if (stop.type === 'job') {
      await supabase.from('jobs').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', stop.id)
      onUpdated?.()
      navigate(`/work-orders/${stop.id}`)
    } else {
      navigate(`/pools/${stop.id}/service`)
    }
  }

  const hasCoords = stop.lat != null && stop.lng != null
  const statusLabel = stop.status || (stop.type === 'pool' ? 'due' : 'scheduled')

  return (
    <Modal open={open} onClose={onClose} title={stop.type === 'job' ? 'Job Details' : 'Service Details'}>
      <div className="space-y-4">
        {/* Mini map */}
        {hasCoords && MAPBOX_TILE_URL && (
          <div className="h-40 rounded-xl overflow-hidden border border-gray-100">
            <MapContainer
              center={[stop.lat, stop.lng]}
              zoom={14}
              scrollWheelZoom={false}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
              <Marker position={[stop.lat, stop.lng]} icon={numberedIcon(stopNumber || 1)} />
            </MapContainer>
          </div>
        )}

        {/* Title + status */}
        <div className="flex items-start justify-between gap-3 p-4 bg-white rounded-2xl border border-gray-100">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900">{stop.title}</h3>
            {stop.client_name && <p className="text-sm text-gray-500 mt-0.5">{stop.client_name}</p>}
          </div>
          <Badge variant={STATUS_VARIANTS[statusLabel] || 'primary'} className="shrink-0 capitalize">
            {String(statusLabel).replace('_', ' ')}
          </Badge>
        </div>

        {/* Details — view mode */}
        {!editing && (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
            <DetailRow
              icon={<PinIcon />}
              label="Site Address"
              value={stop.address}
              action={
                stop.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-pool-600"
                  >
                    Open
                  </a>
                )
              }
            />
            <DetailRow
              icon={<CalIcon />}
              label="Scheduled"
              value={
                stop.scheduled_display ||
                (stop.scheduled_date ? new Date(stop.scheduled_date).toLocaleDateString('en-AU') : '—')
              }
              subValue={stop.time_display}
            />
            {stop.duration && (
              <DetailRow icon={<ClockIcon />} label="Duration" value={`${stop.duration} min`} />
            )}
            {stop.frequency && (
              <DetailRow
                icon={<RepeatIcon />}
                label="Frequency"
                value={FREQUENCY_LABELS[stop.frequency] || stop.frequency}
              />
            )}
            {stop.phone && (
              <DetailRow
                icon={<PhoneIcon />}
                label="Client Phone"
                value={<a href={`tel:${stop.phone}`} className="text-pool-600 font-semibold">{stop.phone}</a>}
              />
            )}
            {stop.email && (
              <DetailRow
                icon={<MailIcon />}
                label="Client Email"
                value={<a href={`mailto:${stop.email}`} className="text-pool-600 font-semibold break-all">{stop.email}</a>}
              />
            )}
            {stop.notes && (
              <DetailRow icon={<NoteIcon />} label="Notes" value={stop.notes} />
            )}
          </div>
        )}

        {/* Details — edit mode */}
        {editing && stop.type === 'job' && (
          <div className="space-y-3">
            <Input label="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <AddressAutocomplete
              label="Site Address"
              value={form.address}
              onChange={(v) => setForm(f => ({ ...f, address: v, address_lat: null, address_lng: null }))}
              onSelect={({ address, lat, lng }) => setForm(f => ({ ...f, address, address_lat: lat, address_lng: lng }))}
              placeholder="Start typing a street address..."
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Date" type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
              <Input label="Time" type="time" value={form.scheduled_time} onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))} />
            </div>

            {/* Recurring toggle */}
            <label className="flex items-center justify-between min-h-tap cursor-pointer">
              <div className="flex items-center gap-2">
                <RepeatIcon />
                <span className="text-sm font-medium text-gray-700">Recurring job</span>
              </div>
              <div className={cn('relative w-11 h-6 rounded-full transition-colors',
                form.is_recurring ? 'bg-pool-500' : 'bg-gray-200')}>
                <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                  form.is_recurring ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                <input type="checkbox" className="sr-only"
                  checked={form.is_recurring}
                  onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))} />
              </div>
            </label>

            {form.is_recurring && (
              <Select
                label="Frequency"
                value={form.recurrence_rule}
                onChange={e => setForm(f => ({ ...f, recurrence_rule: e.target.value }))}
                options={RECURRENCE_OPTIONS}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Duration (min)" type="number" value={form.estimated_duration_minutes} onChange={e => setForm(f => ({ ...f, estimated_duration_minutes: e.target.value }))} />
              <Input label="Price ($)" type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              options={[
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'on_hold', label: 'On Hold' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
            <TextArea label="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
        )}

        {editing && stop.type === 'pool' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Next Service Date" type="date" value={form.next_due_at} onChange={e => setForm(f => ({ ...f, next_due_at: e.target.value }))} />
              <Input label="Time" type="time" value={form.next_due_time} onChange={e => setForm(f => ({ ...f, next_due_time: e.target.value }))} />
            </div>
            <Select
              label="Frequency"
              value={form.schedule_frequency}
              onChange={e => setForm(f => ({ ...f, schedule_frequency: e.target.value }))}
              options={SCHEDULE_FREQUENCIES.map(v => ({ value: v, label: FREQUENCY_LABELS[v] || v }))}
            />
            <TextArea label="Access Notes" value={form.access_notes} onChange={e => setForm(f => ({ ...f, access_notes: e.target.value }))} rows={3} />
          </div>
        )}

        {/* Actions */}
        {!editing ? (
          <div className="space-y-2">
            {stop.type === 'job' && stop.status !== 'completed' && (
              <Button onClick={handleStartJob} className="w-full">
                {stop.status === 'in_progress' ? 'View Job' : 'Start Job'}
              </Button>
            )}
            {stop.type === 'pool' && (
              <Button onClick={handleStartJob} className="w-full">
                Start Service
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(true)} className="w-full">
              {stop.type === 'job' ? 'Edit Job' : 'Edit Service'}
            </Button>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">Save</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function DetailRow({ icon, label, value, subValue, action }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-pool-50 flex items-center justify-center shrink-0 text-pool-600">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="text-sm font-medium text-gray-900 truncate">{value || '—'}</div>
        {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
      </div>
      {action}
    </div>
  )
}

const PinIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)
const CalIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)
const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)
const RepeatIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
)
const PhoneIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
)
const MailIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
)
const NoteIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)
