import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

const PLAN_STAFF_LIMITS = {
  trial: 1,
  starter: 2,
  pro: 10,
}

export function useStaff() {
  const { business } = useBusiness()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  const staffLimit = PLAN_STAFF_LIMITS[business?.plan] || 1
  const canAddStaff = staff.filter(s => s.is_active).length < staffLimit

  const fetchStaff = useCallback(async () => {
    if (!business?.id) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at')
    if (!error) setStaff(data || [])
    setLoading(false)
  }, [business?.id])

  useEffect(() => {
    fetchStaff()
  }, [fetchStaff])

  async function createStaff(staffData) {
    const { data, error } = await supabase
      .from('staff_members')
      .insert({ ...staffData, business_id: business.id })
      .select()
      .single()
    if (error) throw error
    setStaff(prev => [...prev, data])
    return data
  }

  async function updateStaff(id, updates) {
    const { data, error } = await supabase
      .from('staff_members')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setStaff(prev => prev.map(s => (s.id === id ? data : s)))
    return data
  }

  async function deleteStaff(id) {
    // Clear foreign key references before deleting
    await Promise.all([
      supabase.from('service_records').update({ staff_id: null }).eq('staff_id', id),
      supabase.from('clients').update({ assigned_staff_id: null }).eq('assigned_staff_id', id),
      supabase.from('pools').update({ assigned_staff_id: null }).eq('assigned_staff_id', id),
      supabase.from('jobs').update({ assigned_staff_id: null }).eq('assigned_staff_id', id),
      supabase.from('recurring_job_profiles').update({ assigned_staff_id: null }).eq('assigned_staff_id', id),
    ])
    const { error } = await supabase
      .from('staff_members')
      .delete()
      .eq('id', id)
    if (error) throw error
    setStaff(prev => prev.filter(s => s.id !== id))
  }

  async function uploadPhoto(file) {
    const ext = file.name.split('.').pop()
    const path = `${business.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('staff-photos')
      .upload(path, file, { upsert: true })
    if (error) throw error
    const { data: urlData } = supabase.storage
      .from('staff-photos')
      .getPublicUrl(path)
    return urlData.publicUrl
  }

  return {
    staff,
    loading,
    staffLimit,
    canAddStaff,
    createStaff,
    updateStaff,
    deleteStaff,
    uploadPhoto,
    refetch: fetchStaff,
  }
}
