import { useState, useEffect, useCallback } from 'react'
import { countDraftsAsync, PENDING_EVENT } from '../lib/pendingDrafts'
import { drainOutbox, getOutboxStatus, OUTBOX_STATUS_EVENT } from '../lib/outboxProcessor'

// Live view of the automatic outbox: how many visits are still unsent, and what
// the background sender is doing right now. Sending is AUTOMATIC (see
// outboxProcessor) — this hook no longer owns the send loop. `submit()` is just
// an optional "try now" that nudges the same automatic sender; the tech never
// has to tap anything for a visit to go out.
export function usePendingDrafts() {
  const [count, setCount] = useState(0)
  const [status, setStatus] = useState(() => getOutboxStatus().status)

  const refresh = useCallback(async () => {
    setCount(await countDraftsAsync())
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    const onStatus = (e) => setStatus(e.detail?.status || 'idle')
    window.addEventListener(PENDING_EVENT, onChange)
    window.addEventListener('focus', onChange)
    document.addEventListener('visibilitychange', onChange)
    window.addEventListener(OUTBOX_STATUS_EVENT, onStatus)
    return () => {
      window.removeEventListener(PENDING_EVENT, onChange)
      window.removeEventListener('focus', onChange)
      document.removeEventListener('visibilitychange', onChange)
      window.removeEventListener(OUTBOX_STATUS_EVENT, onStatus)
    }
  }, [refresh])

  // Optional manual nudge — force an immediate retry of every draft. Not required
  // for correctness (the sender retries on its own); it just lets an impatient
  // tech skip the backoff.
  const submit = useCallback(() => { drainOutbox({ force: true }) }, [])

  return { count, status, submitting: status === 'sending', submit, refresh }
}
