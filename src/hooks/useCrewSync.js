import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useBusiness } from './useBusiness'

// Per-tech offline-upload status for the operator dashboard, fed by each device's
// crewSync heartbeat (tech_sync_status). Rows are per (staff, device); we AGGREGATE per
// staff so a second idle device can't hide a field phone's real queue.
//
// Realtime: mirrors useActivity, extended to event:'*' (this table is almost all
// UPDATEs after each device's first row — refetch-on-any-change makes payload shape
// irrelevant). Filtered DELETE events don't arrive under default replica identity, which
// is harmless here: we only ever upsert, so nothing relies on live delete delivery.

// Rank so a device that's "failed"/"auth" wins over one that's calmly "sending".
const STATUS_RANK = { idle: 0, sending: 1, retrying: 2, stuck: 3, 'wrong-org': 4, auth: 5, failed: 6 }

function aggregatePerStaff(rows) {
  const byStaff = new Map()
  for (const r of rows) {
    const cur = byStaff.get(r.staff_id)
    if (!cur) {
      byStaff.set(r.staff_id, {
        staff_id: r.staff_id,
        staff_name: r.staff_name,
        staff_phone: r.staff_phone,
        pending_count: r.pending_count || 0,
        outbox_status: r.outbox_status || 'idle',
        oldest_pending_at: r.oldest_pending_at || null,
        updated_at: r.updated_at || null,
      })
      continue
    }
    cur.pending_count += r.pending_count || 0
    // Most-recent signal wins for freshness + the name/phone we display.
    if (r.updated_at && (!cur.updated_at || r.updated_at > cur.updated_at)) {
      cur.updated_at = r.updated_at
      cur.staff_name = r.staff_name || cur.staff_name
      cur.staff_phone = r.staff_phone || cur.staff_phone
    }
    // Oldest queued across this staff's devices (min timestamp).
    if (r.oldest_pending_at && (!cur.oldest_pending_at || r.oldest_pending_at < cur.oldest_pending_at)) {
      cur.oldest_pending_at = r.oldest_pending_at
    }
    // Worst (most-actionable) status across devices.
    if ((STATUS_RANK[r.outbox_status] ?? 0) > (STATUS_RANK[cur.outbox_status] ?? 0)) {
      cur.outbox_status = r.outbox_status
    }
  }
  return Array.from(byStaff.values())
}

export function useCrewSync() {
  const { business } = useBusiness()
  const [crew, setCrew] = useState([])

  useEffect(() => {
    if (!business?.id) return undefined
    let active = true

    async function load() {
      const { data } = await supabase
        .from('tech_sync_status')
        .select('*')
        .eq('business_id', business.id)
      if (active) setCrew(aggregatePerStaff(data || []))
    }
    load()

    // Unique channel name to survive StrictMode double-mount (mirrors useActivity).
    const uniqueId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = supabase.channel(`crew-sync-${business.id}-${uniqueId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tech_sync_status',
        filter: `business_id=eq.${business.id}`,
      }, () => load())
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [business?.id])

  return crew
}
