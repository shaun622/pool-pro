import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import Modal from './Modal'
import Button from './Button'
import Badge from './Badge'
import Input, { TextArea, Select } from './Input'
import CustomSelect from './CustomSelect'
import AddressAutocomplete from './AddressAutocomplete'
import { supabase } from '../../lib/supabase'
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION, geocodeAddress } from '../../lib/mapbox'
import { FREQUENCY_LABELS, SCHEDULE_FREQUENCIES, cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { useService } from '../../hooks/useService'
import { useBusiness } from '../../hooks/useBusiness'
import {
  computeNextOccurrence,
  describeSchedule,
  DAYS_OF_WEEK,
} from '../../lib/recurringScheduling'
import { recomputePoolNextDue } from '../../lib/recomputePoolNextDue'

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

// The inline "make this recurring" toggle inside the job edit form
// stays narrow on purpose — it just lets the operator quick-create a
// profile from an existing job. Custom is omitted; for that the
// operator should use the Recurring services page.
const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

const RECURRENCE_DAYS = { weekly: 7, fortnightly: 14, monthly: 30, '6_weekly': 42, quarterly: 90 }

// Canonical (English) reasons for the admin "unable to service" quick picker.
const UNABLE_REASONS = ['Locked gate', 'Pool room locked', 'Dog in yard', 'No access', 'Other']

const STATUS_VARIANTS = {
  scheduled: 'primary',
  in_progress: 'warning',
  completed: 'success',
  on_hold: 'default',
  due: 'primary',
  overdue: 'danger',
}

export default function StopDetailModal({ open, onClose, stop, stopNumber, onUpdated, staffList = [] }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [quickEdit, setQuickEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [pendingStaffId, setPendingStaffId] = useState(null)
  const [form, setForm] = useState({})
  // Cache the recurring_job_profile row if this stop is part of one.
  // Used to render the linkage label in the modal header
  // ("Tri-weekly Mon, Tue, Wed") and to know which days are eligible
  // for the "Stop coming on Wednesdays" delete option.
  const [loadedProfile, setLoadedProfile] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // null | 'confirm' | 'recurring'
  const [deleting, setDeleting] = useState(false)
  const { createServiceRecord, markUnableToService } = useService()
  const { business } = useBusiness()
  // Admin "Edit details" — replaces the old in-modal service editor. Edits the
  // CLIENT's name/phone/email and writes straight to the clients row, so the
  // change syncs everywhere this client appears.
  const [editDetails, setEditDetails] = useState(false)
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '' })
  // Admin "Unable to service" quick reason picker (no photos — off-site).
  const [unablePick, setUnablePick] = useState(false)
  const [unableReason, setUnableReason] = useState('')
  const [unableNote, setUnableNote] = useState('')

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
          assigned_staff_id: stop.assigned_staff_id || '',
          is_recurring: false,
          recurrence_rule: 'weekly',
          custom_interval_days: 7,
          recurring_profile_id: null,
          client_phone: stop.phone || '',
          client_email: stop.email || '',
        })
        // Fetch the matching recurring profile (rich shape) so the
        // toggle and picker reflect what's actually stored. Title +
        // client_id is a reasonable identifier here — the AddRecurring
        // flow ALSO uses title for de-dupe keying.
        if (stop.client_id) {
          supabase
            .from('recurring_job_profiles')
            .select('id, recurrence_rule, custom_interval_days, preferred_day_of_week, preferred_days_of_week, monthly_week_of_month, next_generation_at, is_active, status')
            .eq('client_id', stop.client_id)
            .eq('title', stop.title || '')
            .eq('is_active', true)
            .limit(1)
            .then(({ data }) => {
              const profile = data?.[0]
              if (!profile) return
              setLoadedProfile(profile)
              setForm(f => ({
                ...f,
                is_recurring: true,
                recurrence_rule: profile.recurrence_rule || 'weekly',
                recurring_profile_id: profile.id,
                custom_interval_days: profile.custom_interval_days || 7,
              }))
            })
        }
      } else {
        // Pool stop. Default the form to the pool's stored frequency,
        // then overlay the recurring profile's richer shape if one
        // exists for this pool. Profile is the source of truth when
        // present; the pool's schedule_frequency is a denormalised
        // mirror that may lag.
        setForm({
          next_due_at: stop.next_due_at ? stop.next_due_at.split('T')[0] : '', /* single-writer-ok: form state */
          next_due_time: stop.next_due_at ? new Date(stop.next_due_at).toTimeString().slice(0, 5) : '',
          schedule_frequency: stop.schedule_frequency || 'weekly',
          custom_interval_days: 7,
          recurring_profile_id: null,
          access_notes: stop.access_notes || '',
          assigned_staff_id: stop.assigned_staff_id || '',
          pool_address: stop.address || '',
          pool_address_lat: stop.lat ?? null,
          pool_address_lng: stop.lng ?? null,
          client_phone: stop.phone || '',
          client_email: stop.email || '',
        })
        if (stop.id) {
          supabase
            .from('recurring_job_profiles')
            .select('id, recurrence_rule, custom_interval_days, preferred_day_of_week, preferred_days_of_week, monthly_week_of_month, next_generation_at, is_active, status')
            .eq('pool_id', stop.id)
            .eq('is_active', true)
            .limit(1)
            .then(({ data }) => {
              const profile = data?.[0]
              if (!profile) return
              setLoadedProfile(profile)
              setForm(f => ({
                ...f,
                schedule_frequency: profile.recurrence_rule || f.schedule_frequency,
                recurring_profile_id: profile.id,
                custom_interval_days: profile.custom_interval_days || 7,
              }))
            })
        }
      }
      setEditing(false)
      setQuickEdit(false)
      setPendingStaffId(null)
      setDeleteConfirm(null)
      setDeleting(false)
      setLoadedProfile(null)
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
          // Need a business_id — pull it from the recurring profile.
          // Prefer form.recurring_profile_id (set by the async lookup
          // on modal open), but fall back to extracting the profile id
          // directly from the synthetic stop id, which is deterministic
          // (profileToStop builds it as `profile-<uuid>-YYYY-MM-DD`).
          // Without the fallback, a fast user who changes the date and
          // hits Save before the async lookup lands gets "Could not
          // determine business for new job" and the new job never
          // inserts — that was the bug behind the Schedule "I changed
          // the date and nothing happened" report.
          let profileId = form.recurring_profile_id
          if (!profileId && typeof stop.id === 'string' && stop.id.startsWith('profile-')) {
            // Strip the trailing -YYYY-MM-DD; what remains is the UUID.
            profileId = stop.id.replace(/^profile-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
          }
          if (profileId) {
            const { data: profileRow } = await supabase
              .from('recurring_job_profiles')
              .select('business_id, pool_id')
              .eq('id', profileId)
              .single()
            businessId = profileRow?.business_id || null
            if (!poolId) poolId = profileRow?.pool_id || null
          }
          if (!businessId) throw new Error('Could not determine business for new job — recurring profile not found.')
          // Capture the date this job is replacing — extract from the
          // synthetic stop id (`profile-<uuid>-YYYY-MM-DD`) or fall
          // back to stop.scheduled_date. The projector uses this to
          // suppress the original-date projection while the job
          // exists; deleting the job removes the suppression.
          const origRecurringDate = stop.scheduled_date
            || (typeof stop.id === 'string' && stop.id.startsWith('profile-')
              ? stop.id.match(/-(\d{4}-\d{2}-\d{2})$/)?.[1]
              : null)
          const { data: inserted, error: insErr } = await supabase.from('jobs').insert({
            business_id: businessId,
            client_id: stop.client_id,
            pool_id: poolId,
            recurring_profile_id: profileId || null,
            replaces_recurring_date: origRecurringDate || null,
            title: form.title,
            status: form.status || 'scheduled',
            scheduled_date: form.scheduled_date || null,
            scheduled_time: form.scheduled_time || null,
            estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
            price: form.price ? Number(form.price) : null,
            notes: form.notes || null,
            assigned_staff_id: form.assigned_staff_id || null,
          }).select('id').single()
          if (insErr) throw insErr
          jobId = inserted.id

          // The job carries replaces_recurring_date (set above) so the
          // projector suppresses the original occurrence; the chokepoint
          // recomputes the pool's next_due_at from the fixed pattern + history.
          if (poolId) await recomputePoolNextDue(poolId)
        } else {
          const updates = {
            title: form.title,
            scheduled_date: form.scheduled_date || null,
            scheduled_time: form.scheduled_time || null,
            estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
            price: form.price ? Number(form.price) : null,
            status: form.status,
            notes: form.notes || null,
            assigned_staff_id: form.assigned_staff_id || null,
          }
          const { error } = await supabase.from('jobs').update(updates).eq('id', jobId)
          if (error) throw error

          // If the operator changed the date on a real job that's tied to
          // a pool, sync pool.next_due_at. Otherwise the Schedule view
          // keeps projecting the pool on the old date as a phantom stop
          // while the job sits at the new date — the dedupe in
          // Schedule.jsx only suppresses the pool projection for the day
          // the job is on, not the day it WAS on.
          if (poolId && (form.scheduled_date || '') !== (stop.scheduled_date || '') && form.scheduled_date) {
            await recomputePoolNextDue(poolId)
          }
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

        // Sync client contact info
        if (stop.client_id) {
          const clientUpdates = {}
          if ((form.client_phone || '').trim() !== (stop.phone || '')) clientUpdates.phone = form.client_phone.trim() || null
          if ((form.client_email || '').trim() !== (stop.email || '')) clientUpdates.email = form.client_email.trim() || null
          if (Object.keys(clientUpdates).length > 0) {
            await supabase.from('clients').update(clientUpdates).eq('id', stop.client_id)
          }
        }

        // Schedule view edits are per-occurrence only — the recurring
        // schedule itself is owned by the Recurring page. Nothing to
        // write to the profile from here.
      } else {
        // next_due_at is owned by the chokepoint (recomputed below), not set here.
        // Update pool address if changed
        const newPoolAddr = (form.pool_address || '').trim()
        const oldPoolAddr = (stop.address || '').trim()
        let poolLat = form.pool_address_lat
        let poolLng = form.pool_address_lng
        if (newPoolAddr && newPoolAddr !== oldPoolAddr) {
          if (poolLat == null || poolLng == null) {
            try {
              const geo = await geocodeAddress(newPoolAddr)
              if (geo) { poolLat = geo.lat; poolLng = geo.lng }
            } catch { /* non-fatal */ }
          }
        }

        const updates = {
          schedule_frequency: form.schedule_frequency || null,
          access_notes: form.access_notes || null,
          assigned_staff_id: form.assigned_staff_id || null,
          ...(newPoolAddr !== oldPoolAddr ? {
            address: newPoolAddr,
            latitude: poolLat ?? null,
            longitude: poolLng ?? null,
            geocoded_at: poolLat != null ? new Date().toISOString() : null,
          } : {}),
        }
        const { error } = await supabase.from('pools').update(updates).eq('id', stop.id)
        if (error) throw error
        await recomputePoolNextDue(stop.id)

        // Schedule view edits are per-occurrence only. The pool's
        // recurring schedule (rule, days, monthly Nth) is owned by
        // the Recurring page. Pool fields written above (next_due_at,
        // schedule_frequency, address) all live on the pool row, not
        // the profile.

        // Sync client contact info
        if (stop.client_id) {
          const clientUpdates = {}
          if ((form.client_phone || '').trim() !== (stop.phone || '')) clientUpdates.phone = form.client_phone.trim() || null
          if ((form.client_email || '').trim() !== (stop.email || '')) clientUpdates.email = form.client_email.trim() || null
          if (Object.keys(clientUpdates).length > 0) {
            await supabase.from('clients').update(clientUpdates).eq('id', stop.client_id)
          }
        }
      }
      setEditing(false)
      onUpdated?.()
    } catch (err) {
      console.error('Save error:', err?.message, err?.details, err?.hint, err)
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickSave() {
    setSaving(true)
    try {
      // Save pool/job address
      if (stop.type === 'pool') {
        const newAddr = (form.pool_address || '').trim()
        const oldAddr = (stop.address || '').trim()
        if (newAddr !== oldAddr) {
          let lat = form.pool_address_lat
          let lng = form.pool_address_lng
          if ((lat == null || lng == null) && newAddr) {
            try {
              const geo = await geocodeAddress(newAddr)
              if (geo) { lat = geo.lat; lng = geo.lng }
            } catch { /* non-fatal */ }
          }
          await supabase.from('pools').update({
            address: newAddr,
            latitude: lat ?? null,
            longitude: lng ?? null,
            geocoded_at: lat != null ? new Date().toISOString() : null,
          }).eq('id', stop.id)
        }
        // Save notes
        if ((form.access_notes || '') !== (stop.access_notes || '')) {
          await supabase.from('pools').update({ access_notes: form.access_notes || null }).eq('id', stop.id)
        }
        // Schedule date is owned by the chokepoint now.
        await recomputePoolNextDue(stop.id)
      } else if (stop.type === 'job') {
        const newAddr = (form.address || '').trim()
        const oldAddr = (stop.address || '').trim()
        if (newAddr !== oldAddr && stop.pool_id) {
          let lat = form.address_lat
          let lng = form.address_lng
          if ((lat == null || lng == null) && newAddr) {
            try {
              const geo = await geocodeAddress(newAddr)
              if (geo) { lat = geo.lat; lng = geo.lng }
            } catch { /* non-fatal */ }
          }
          await supabase.from('pools').update({
            address: newAddr,
            latitude: lat ?? null,
            longitude: lng ?? null,
          }).eq('id', stop.pool_id)
        }
        // Save notes + schedule
        const isProjected = !!stop.projected || (typeof stop.id === 'string' && stop.id.startsWith('profile-'))
        const dateChanged  = (form.scheduled_date || '') !== (stop.scheduled_date || '')
        const timeChanged  = (form.scheduled_time || '') !== (stop.scheduled_time || '')
        const notesChanged = (form.notes || '')           !== (stop.notes || '')

        if (isProjected && (dateChanged || timeChanged || notesChanged)) {
          // Quick-edit on a projected stop used to silently discard the
          // change because there's no row to UPDATE — same root cause as
          // the handleSave bug. Materialize the projection by inserting
          // a real job, then advance the pool's next_due_at and the
          // profile's next_generation_at so the old projection
          // disappears from the schedule. Mirrors handleSave's
          // projected branch.
          let profileId = form.recurring_profile_id
          if (!profileId && typeof stop.id === 'string' && stop.id.startsWith('profile-')) {
            profileId = stop.id.replace(/^profile-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
          }
          if (!profileId) throw new Error('Could not find recurring profile for this stop.')
          const { data: profileRow } = await supabase
            .from('recurring_job_profiles')
            .select('business_id, pool_id, recurrence_rule, custom_interval_days, preferred_day_of_week, preferred_days_of_week, monthly_week_of_month')
            .eq('id', profileId)
            .single()
          if (!profileRow?.business_id) throw new Error('Recurring profile not found.')
          const poolId = profileRow.pool_id || stop.pool_id || null

          // Same replaces_recurring_date trick as handleSave — store the
          // link to the original projection date on the new job so the
          // projector can suppress that date for as long as this job
          // exists, and naturally restore it on delete.
          const origRecurringDate = stop.scheduled_date
            || (typeof stop.id === 'string' && stop.id.startsWith('profile-')
              ? stop.id.match(/-(\d{4}-\d{2}-\d{2})$/)?.[1]
              : null)
          const { error: insErr } = await supabase.from('jobs').insert({
            business_id: profileRow.business_id,
            client_id: stop.client_id,
            pool_id: poolId,
            recurring_profile_id: profileId,
            replaces_recurring_date: origRecurringDate || null,
            title: form.title || stop.title || 'Pool Service',
            status: 'scheduled',
            scheduled_date: form.scheduled_date || null,
            scheduled_time: form.scheduled_time || null,
            notes: form.notes || null,
            assigned_staff_id: stop.assigned_staff_id || null,
          })
          if (insErr) throw insErr

          // replaces_recurring_date (above) suppresses the original occurrence;
          // the chokepoint recomputes next_due_at from the fixed pattern.
          if (poolId) await recomputePoolNextDue(poolId)
        } else if (!isProjected) {
          const jobUpdates = {}
          if (notesChanged) jobUpdates.notes = form.notes || null
          if (dateChanged)  jobUpdates.scheduled_date = form.scheduled_date || null
          if (timeChanged)  jobUpdates.scheduled_time = form.scheduled_time || null
          if (Object.keys(jobUpdates).length > 0) {
            await supabase.from('jobs').update(jobUpdates).eq('id', stop.id)
            // Keep pool.next_due_at aligned with the job's date — without
            // this, the Schedule view's pool projection lingers on the
            // old date as a phantom stop alongside the moved job.
            if (dateChanged && stop.pool_id && form.scheduled_date) {
              await recomputePoolNextDue(stop.pool_id)
            }
          }
        }
      }
      // Save client contact info
      if (stop.client_id) {
        const clientUpdates = {}
        if ((form.client_phone || '').trim() !== (stop.phone || '')) clientUpdates.phone = form.client_phone.trim() || null
        if ((form.client_email || '').trim() !== (stop.email || '')) clientUpdates.email = form.client_email.trim() || null
        if (Object.keys(clientUpdates).length > 0) {
          await supabase.from('clients').update(clientUpdates).eq('id', stop.client_id)
        }
      }
      setQuickEdit(false)
      onUpdated?.()
    } catch (err) {
      console.error('Quick save error:', err)
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleStartJob() {
    if (stop.type !== 'job') {
      // Plain pool service stops route into the chemical-readings flow.
      onClose?.()
      navigate(`/pools/${stop.id}/service`)
      return
    }

    // POOL-TIED recurring profile: route to the same /pools/:id/service
    // flow as a regular pool service — that's the "tech flow" with
    // chemical readings, tasks, photos, etc. We deliberately do NOT
    // materialize a jobs row in this path: the service_records table
    // is the source of truth for completed pool services, and the
    // recurring profile's next_generation_at gets advanced when the
    // service is completed (via NewService.jsx's complete handler).
    // Materializing here was leaving in_progress jobs polluting the
    // schedule + the work orders list.
    if (stop.pool_id) {
      onClose?.()
      navigate(`/pools/${stop.pool_id}/service`)
      return
    }

    // NON-POOL recurring (ad-hoc work): keep the materialize-and-go-to-
    // work-orders path. Synthetic projection id never matches a real
    // jobs row, so we have to insert one before navigating.
    let jobId = stop.id
    const isProjected = !!stop.projected || (typeof stop.id === 'string' && stop.id.startsWith('profile-'))

    try {
      if (isProjected) {
        let profileId = form.recurring_profile_id
        if (!profileId && typeof stop.id === 'string' && stop.id.startsWith('profile-')) {
          profileId = stop.id.replace(/^profile-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
        }
        if (!profileId) throw new Error('Could not resolve the recurring profile for this stop.')

        const { data: profileRow, error: profErr } = await supabase
          .from('recurring_job_profiles')
          .select('business_id, pool_id, recurrence_rule, custom_interval_days, preferred_day_of_week, preferred_days_of_week, monthly_week_of_month')
          .eq('id', profileId)
          .single()
        if (profErr) throw profErr
        if (!profileRow?.business_id) throw new Error('Recurring profile is missing a business — cannot start job.')

        const origRecurringDate = stop.scheduled_date
          || (typeof stop.id === 'string' && stop.id.startsWith('profile-')
            ? stop.id.match(/-(\d{4}-\d{2}-\d{2})$/)?.[1]
            : null)

        const { data: inserted, error: insErr } = await supabase
          .from('jobs')
          .insert({
            business_id: profileRow.business_id,
            client_id: stop.client_id,
            pool_id: stop.pool_id || profileRow.pool_id || null,
            recurring_profile_id: profileId,
            replaces_recurring_date: origRecurringDate || null,
            title: form.title || stop.title || 'Recurring Job',
            status: 'in_progress',
            started_at: new Date().toISOString(),
            scheduled_date: form.scheduled_date || stop.scheduled_date || null,
            scheduled_time: form.scheduled_time || stop.scheduled_time || null,
            estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
            price: form.price ? Number(form.price) : (stop.price ?? null),
            notes: form.notes || stop.notes || null,
            assigned_staff_id: form.assigned_staff_id || stop.assigned_staff_id || null,
          })
          .select('id')
          .single()
        if (insErr) throw insErr
        jobId = inserted.id

        // replaces_recurring_date (set on the insert above) suppresses the
        // original occurrence; the chokepoint recomputes the pool's cache.
        if (profileRow?.pool_id) await recomputePoolNextDue(profileRow.pool_id)
      } else {
        const { error } = await supabase
          .from('jobs')
          .update({ status: 'in_progress', started_at: new Date().toISOString() })
          .eq('id', stop.id)
        if (error) throw error
      }

      onClose?.()
      onUpdated?.()
      navigate(`/work-orders/${jobId}`)
    } catch (err) {
      console.error('Start job error:', err)
      toast.error(err.message || 'Could not start job')
    }
  }

  async function handleAssign(staffId) {
    setAssigning(true)
    try {
      const value = staffId || null
      if (stop.type === 'job') {
        const isProjected = !!stop.projected || (typeof stop.id === 'string' && stop.id.startsWith('profile-'))
        if (!isProjected) {
          await supabase.from('jobs').update({ assigned_staff_id: value }).eq('id', stop.id)
        }
        // Also update the recurring profile if there is one
        if (stop.recurring_profile_id || (typeof stop.id === 'string' && stop.id.startsWith('profile-'))) {
          const profileId = stop.recurring_profile_id || stop.id.replace(/^profile-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
          if (profileId) {
            await supabase.from('recurring_job_profiles').update({ assigned_staff_id: value }).eq('id', profileId)
          }
        }
      } else {
        await supabase.from('pools').update({ assigned_staff_id: value }).eq('id', stop.id)
      }
      onUpdated?.()
    } catch (err) {
      console.error('Assign error:', err)
    } finally {
      setAssigning(false)
    }
  }

  function handleDeleteClick() {
    if (!stop) return
    const isProjected = !!stop.projected || (typeof stop.id === 'string' && String(stop.id).startsWith('profile-'))
    const isRecurringJob = stop.type === 'job' && (isProjected || form.recurring_profile_id)
    const isRecurringPool = stop.type === 'pool' && stop.schedule_frequency

    if (isRecurringJob || isRecurringPool) {
      setDeleteConfirm('recurring')
    } else {
      setDeleteConfirm('confirm')
    }
  }

  async function handleDeleteSingle() {
    setDeleting(true)
    try {
      // Completed pool stops on the schedule are sourced from
      // service_records, not from pools.next_due_at. The stop's id is
      // synthetic (`completed-<poolId>-<YYYY-MM-DD>`), so the regular
      // pool / jobs delete paths below can't touch the row that's
      // actually keeping it on the schedule. Hard-delete the
      // service_record by its real id so the stop disappears on the
      // next reload — that's the only thing path 5 reads.
      if (stop.isCompleted && stop.service_record_id) {
        const { error } = await supabase
          .from('service_records')
          .delete()
          .eq('id', stop.service_record_id)
        if (error) throw error
        setDeleteConfirm(null)
        onClose?.()
        onUpdated?.()
        return
      }
      if (stop.type === 'job') {
        const isProjected = !!stop.projected || (typeof stop.id === 'string' && String(stop.id).startsWith('profile-'))
        if (isProjected) {
          // Skip this single occurrence the canonical way: add it to the
          // profile's skipped_dates (occurrencesInRange drops it), then let the
          // chokepoint recompute the pool's next_due_at to the next occurrence.
          const profileId = String(stop.id).replace(/^profile-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
          const { data: profile } = await supabase
            .from('recurring_job_profiles')
            .select('skipped_dates, pool_id')
            .eq('id', profileId)
            .single()
          if (profile) {
            const stopDate = stop.scheduled_date || stop.next_due_at?.split('T')[0]
            if (stopDate) {
              const skipped = Array.isArray(profile.skipped_dates) ? profile.skipped_dates : []
              if (!skipped.includes(stopDate)) {
                await supabase.from('recurring_job_profiles')
                  .update({ skipped_dates: [...skipped, stopDate] })
                  .eq('id', profileId)
              }
              if (profile.pool_id) await recomputePoolNextDue(profile.pool_id)
            }
          }
        } else {
          // Real job — just delete it
          const { error } = await supabase.from('jobs').delete().eq('id', stop.id)
          if (error) throw error
        }
      } else if (stop.type === 'pool') {
        // Legacy pool (no profile): "skip" = mark the due date handled so the
        // chokepoint's legacy branch rolls the cache forward one cycle.
        // (last_serviced_at is allowed; next_due_at is owned by the chokepoint.)
        await supabase.from('pools')
          .update({ last_serviced_at: stop.next_due_at || new Date().toISOString() })
          .eq('id', stop.id)
        await recomputePoolNextDue(stop.id)
      }
      setDeleteConfirm(null)
      onClose?.()
      onUpdated?.()
    } catch (err) {
      console.error('Delete single error:', err)
      toast.error(err.message || 'Failed to delete service')
    } finally {
      setDeleting(false)
    }
  }

  // handleDropDayFromSchedule and handleDeleteAllFuture used to live
  // here. They've been removed alongside their dialog buttons — schedule-
  // pattern edits (drop a weekday, end the schedule) only happen on the
  // /recurring page now. Keeps the Schedule view's destructive blast
  // radius to exactly one occurrence (handleDeleteSingle below).

  async function handleDeleteConfirm() {
    // Simple non-recurring delete
    setDeleting(true)
    try {
      // Same completed-stop short-circuit as handleDeleteSingle. A
      // completed stop dialogs as 'recurring' (because the pool has
      // schedule_frequency) so it usually doesn't land here, but this
      // guard keeps the behaviour right if someone routes the dialog
      // differently in the future.
      if (stop.isCompleted && stop.service_record_id) {
        const { error } = await supabase
          .from('service_records')
          .delete()
          .eq('id', stop.service_record_id)
        if (error) throw error
        setDeleteConfirm(null)
        onClose?.()
        onUpdated?.()
        return
      }
      if (stop.type === 'job') {
        const { error } = await supabase.from('jobs').delete().eq('id', stop.id)
        if (error) throw error
      } else if (stop.type === 'pool') {
        await supabase.from('pools').update({ schedule_frequency: null }).eq('id', stop.id)
        await recomputePoolNextDue(stop.id)
      }
      setDeleteConfirm(null)
      onClose?.()
      onUpdated?.()
    } catch (err) {
      console.error('Delete error:', err)
      toast.error(err.message || 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const hasCoords = stop.lat != null && stop.lng != null
  async function handleSaveClient() {
    if (!stop.client_id) { toast.error('No client linked to this stop'); return }
    setSaving(true)
    try {
      const updates = {
        phone: clientForm.phone.trim() || null,
        email: clientForm.email.trim() || null,
      }
      // clients.name is NOT NULL — only overwrite it when non-empty.
      if (clientForm.name.trim()) updates.name = clientForm.name.trim()
      const { error } = await supabase.from('clients').update(updates).eq('id', stop.client_id)
      if (error) throw error
      toast.success('Client details updated')
      setEditDetails(false)
      onUpdated?.()
    } catch (err) {
      console.error('Client update error:', err)
      toast.error(err.message || 'Failed to update client')
    } finally {
      setSaving(false)
    }
  }

  async function handleAdminUnable() {
    if (!unableReason || !stop.pool_id) return
    setSaving(true)
    try {
      // Office-initiated: create the record then mark it unable (advances the
      // schedule, drops the activity-feed alert, fires the admin email).
      const techName = business?.owner_name || 'Office'
      const record = await createServiceRecord(stop.pool_id, techName, null)
      await markUnableToService(record.id, stop.pool_id, {
        reason: unableReason,
        note: unableNote.trim() || null,
        // Tie the record to the occurrence the admin clicked (which may be a
        // future day), not "now" — otherwise it renders as a phantom stop today.
        scheduledDate: stop.scheduled_date || (stop.next_due_at ? String(stop.next_due_at).split('T')[0] : null),
      })
      toast.success('Marked unable to service')
      setUnablePick(false)
      onClose?.()
      onUpdated?.()
    } catch (err) {
      console.error('Admin unable error:', err)
      toast.error(err.message || 'Failed to mark unable to service')
    } finally {
      setSaving(false)
    }
  }

  const statusLabel = stop.status || (stop.type === 'pool' ? 'due' : 'scheduled')
  const assignedStaff = staffList.find(s => s.id === stop.assigned_staff_id)
  const isDone = stop.status === 'completed' || !!stop.isCompleted

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stop.type === 'job' ? 'Job Details' : 'Service Details'}
      headerAction={!editDetails && !unablePick && stop.client_id ? (
        <button
          type="button"
          onClick={() => { setClientForm({ name: stop.client_name || '', phone: stop.phone || '', email: stop.email || '' }); setEditDetails(true) }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-pool-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Edit client details"
          aria-label="Edit client details"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 7.125L16.875 4.5" /></svg>
        </button>
      ) : null}
    >
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
        <div className="flex items-start justify-between gap-3 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{stop.title}</h3>
            {stop.client_name && stop.client_id ? (
              <button
                onClick={() => { onClose(); navigate(`/clients/${stop.client_id}`) }}
                className="text-sm text-pool-600 font-medium mt-0.5 hover:underline flex items-center gap-1"
              >
                {stop.client_name}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : stop.client_name ? (
              <p className="text-sm text-gray-500 mt-0.5">{stop.client_name}</p>
            ) : null}
            {stop.pool_name && (
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{stop.pool_name}</p>
            )}
            {/* Linkage label — when this stop belongs to a recurring
                schedule, show "Tri-weekly Mon, Tue, Wed" so the
                operator never edits/deletes a stop without seeing
                what other stops are tied to it. The chip jumps to the
                Recurring page where the whole schedule is editable. */}
            {loadedProfile && (
              <button
                onClick={() => { onClose(); navigate('/recurring-jobs') }}
                className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-pool-50 dark:bg-pool-950/40 border border-pool-200/60 dark:border-pool-800/40 text-[11px] font-semibold text-pool-700 dark:text-pool-300 hover:bg-pool-100 dark:hover:bg-pool-950/60 transition-colors"
                title="Open recurring services"
              >
                <RepeatIcon />
                <span>{describeSchedule(loadedProfile)}</span>
                <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
          <Badge variant={STATUS_VARIANTS[statusLabel] || 'primary'} className="shrink-0 capitalize">
            {String(statusLabel).replace('_', ' ')}
          </Badge>
        </div>

        {/* Details — view / quick-edit mode */}
        {!editing && !editDetails && !unablePick && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">

            {/* Address */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400"><PinIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Site Address</p>
                  {quickEdit ? (
                    <AddressAutocomplete
                      value={stop.type === 'pool' ? form.pool_address : form.address}
                      onChange={(v) => stop.type === 'pool'
                        ? setForm(f => ({ ...f, pool_address: v, pool_address_lat: null, pool_address_lng: null }))
                        : setForm(f => ({ ...f, address: v, address_lat: null, address_lng: null }))
                      }
                      onSelect={({ address, lat, lng }) => stop.type === 'pool'
                        ? setForm(f => ({ ...f, pool_address: address, pool_address_lat: lat, pool_address_lng: lng }))
                        : setForm(f => ({ ...f, address, address_lat: lat, address_lng: lng }))
                      }
                      placeholder="Start typing an address..."
                      className="mt-1"
                    />
                  ) : (
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{stop.address || '—'}</div>
                  )}
                </div>
                {!quickEdit && stop.address && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-pool-600"
                  >
                    Open
                  </a>
                )}
              </div>
            </div>

            {/* Scheduled */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400"><CalIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Scheduled</p>
                  {quickEdit ? (
                    <div className="flex gap-2 mt-1">
                      <input
                        type="date"
                        value={stop.type === 'pool' ? form.next_due_at : form.scheduled_date /* single-writer-ok: read */}
                        onChange={e => stop.type === 'pool'
                          ? setForm(f => ({ ...f, next_due_at: e.target.value })) /* single-writer-ok: form state, not a DB write */
                          : setForm(f => ({ ...f, scheduled_date: e.target.value }))
                        }
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pool-500/20 focus:border-pool-500"
                      />
                      <input
                        type="time"
                        value={stop.type === 'pool' ? form.next_due_time : form.scheduled_time}
                        onChange={e => stop.type === 'pool'
                          ? setForm(f => ({ ...f, next_due_time: e.target.value }))
                          : setForm(f => ({ ...f, scheduled_time: e.target.value }))
                        }
                        className="w-28 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pool-500/20 focus:border-pool-500"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {stop.scheduled_display
                          || (stop.scheduled_date ? new Date(stop.scheduled_date).toLocaleDateString('en-AU') : null)
                          || (stop.next_due_at ? new Date(stop.next_due_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '—')}
                      </div>
                      {stop.time_display && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{stop.time_display}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
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

            {/* Phone */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400"><PhoneIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Client Phone</p>
                  {quickEdit ? (
                    <input
                      type="tel"
                      value={form.client_phone}
                      onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))}
                      placeholder="e.g. 0412 345 678"
                      className="w-full mt-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pool-500/20 focus:border-pool-500"
                    />
                  ) : (
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {stop.phone ? (
                        <a href={`tel:${stop.phone}`} className="text-pool-600 font-semibold">{stop.phone}</a>
                      ) : '—'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400"><MailIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Client Email</p>
                  {quickEdit ? (
                    <input
                      type="email"
                      value={form.client_email}
                      onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                      placeholder="e.g. client@email.com"
                      className="w-full mt-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pool-500/20 focus:border-pool-500"
                    />
                  ) : (
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {stop.email ? (
                        <a href={`mailto:${stop.email}`} className="text-pool-600 font-semibold break-all">{stop.email}</a>
                      ) : '—'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400"><NoteIcon /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Notes</p>
                  {quickEdit ? (
                    <textarea
                      value={stop.type === 'pool' ? form.access_notes : form.notes}
                      onChange={e => stop.type === 'pool'
                        ? setForm(f => ({ ...f, access_notes: e.target.value }))
                        : setForm(f => ({ ...f, notes: e.target.value }))
                      }
                      placeholder="Gate code, dog, key location..."
                      rows={2}
                      className="w-full mt-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-pool-500/20 focus:border-pool-500 resize-none"
                    />
                  ) : (
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{(stop.type === 'pool' ? stop.access_notes : stop.notes) || '—'}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Tech assign */}
            {staffList.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400">
                    <UserIcon />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Assigned Tech</p>
                    <CustomSelect
                      inline
                      value={pendingStaffId !== null ? pendingStaffId : (stop.assigned_staff_id || '')}
                      onChange={e => {
                        const newVal = e.target.value
                        if (newVal === (stop.assigned_staff_id || '')) {
                          setPendingStaffId(null)
                        } else {
                          setPendingStaffId(newVal)
                        }
                      }}
                      disabled={assigning}
                      placeholder="Unassigned"
                      options={[{ value: '', label: 'Unassigned' }, ...staffList.map(s => ({ value: s.id, label: s.name }))]}
                      className="mt-1"
                    />
                  </div>
                  {assigning && (
                    <div className="w-4 h-4 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                {pendingStaffId !== null && (
                  <div className="flex items-center gap-2 mt-2 ml-12 animate-scale-in">
                    <button
                      onClick={() => setPendingStaffId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors min-h-[32px]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        await handleAssign(pendingStaffId)
                        setPendingStaffId(null)
                      }}
                      disabled={assigning}
                      className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-pool-600 hover:bg-pool-700 transition-colors min-h-[32px] flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Confirm
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Quick edit save/cancel bar */}
            {quickEdit && (
              <div className="px-4 py-3 flex gap-2">
                <button
                  onClick={() => {
                    setQuickEdit(false)
                    // Reset form to original stop values
                    if (stop.type === 'pool') {
                      setForm(f => ({ ...f, pool_address: stop.address || '', pool_address_lat: stop.lat ?? null, pool_address_lng: stop.lng ?? null, client_phone: stop.phone || '', client_email: stop.email || '', access_notes: stop.access_notes || '' }))
                    } else {
                      setForm(f => ({ ...f, address: stop.address || '', address_lat: stop.lat ?? null, address_lng: stop.lng ?? null, client_phone: stop.phone || '', client_email: stop.email || '', notes: stop.notes || '' }))
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleQuickSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-pool-600 hover:bg-pool-700 transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Save
                    </>
                  )}
                </button>
              </div>
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

            {/* The recurring toggle + picker used to live here. They've
                moved to the Recurring page, which is now the only
                place to convert a job into a recurring service or
                edit an existing schedule's pattern. The Schedule view
                is strictly a per-occurrence surface — keeps the
                destructive blast radius to one stop at a time. */}

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
            {staffList.length > 0 && (
              <Select
                label="Assigned Tech"
                value={form.assigned_staff_id}
                onChange={e => setForm(f => ({ ...f, assigned_staff_id: e.target.value }))}
                options={[{ value: '', label: 'Unassigned' }, ...staffList.map(s => ({ value: s.id, label: s.name }))]}
              />
            )}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Client Details</p>
              <div className="space-y-3">
                <Input label="Phone" value={form.client_phone} onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))} placeholder="e.g. 0412 345 678" />
                <Input label="Email" type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} placeholder="e.g. client@email.com" />
              </div>
            </div>
          </div>
        )}

        {editing && stop.type === 'pool' && (
          <div className="space-y-3">
            <AddressAutocomplete
              label="Site Address"
              value={form.pool_address}
              onChange={(v) => setForm(f => ({ ...f, pool_address: v, pool_address_lat: null, pool_address_lng: null }))}
              onSelect={({ address, lat, lng }) => setForm(f => ({ ...f, pool_address: address, pool_address_lat: lat, pool_address_lng: lng }))}
              placeholder="Start typing a street address..."
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Next Service Date" type="date" value={form.next_due_at} onChange={e => setForm(f => ({ ...f, next_due_at: e.target.value /* single-writer-ok: form state */ }))} />
              <Input label="Time" type="time" value={form.next_due_time} onChange={e => setForm(f => ({ ...f, next_due_time: e.target.value }))} />
            </div>
            {/* The schedule pattern picker used to live here. It's now
                only available on the Recurring page so the Schedule
                view stays per-occurrence. The schedule label in the
                modal header (with "Edit recurring schedule →") gives
                the operator a clear path there. */}
            <TextArea label="Notes" value={form.access_notes} onChange={e => setForm(f => ({ ...f, access_notes: e.target.value }))} rows={3} />
            {staffList.length > 0 && (
              <Select
                label="Assigned Tech"
                value={form.assigned_staff_id}
                onChange={e => setForm(f => ({ ...f, assigned_staff_id: e.target.value }))}
                options={[{ value: '', label: 'Unassigned' }, ...staffList.map(s => ({ value: s.id, label: s.name }))]}
              />
            )}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Client Details</p>
              <div className="space-y-3">
                <Input label="Phone" value={form.client_phone} onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))} placeholder="e.g. 0412 345 678" />
                <Input label="Email" type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} placeholder="e.g. client@email.com" />
              </div>
            </div>
          </div>
        )}

        {/* Edit client details (admin) — writes back to the client record */}
        {editDetails && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit client details</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Updates the client record — applies everywhere this client appears.</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Client name</label>
              <Input value={clientForm.name} onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))} placeholder="Client name" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Phone</label>
              <Input type="tel" value={clientForm.phone} onChange={e => setClientForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Email</label>
              <Input type="email" value={clientForm.email} onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" onClick={() => setEditDetails(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSaveClient} loading={saving} className="flex-1">Save</Button>
            </div>
          </div>
        )}

        {/* Mark unable to service (admin) — quick reason, no photos */}
        {unablePick && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-orange-200 dark:border-orange-900 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Mark unable to service</p>
            <div className="flex flex-wrap gap-2">
              {UNABLE_REASONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setUnableReason(r)}
                  className={cn(
                    'px-3 py-2 rounded-full text-sm font-medium border transition-colors',
                    unableReason === r
                      ? 'bg-orange-500 border-orange-500 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-orange-400'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <TextArea value={unableNote} onChange={e => setUnableNote(e.target.value)} rows={2} placeholder="Optional note for the record…" />
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" onClick={() => { setUnablePick(false); setUnableReason(''); setUnableNote('') }} className="flex-1">Cancel</Button>
              <Button onClick={handleAdminUnable} loading={saving} disabled={!unableReason} className="flex-1 bg-orange-600 hover:bg-orange-700">Mark unable</Button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!editDetails && !unablePick && (
          <div className="space-y-2">
            {!isDone && stop.type === 'job' && (
              <Button onClick={handleStartJob} className="w-full">
                {stop.status === 'in_progress' ? 'View Job' : 'Start Job'}
              </Button>
            )}
            {!isDone && stop.type === 'pool' && (
              <Button onClick={handleStartJob} className="w-full">
                Start Service
              </Button>
            )}
            {!isDone && stop.pool_id && (
              <button
                type="button"
                onClick={() => { setUnableReason(''); setUnableNote(''); setUnablePick(true) }}
                className="w-full min-h-[44px] rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-semibold text-sm hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Unable to Service
              </button>
            )}
            <Button variant="danger" onClick={handleDeleteClick} className="w-full">
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleting && setDeleteConfirm(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6 space-y-4 animate-slide-up">
            {/* Warning icon */}
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
                <svg className="w-7 h-7 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>

            {deleteConfirm === 'recurring' ? (
              <>
                {(() => {
                  const stopDate = stop.scheduled_date || stop.next_due_at?.split('T')[0]
                  const weekday = stopDate ? new Date(stopDate + 'T00:00:00').getDay() : null
                  const dayLabel = weekday != null ? DAYS_OF_WEEK.find(d => d.value === weekday)?.long : null
                  // Completed stops are historical service_records, not
                  // future occurrences — different copy + a single
                  // "Delete record" button so the operator understands
                  // they're erasing the history row, not skipping a
                  // future visit.
                  const isCompleted = !!stop.isCompleted
                  return (
                    <>
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                          {isCompleted
                            ? 'Delete this completed service?'
                            : `Skip this ${dayLabel || 'occurrence'}?`}
                        </h3>
                        {isCompleted ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Removes the record (chemistry readings, photos) from history. The recurring schedule stays intact.
                          </p>
                        ) : loadedProfile ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Part of: <span className="font-semibold text-gray-700 dark:text-gray-200">{describeSchedule(loadedProfile)}</span>. {dayLabel ? `Future ${dayLabel}s stay scheduled.` : 'The schedule stays intact.'}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {dayLabel ? `This ${dayLabel} only. Future ${dayLabel}s stay scheduled.` : 'Just this occurrence. The schedule stays intact.'}
                          </p>
                        )}
                      </div>
                      {/* Single destructive action — only ever skips ONE
                          occurrence from the Schedule view. Editing the
                          recurrence pattern itself (drop a weekday, end
                          the schedule, change days/time/etc.) lives on
                          /recurring so the Schedule view can never
                          accidentally nuke an entire schedule. Applies
                          to both type='job' (profile-driven) and
                          type='pool' (legacy) — /recurring now lists
                          legacy pool schedules too, so the redirect is
                          useful for both. */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          disabled={deleting}
                          className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors min-h-tap"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleDeleteSingle}
                          disabled={deleting}
                          className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center gap-2 min-h-tap"
                        >
                          {deleting ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : isCompleted ? (
                            'Delete record'
                          ) : (
                            'Skip this one'
                          )}
                        </button>
                      </div>
                      {!isCompleted && (
                        <p className="text-[11px] text-center text-gray-500 dark:text-gray-400 pt-1">
                          To edit the schedule or remove all future {dayLabel ? `${dayLabel}s` : 'occurrences'},{' '}
                          <button
                            type="button"
                            onClick={() => { onClose?.(); navigate('/recurring-jobs') }}
                            className="font-semibold text-pool-600 dark:text-pool-400 hover:underline"
                          >
                            go to Recurring →
                          </button>
                        </p>
                      )}
                    </>
                  )
                })()}
              </>
            ) : (
              <>
                <div className="text-center">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {stop.type === 'job' ? 'Delete Job' : 'Delete Service'}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Are you sure? This action cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    disabled={deleting}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors min-h-tap"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={deleting}
                    className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center gap-2 min-h-tap"
                  >
                    {deleting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Delete'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function DetailRow({ icon, label, value, subValue, action }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0 text-pool-600 dark:text-pool-400">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{value || '—'}</div>
        {subValue && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subValue}</div>}
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
const UserIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
)
