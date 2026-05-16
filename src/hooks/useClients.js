import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

export function useClients() {
  const { business } = useBusiness()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchClients = useCallback(async () => {
    if (!business) return
    setLoading(true)
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('business_id', business.id)
      .order('name')
    if (error) console.error('Error fetching clients:', error)
    setClients(data || [])
    setLoading(false)
  }, [business])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const createClient = useCallback(async (clientData) => {
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...clientData, business_id: business.id })
      .select()
      .single()
    if (error) throw error
    setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return data
  }, [business])

  const updateClient = useCallback(async (id, updates) => {
    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setClients(prev => prev.map(c => c.id === id ? data : c))
    return data
  }, [])

  // Hard-delete via SQL function (migration 20260509140000). A plain
  // `delete from clients where id = $1` FK-violates as soon as the
  // client has any pools / recurring profiles / jobs / quotes / invoices /
  // surveys / documents / service history. The RPC walks the FK graph
  // deepest-leaves-first inside a single transaction and authorises
  // against current_business_id() so other businesses' clients can't be
  // touched.
  const deleteClient = useCallback(async (id) => {
    const { error } = await supabase.rpc('delete_client', { p_client_id: id })
    if (error) throw error
    setClients(prev => prev.filter(c => c.id !== id))
  }, [])

  return { clients, loading, createClient, updateClient, deleteClient, refetch: fetchClients }
}
