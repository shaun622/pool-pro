import { useState, useEffect, useContext, createContext, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const BusinessContext = createContext(null)

export function BusinessProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [business, setBusiness] = useState(null)
  const [staffRecord, setStaffRecord] = useState(null) // staff_members row for tech/admin staff
  const [userRole, setUserRole] = useState(null) // 'owner' | 'admin' | 'tech'
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
      setStaffRecord(null)
      setUserRole(null)
      setBusinessLoading(false)
      return
    }

    // User changed — fetch their business (as owner or staff)
    let cancelled = false
    setBusinessLoading(true)

    async function resolve() {
      // 1. Check if they own a business
      const { data: ownedBiz, error: bizErr } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', userId)
        .maybeSingle()

      if (cancelled) return

      if (ownedBiz) {
        setBusiness(ownedBiz)
        setStaffRecord(null)
        setUserRole('owner')
        setBusinessLoading(false)
        return
      }

      // 2. Check if they're a staff member linked via user_id
      const { data: staffRow, error: staffErr } = await supabase
        .from('staff_members')
        .select('*, businesses(*)')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle()

      if (cancelled) return

      if (staffRow && staffRow.businesses) {
        setBusiness(staffRow.businesses)
        setStaffRecord(staffRow)
        // Map role: 'admin'|'manager'|'owner' → admin, everything else → tech
        const r = staffRow.role?.toLowerCase()
        const isAdmin = r === 'admin' || r === 'manager' || r === 'owner'
        setUserRole(isAdmin ? 'admin' : 'tech')
        setBusinessLoading(false)
        return
      }

      // 3. No business found
      if (bizErr) console.error('Error fetching business:', bizErr)
      if (staffErr) console.error('Error fetching staff record:', staffErr)
      setBusiness(null)
      setStaffRecord(null)
      setUserRole(null)
      setBusinessLoading(false)
    }

    resolve().catch((err) => {
      if (cancelled) return
      console.error('Network error fetching business:', err)
      setBusiness(null)
      setStaffRecord(null)
      setUserRole(null)
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
    setUserRole('owner')
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
    lastUserId.current = null // force re-resolve
    setBusinessLoading(true)
    // Trigger the effect by resetting the ref — the effect depends on user?.id
    // But since user hasn't changed, we need to manually re-run
    const userId = user.id

    const { data: ownedBiz } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle()

    if (ownedBiz) {
      setBusiness(ownedBiz)
      setStaffRecord(null)
      setUserRole('owner')
      setBusinessLoading(false)
      return
    }

    const { data: staffRow } = await supabase
      .from('staff_members')
      .select('*, businesses(*)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (staffRow && staffRow.businesses) {
      setBusiness(staffRow.businesses)
      setStaffRecord(staffRow)
      const r = staffRow.role?.toLowerCase()
      setUserRole(r === 'admin' || r === 'manager' || r === 'owner' ? 'admin' : 'tech')
    } else {
      setBusiness(null)
      setStaffRecord(null)
      setUserRole(null)
    }
    setBusinessLoading(false)
  }, [user])

  return (
    <BusinessContext.Provider value={{ business, loading, staffRecord, userRole, createBusiness, updateBusiness, refetch }}>
      {children}
    </BusinessContext.Provider>
  )
}

export function useBusiness() {
  const context = useContext(BusinessContext)
  if (!context) throw new Error('useBusiness must be used within BusinessProvider')
  return context
}
