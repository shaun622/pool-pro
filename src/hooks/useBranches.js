import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

// Branches are a lightweight per-business grouping (name + email) used to filter
// the schedule and route service-report office copies. Mirrors useStaff.
export function useBranches() {
  const { business } = useBusiness()
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchBranches = useCallback(async () => {
    if (!business?.id) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at')
    if (!error) setBranches(data || [])
    setLoading(false)
  }, [business?.id])

  useEffect(() => {
    fetchBranches()
  }, [fetchBranches])

  async function createBranch(branchData) {
    const { data, error } = await supabase
      .from('branches')
      .insert({ ...branchData, business_id: business.id })
      .select()
      .single()
    if (error) throw error
    setBranches(prev => [...prev, data])
    return data
  }

  async function updateBranch(id, updates) {
    const { data, error } = await supabase
      .from('branches')
      .update(updates)
      .eq('id', id)
      .eq('business_id', business.id)
      .select()
    if (error) throw error
    const updated = data?.[0]
    if (updated) setBranches(prev => prev.map(b => (b.id === id ? updated : b)))
    return updated
  }

  async function deleteBranch(id) {
    // Clear the FK on any clients pointing at this branch first (they revert to
    // "No branch"), then delete the branch.
    await supabase.from('clients').update({ branch_id: null }).eq('branch_id', id)
    const { error } = await supabase.from('branches').delete().eq('id', id)
    if (error) throw error
    setBranches(prev => prev.filter(b => b.id !== id))
  }

  return {
    branches,
    loading,
    createBranch,
    updateBranch,
    deleteBranch,
    refetch: fetchBranches,
  }
}
