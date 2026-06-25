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

  const completeService = useCallback(async (serviceRecordId, poolId, notes, opts = {}) => {
    setLoading(true)
    try {
      const now = new Date()
      // opts = { occurrenceDate 'YYYY-MM-DD', recurringProfileId }. Back-compat:
      // a bare string is treated as occurrenceDate.
      const { occurrenceDate, recurringProfileId } =
        typeof opts === 'string' ? { occurrenceDate: opts } : (opts || {})
      const occYmd = (occurrenceDate && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) ? occurrenceDate : ymdLocal(now)
      // 1. Mark completed. serviced_at = when it was ACTUALLY performed; the
      // identity (recurring_profile_id + occurrence_date) records WHICH scheduled
      // visit it fulfils. Identity is set only for recurring services — ad-hoc
      // services stay null (they fulfil no occurrence).
      const { error } = await supabase
        .from('service_records')
        .update({
          status: 'completed',
          notes,
          serviced_at: now.toISOString(),
          recurring_profile_id: recurringProfileId || null,
          occurrence_date: recurringProfileId ? occYmd : null,
        })
        .eq('id', serviceRecordId)
      if (error) {
        // Unique (recurring_profile_id, occurrence_date) → this visit is already
        // fulfilled (double-submit / race). Surface friendly, not a raw DB error.
        if (error.code === '23505') throw new Error('This visit is already recorded for that day — reopen it to re-service.')
        throw error
      }

      // 2. last_serviced_at — display-only history of the most recent service.
      await supabase.from('pools').update({ last_serviced_at: now.toISOString() }).eq('id', poolId)

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

      // 4. Bump completed_visits on THIS occurrence's profile (history side-effect
      // for the num_visits limit). Prefer the explicit profile id (correct for
      // stacked profiles); fall back to the pool's single active profile. AWAITED
      // before the recompute so the chokepoint's fresh read sees the post-bump count.
      try {
        let profId = recurringProfileId || null
        let cur = null
        if (profId) {
          const { data } = await supabase.from('recurring_job_profiles').select('completed_visits').eq('id', profId).single()
          cur = data?.completed_visits
        } else {
          const { data: profiles } = await supabase
            .from('recurring_job_profiles')
            .select('id, completed_visits')
            .eq('pool_id', poolId)
            .eq('is_active', true)
            .in('status', ['active'])
            .limit(1)
          if (profiles?.length) { profId = profiles[0].id; cur = profiles[0].completed_visits }
        }
        if (profId) {
          await supabase
            .from('recurring_job_profiles')
            .update({ completed_visits: (cur || 0) + 1 })
            .eq('id', profId)
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
  const markUnableToService = useCallback(async (serviceRecordId, poolId, { reason, note, occurrenceDate, recurringProfileId } = {}) => {
    setLoading(true)
    try {
      const now = new Date()
      // serviced_at = when the (failed) visit actually happened; identity
      // (recurring_profile_id + occurrence_date) records WHICH scheduled visit
      // this unable report fulfils, so it clears the right occurrence and never
      // draws a phantom on the actual day. Identity only for recurring services.
      const occYmd = (occurrenceDate && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) ? occurrenceDate : ymdLocal(now)
      const { error } = await supabase
        .from('service_records')
        .update({
          status: 'unable_to_service',
          unable_reason: reason || null,
          notes: note || null,
          serviced_at: now.toISOString(),
          recurring_profile_id: recurringProfileId || null,
          occurrence_date: recurringProfileId ? occYmd : null,
        })
        .eq('id', serviceRecordId)
      if (error) {
        if (error.code === '23505') throw new Error('This visit has already been recorded.')
        throw error
      }

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

  // Undo an "unable to service": remove the unable record (and its photos) so
  // the occurrence is UNFULFILLED again, restore any job that was knocked to
  // unable_to_service for that day, and recompute — next_due returns to that
  // occurrence and it shows as due. For when the client reopens access after a
  // failed visit. scheduledDate ('YYYY-MM-DD') is the occurrence's day.
  const revertUnableToService = useCallback(async (serviceRecordId, poolId, scheduledDate) => {
    setLoading(true)
    try {
      const now = new Date()
      // Restore the materialized job (if any) for that occurrence.
      if (scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        try {
          await supabase
            .from('jobs')
            .update({ status: 'scheduled' })
            .eq('pool_id', poolId)
            .eq('scheduled_date', scheduledDate)
            .eq('status', 'unable_to_service')
        } catch (e) { console.warn('revert: job restore failed (non-critical):', e) }
      }
      // Drop the unable record + its photos (FK likely cascades, but be explicit).
      try { await supabase.from('service_photos').delete().eq('service_record_id', serviceRecordId) } catch (e) { /* cascade handles it */ }
      const { error } = await supabase.from('service_records').delete().eq('id', serviceRecordId)
      if (error) throw error
      // The occurrence is unfulfilled again → next_due returns to it.
      try { await recomputePoolNextDue(poolId, { now }) } catch (e) { console.warn('revert: recompute failed (non-critical):', e) }
    } finally {
      setLoading(false)
    }
  }, [])

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
    // If file is already a Blob (watermarked JPEG), upload directly; otherwise convert.
    // JPEG (not WebP) so the photo renders in every email client — Outlook
    // desktop / Outlook.com don't render WebP at all.
    const isBlob = file instanceof Blob && !(file instanceof File)
    const uploadBlob = isBlob ? file : await convertToJpeg(file, 1200, 0.82)
    const path = `${business.id}/${serviceRecordId}/${Date.now()}.jpg`
    const { error: uploadErr } = await supabase.storage
      .from('service-photos')
      .upload(path, uploadBlob, { upsert: true, contentType: 'image/jpeg' })
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

  return { loading, createServiceRecord, saveChemicalLog, saveTasks, saveChemicalsAdded, saveServicePhoto, completeService, markUnableToService, revertUnableToService, getServiceHistory }
}

function convertToJpeg(file, maxSize = 1200, quality = 0.82) {
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
        (blob) => blob ? resolve(blob) : reject(new Error('JPEG conversion failed')),
        'image/jpeg',
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

// (occurrenceServicedAt removed — serviced_at is now the actual performed time;
// which occurrence a record fulfils is stored explicitly as occurrence_date +
// recurring_profile_id, matched by identity rather than by serviced_at bucketing.)

// (nextFixedOccurrence + calculateNextDueDate removed — next_due_at is now owned
// solely by recomputePoolNextDue, computed from the fixed pattern + history.)
