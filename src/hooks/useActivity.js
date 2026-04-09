import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

export function useActivity() {
  const { business } = useBusiness()
  const [activities, setActivities] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  async function fetchActivities() {
    if (!business?.id) return
    const { data } = await supabase
      .from('activity_feed')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(50)

    const items = data || []
    setActivities(items)
    setUnreadCount(items.filter(a => !a.is_read).length)
    setLoading(false)
  }

  useEffect(() => {
    if (!business?.id) return
    fetchActivities()

    // Realtime — new activities appear instantly
    const channel = supabase.channel('activity-feed')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_feed',
        filter: `business_id=eq.${business.id}`,
      }, (payload) => {
        setActivities(prev => [payload.new, ...prev].slice(0, 50))
        setUnreadCount(prev => prev + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [business?.id])

  async function markAllRead() {
    if (!business?.id) return
    await supabase
      .from('activity_feed')
      .update({ is_read: true })
      .eq('business_id', business.id)
      .eq('is_read', false)
    setActivities(prev => prev.map(a => ({ ...a, is_read: true })))
    setUnreadCount(0)
  }

  async function markRead(id) {
    await supabase.from('activity_feed').update({ is_read: true }).eq('id', id)
    setActivities(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  return { activities, unreadCount, loading, markAllRead, markRead, refetch: fetchActivities }
}
