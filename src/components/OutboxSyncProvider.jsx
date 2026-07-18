import { useEffect } from 'react'
import { useBusiness } from '../hooks/useBusiness'
import { startOutboxProcessor, setOutboxBusiness } from '../lib/outboxProcessor'

// Mounts the automatic outbox sender. Rendered ABOVE <Routes> (inside
// BusinessProvider) so it is never unmounted by navigation — the sender must run
// continuously on every route for a tech, not just while a specific page is open.
// It holds no UI; it just keeps the module-level singleton alive and fed with the
// current business id (for the wrong-org guard).
export default function OutboxSyncProvider({ children }) {
  const { business } = useBusiness()

  useEffect(() => {
    startOutboxProcessor()
  }, [])

  useEffect(() => {
    setOutboxBusiness(business?.id || null)
  }, [business?.id])

  return children
}
