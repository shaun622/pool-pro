import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

export function usePools(clientId) {
  const { business } = useBusiness()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchPools = useCallback(async () => {
    if (!business) return
    setLoading(true)
    let query = supabase
      .from('pools')
      .select('*, clients(name, email)')
      .eq('business_id', business.id)
      .order('route_order')

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data, error } = await query
    if (error) console.error('Error fetching pools:', error)
    setPools(data || [])
    setLoading(false)
  }, [business, clientId])

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  const createPool = useCallback(async (poolData) => {
    const { data, error } = await supabase
      .from('pools')
      .insert({ ...poolData, business_id: business.id })
      .select('*, clients(name, email)')
      .single()
    if (error) throw error
    setPools(prev => [...prev, data])
    return data
  }, [business])

  const updatePool = useCallback(async (id, updates) => {
    const { data, error } = await supabase
      .from('pools')
      .update(updates)
      .eq('id', id)
      .select('*, clients(name, email)')
      .single()
    if (error) throw error
    setPools(prev => prev.map(p => p.id === id ? data : p))
    return data
  }, [])

  const deletePool = useCallback(async (id) => {
    const { error } = await supabase.from('pools').delete().eq('id', id)
    if (error) throw error
    setPools(prev => prev.filter(p => p.id !== id))
  }, [])

  return { pools, loading, createPool, updatePool, deletePool, refetch: fetchPools }
}

export function usePool(poolId) {
  const [pool, setPool] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!poolId) return
    supabase
      .from('pools')
      .select('*, clients(name, email, phone)')
      .eq('id', poolId)
      .single()
      .then(({ data, error }) => {
        if (error) console.error('Error fetching pool:', error)
        setPool(data)
        setLoading(false)
      })
  }, [poolId])

  return { pool, loading, setPool }
}
