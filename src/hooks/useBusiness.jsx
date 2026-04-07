import { useState, useEffect, useContext, createContext, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const BusinessContext = createContext(null)

export function BusinessProvider({ children }) {
  const { user } = useAuth()
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchBusiness = useCallback(async () => {
    if (!user) {
      setBusiness(null)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('Error fetching business:', error)
      }
      setBusiness(data || null)
    } catch (err) {
      console.error('Network error fetching business:', err)
      setBusiness(null)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchBusiness()
  }, [fetchBusiness])

  const createBusiness = useCallback(async (businessData) => {
    const { data, error } = await supabase
      .from('businesses')
      .insert({ ...businessData, owner_id: user.id })
      .select()
      .single()
    if (error) throw error
    setBusiness(data)
    return data
  }, [user])

  const updateBusiness = useCallback(async (updates) => {
    const { data, error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', business.id)
      .select()
      .single()
    if (error) throw error
    setBusiness(data)
    return data
  }, [business])

  return (
    <BusinessContext.Provider value={{ business, loading, createBusiness, updateBusiness, refetch: fetchBusiness }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  const context = useContext(BusinessContext)
  if (!context) throw new Error('useBusiness must be used within BusinessProvider')
  return context
}
