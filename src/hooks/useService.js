import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'
import { recomputePoolNextDue } from '../lib/recomputePoolNextDue'

export function useService() {
  const { business } = useBusiness()
  const [loading, setLoading] = useState(false)

  const createServiceRecord = useCallback(async (poolId, technicianName, staffId) => {
    const record = {
      business_id: business.id,
      pool_id: poolId,
      technician_name: technicianName || 'Owner',
      status: 'in_progress',
    }
    if (staffId) record.staff_id = staffId
    const { data, error } = await supabase
      .from('service_records')
      .insert(record)
      .select()
      .single()
    if (error) throw error
    return data
  }, [business])

  const saveChemicalLog = useCallback(async (serviceRecordId, readings) => {
    const { data, error } = await supabase
      .from('chemical_logs')
      .insert({ service_record_id: serviceRecordId, ...readings })
      .select()
      .single()
    if (error) throw error
    return data
  }, [])

  const saveTasks = useCallback(async (serviceRecordId, tasks) => {
    const rows = tasks.map(t => ({
      service_record_id: serviceRecordId,
      task_name: t.name,
      completed: t.completed,
    }))
    const { error } = await supabase.from('service_tasks').insert(rows)
    if (error) throw error
  }, [])

  // Save chemicals dosed (and/or stock noted as remaining at the
  // client) for a service. Each row carries dose_text (freeform —
  // "100g", "1kg") and/or stock_remaining (also freeform — "3kg",
  // "half a bag"). Either or both can be present; the caller filters
  // out rows where both are blank. Legacy (quantity, unit) is kept
  // nullable for back-compat with old reads.
  const saveChemicalsAdded = useCallback(async (serviceRecordId, chemicals) => {
    if (!chemicals.length) return
    const rows = chemicals.map(c => ({
      service_record_id: serviceRecordId,
      product_name: c.product_name,
      dose_text: c.dose_text || null,
      stock_remaining: c.stock_remaining || null,
      quantity: c.quantity != null && c.quantity !== '' ? c.quantity : null,
      unit: c.unit || null,
      cost: c.cost || null,
    }))
    const { error } = await supabase.from('chemicals_added').insert(rows)
    if (error) throw error
  }, [])

  const completeService = useCallback(async (serviceRecordId, poolId, notes, scheduledDate) => {
    setLoading(true)
    try {
      const now = new Date()
      // Record against the serviced OCCURRENCE's day (not necessarily today) so
      // the schedule + chokepoint attribute it to the right stop. See occurrenceServicedAt.
      const occYmd = (scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) ? scheduledDate : ymdLocal(now)
      const servicedAt = occurrenceServicedAt(occYmd, now)
      // 1. Mark the record completed.
      const { error } = await supabase
        .from('service_records')
        .update({ status: 'completed', notes, serviced_at: servicedAt })
        .eq('id', serviceRecordId)
      if (error) throw error

      // 2. last_serviced_at — display-only history of the most recent service.
      await supabase.from('pools').update({ last_serviced_at: servicedAt }).eq('id', poolId)

      // 3. Clear any auto-generated job for that occurrence off the schedule.
      try {
        await supabase
          .from('jobs')
          .update({ status: 'completed' })
          .eq('pool_id', poolId)
          .eq('scheduled_date', occYmd)
          .in('status', ['scheduled', 'in_progress'])
      } catch (e) {
        console.warn('Mark-jobs-completed failed (non-critical):', e)
      }

      // 4. Bump completed_visits on the active profile (history side-effect for
      // the num_visits duration limit). AWAITED before the recompute so the
      // chokepoint's fresh read sees the post-bump count (no off-by-one).
      try {
        const { data: profiles } = await supabase
          .from('recurring_job_profiles')
          .select('id, completed_visits')
          .eq('pool_id', poolId)
          .eq('is_active', true)
          .in('status', ['active'])
          .limit(1)
        if (profiles?.length) {
          await supabase
            .from('recurring_job_profiles')
            .update({ completed_visits: (profiles[0].completed_visits || 0) + 1 })
            .eq('id', profiles[0].id)
        }
      } catch (e) {
        console.warn('completed_visits bump failed (non-critical):', e)
      }

      // 5. THE single chokepoint recomputes next_due_at from the fixed pattern +
      // the (now updated) history, ending/mirroring profiles as needed.
      try {
        await recomputePoolNextDue(poolId, { now })
      } catch (e) {
        console.warn('recomputePoolNextDue failed (non-critical):', e)
      }

      // 6. Fire-and-forget email notifications (don't block completion)
      supabase.functions.invoke('complete-service', {
        body: { service_record_id: serviceRecordId }
      }).then(({ data, error }) => {
        if (error) console.error('Email function error:', error)
        else console.log('Email result:', data)
      }).catch(e => console.error('Edge function failed:', e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Tech couldn't service the pool (locked gate, no access, etc.). Records
  // a service_record with status='unable_to_service' (+ reason and optional
  // note), then "skips to the next normal service": advances next_due_at by
  // one cycle so the stop clears off the active route and the recurrence
  // continues — WITHOUT marking it serviced. No last_serviced_at write, no
  // completed_visits bump (no visit happened). Photos are saved by the
  // caller (tag='unable_access') before this runs, mirroring handleComplete.
  const markUnableToService = useCallback(async (serviceRecordId, poolId, { reason, note, scheduledDate } = {}) => {
    setLoading(true)
    try {
      const now = new Date()
      // Record against the OCCURRENCE's day (the stop that couldn't be serviced),
      // not today — otherwise marking a future stop unable draws a phantom stop on
      // today and fails to clear the real occurrence. See occurrenceServicedAt.
      const occYmd = (scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) ? scheduledDate : ymdLocal(now)
      const { error } = await supabase
        .from('service_records')
        .update({
          status: 'unable_to_service',
          unable_reason: reason || null,
          notes: note || null,
          serviced_at: occurrenceServicedAt(occYmd, now),
        })
        .eq('id', serviceRecordId)
      if (error) throw error

      // Drop that occurrence's real job (if any) off the active route. Active lists
      // key on 'scheduled'/'in_progress', so this clears it without it ever
      // counting as completed.
      try {
        await supabase
          .from('jobs')
          .update({ status: 'unable_to_service' })
          .eq('pool_id', poolId)
          .eq('scheduled_date', occYmd)
          .in('status', ['scheduled', 'in_progress'])
      } catch (e) {
        console.warn('Unable-to-service job update failed (non-critical):', e)
      }

      // In-app bell alert for the office — works even before the email
      // function is deployed. RLS allows staff inserts via current_business_id().
      try {
        const { data: rec } = await supabase
          .from('service_records')
          .select('pools(address, clients(name))')
          .eq('id', serviceRecordId)
          .single()
        const clientName = rec?.pools?.clients?.name || 'A client'
        const address = rec?.pools?.address || ''
        await supabase.from('activity_feed').insert({
          business_id: business.id,
          type: 'service_unable',
          title: 'Unable to service',
          description: `${clientName}${address ? ' · ' + address : ''}${reason ? ' — ' + reason : ''}`,
          link_to: `/services/${serviceRecordId}`,
        })
      } catch (e) {
        console.warn('Unable-to-service activity insert failed (non-critical):', e)
      }

      // Recompute next_due via the chokepoint — the unable record fulfils the
      // occurrence, so the pattern advances exactly one (fixed weekday kept).
      // No last_serviced_at, no completed_visits bump (nothing was serviced).
      try {
        await recomputePoolNextDue(poolId, { now })
      } catch (e) {
        console.warn('recomputePoolNextDue failed (non-critical):', e)
      }

      // Fire-and-forget admin email: reason + photos + full customer contact.
      supabase.functions.invoke('unable-service', {
        body: { service_record_id: serviceRecordId }
      }).then(({ error }) => {
        if (error) console.error('Unable-service email error:', error)
      }).catch(e => console.error('Unable-service edge function failed:', e))
    } finally {
      setLoading(false)
    }
  }, [business])

  const getServiceHistory = useCallback(async (poolId, limit = 10) => {
    const { data, error } = await supabase
      .from('service_records')
      .select(`
        *,
        chemical_logs(*),
        service_tasks(*),
        chemicals_added(*),
        service_photos(*)
      `)
      .eq('pool_id', poolId)
      .eq('status', 'completed')
      .order('serviced_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  }, [])

  // tag distinguishes the mandatory arrival/test-kit shot from
  // optional "things" photos (water condition, equipment, issues
  // found on site). Default stays 'test-kit' so existing callers that
  // omit the tag keep the old behaviour.
  const saveServicePhoto = useCallback(async (serviceRecordId, file, meta = {}, tag = 'test-kit') => {
    // If file is already a Blob (watermarked WebP), upload directly; otherwise convert
    const isBlob = file instanceof Blob && !(file instanceof File)
    const uploadBlob = isBlob ? file : await convertToWebP(file, 1200, 0.82)
    const path = `${business.id}/${serviceRecordId}/${Date.now()}.webp`
    const { error: uploadErr } = await supabase.storage
      .from('service-photos')
      .upload(path, uploadBlob, { upsert: true, contentType: 'image/webp' })
    if (uploadErr) throw uploadErr
    const { data: urlData } = supabase.storage
      .from('service-photos')
      .getPublicUrl(path)
    const row = {
      service_record_id: serviceRecordId,
      storage_path: path,
      signed_url: urlData.publicUrl,
      tag,
    }
    if (meta.lat) row.latitude = meta.lat
    if (meta.lng) row.longitude = meta.lng
    if (meta.timestamp) row.captured_at = meta.timestamp
    const { error: insertErr } = await supabase
      .from('service_photos')
      .insert(row)
    if (insertErr) throw insertErr
    return urlData.publicUrl
  }, [business])

  return { loading, createServiceRecord, saveChemicalLog, saveTasks, saveChemicalsAdded, saveServicePhoto, completeService, markUnableToService, getServiceHistory }
}

function convertToWebP(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('WebP conversion failed')),
        'image/webp',
        quality
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

// Local YYYY-MM-DD — used for next_generation_at (a DATE column) so we don't
// shift a day via toISOString() in UTC-ahead timezones (e.g. QLD = UTC+10,
// where a local-midnight Date's toISOString() lands on the previous day).
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A service record represents a specific scheduled OCCURRENCE. Its serviced_at
// must fall on that occurrence's calendar day, otherwise: (a) the Schedule
// renders the record on the wrong day (the "phantom stop on today" bug when an
// admin marks a future occurrence), and (b) the chokepoint's half-open
// [occ,nextOcc) fulfillment match clears the wrong occurrence (or none).
// Given the occurrence ymd ('YYYY-MM-DD'), return an ISO timestamp on that day
// at the current clock time. Falls back to now() for genuine same-day service.
function occurrenceServicedAt(scheduledDate, now) {
  if (!scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return now.toISOString()
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const sa = new Date(now)
  sa.setFullYear(y, m - 1, d)
  return sa.toISOString()
}

// (nextFixedOccurrence + calculateNextDueDate removed — next_due_at is now owned
// solely by recomputePoolNextDue, computed from the fixed pattern + history.)
