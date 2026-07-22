import { useEffect } from 'react'
import { useBusiness } from '../hooks/useBusiness'
import { setCrewIdentity, startCrewSync, stopCrewSync } from '../lib/crewSync'

// Reports THIS device's outbox pending-count to `tech_sync_status` so the operator
// dashboard can show who is still uploading. Mounted above <Routes> (inside
// BusinessProvider) alongside OutboxSyncProvider. Holds no UI — just a lifecycle binding.
//
// Keyed effect (NOT mount-once): staffRecord resolves asynchronously and is null on the
// first render for every tech, so a mount-once effect would never start once it arrives.
// Cleanup on change/unmount keeps it StrictMode-safe. Owners have no staff_members row
// (staffRecord === null) → no heartbeat, by design. Note: pending drafts are device-
// scoped IndexedDB, so on a SHARED phone the queue is reported under whichever staff
// member is currently signed in.
export default function CrewSyncProvider({ children }) {
  const { business, staffRecord } = useBusiness()

  useEffect(() => {
    if (!business?.id || !staffRecord?.id) return undefined
    setCrewIdentity({
      businessId: business.id,
      staffId: staffRecord.id,
      staffName: staffRecord.name || null,
      staffPhone: staffRecord.phone || null,
    })
    startCrewSync()
    return () => stopCrewSync()
  }, [business?.id, staffRecord?.id, staffRecord?.name, staffRecord?.phone])

  return children
}
