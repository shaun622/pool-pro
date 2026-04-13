import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

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

  const saveChemicalsAdded = useCallback(async (serviceRecordId, chemicals) => {
    if (!chemicals.length) return
    const rows = chemicals.map(c => ({
      service_record_id: serviceRecordId,
      product_name: c.product_name,
      quantity: c.quantity,
      unit: c.unit,
      cost: c.cost || null,
    }))
    const { error } = await supabase.from('chemicals_added').insert(rows)
    if (error) throw error
  }, [])

  const completeService = useCallback(async (serviceRecordId, poolId, notes) => {
    setLoading(true)
    try {
      const { error } = await supabase
        .from('service_records')
        .update({ status: 'completed', notes, serviced_at: new Date().toISOString() })
        .eq('id', serviceRecordId)

      if (error) throw error

      // Update pool last_serviced_at
      const { data: pool } = await supabase
        .from('pools')
        .select('schedule_frequency')
        .eq('id', poolId)
        .single()

      const now = new Date()
      const nextDue = calculateNextDueDate(now, pool?.schedule_frequency || 'weekly')

      await supabase
        .from('pools')
        .update({ last_serviced_at: now.toISOString(), next_due_at: nextDue.toISOString() })
        .eq('id', poolId)

      // Increment completed_visits on any active recurring profile for this pool
      try {
        const { data: profiles } = await supabase
          .from('recurring_job_profiles')
          .select('id, duration_type, total_visits, completed_visits, status')
          .eq('pool_id', poolId)
          .eq('is_active', true)
          .in('status', ['active'])
          .limit(1)

        if (profiles?.length) {
          const profile = profiles[0]
          const newCount = (profile.completed_visits || 0) + 1
          const updates = { completed_visits: newCount }
          // Auto-complete if we've hit the visit target
          if (profile.duration_type === 'num_visits' && profile.total_visits && newCount >= profile.total_visits) {
            updates.status = 'completed'
          }
          await supabase.from('recurring_job_profiles').update(updates).eq('id', profile.id)
        }
      } catch (e) {
        console.warn('Recurring profile update failed (non-critical):', e)
      }

      // Fire-and-forget email notifications (don't block completion)
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

  const saveServicePhoto = useCallback(async (serviceRecordId, file) => {
    // Convert to WebP client-side to save storage
    const webpBlob = await convertToWebP(file, 1200, 0.82)
    const path = `${business.id}/${serviceRecordId}/${Date.now()}.webp`
    const { error: uploadErr } = await supabase.storage
      .from('service-photos')
      .upload(path, webpBlob, { upsert: true, contentType: 'image/webp' })
    if (uploadErr) throw uploadErr
    const { data: urlData } = supabase.storage
      .from('service-photos')
      .getPublicUrl(path)
    const { error: insertErr } = await supabase
      .from('service_photos')
      .insert({
        service_record_id: serviceRecordId,
        storage_path: path,
        signed_url: urlData.publicUrl,
        tag: 'test-kit',
      })
    if (insertErr) throw insertErr
    return urlData.publicUrl
  }, [business])

  return { loading, createServiceRecord, saveChemicalLog, saveTasks, saveChemicalsAdded, saveServicePhoto, completeService, getServiceHistory }
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

function calculateNextDueDate(from, frequency) {
  const date = new Date(from)
  switch (frequency) {
    case 'weekly': date.setDate(date.getDate() + 7); break
    case 'fortnightly': date.setDate(date.getDate() + 14); break
    case 'monthly': date.setMonth(date.getMonth() + 1); break
    case '6_weekly': date.setDate(date.getDate() + 42); break
    case 'quarterly': date.setDate(date.getDate() + 90); break
    default: date.setDate(date.getDate() + 7)
  }
  return date
}
