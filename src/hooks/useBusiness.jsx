import { useState, useEffect, useContext, createContext, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const BusinessContext = createContext(null)

export function BusinessProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [business, setBusiness] = useState(null)
  const [businessLoading, setBusinessLoading] = useState(true)
  const lastUserId = useRef(null)

  useEffect(() => {
    // Still waiting for auth to resolve
    if (authLoading) return

    const userId = user?.id || null

    // If user hasn't changed, don't refetch
    if (userId === lastUserId.current) return
    lastUserId.current = userId

    if (!userId) {
      setBusiness(null)
      setBusinessLoading(false)
      return
    }

    // User changed — fetch their business
    let cancelled = false
    setBusinessLoading(true)

    supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('Error fetching business:', error)
        setBusiness(data || null)
        setBusinessLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Network error fetching business:', err)
        setBusiness(null)
        setBusinessLoading(false)
      })

    return () => { cancelled = true }
  }, [authLoading, user?.id])

  const loading = authLoading || businessLoading

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

  const refetch = useCallback(async () => {
    if (!user) return
    setBusinessLoading(true)
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle()
      if (error) console.error('Error fetching business:', error)
      setBusiness(data || null)
    } catch (err) {
      console.error('Network error fetching business:', err)
      setBusiness(null)
    }
    setBusinessLoading(false)
  }, [user])

  return (
    <BusinessContext.Provider value={{ business, loading, createBusiness, updateBusiness, refetch }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  const context = useContext(BusinessContext)
  if (!context) throw new Error('useBusiness must be used within BusinessProvider')
  return context
}
