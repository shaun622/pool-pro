import { useState, useEffect, useCallback, useRef } from 'react'
import { useBusiness } from './useBusiness'
import { useToast } from '../contexts/ToastContext'
import { countDraftsAsync, submitAll, PENDING_EVENT } from '../lib/pendingDrafts'

// Live count of unsent drafts + a manual Submit action. "Pending", never "sync":
// there is no background sending — submit() only runs when the human taps.
export function usePendingDrafts() {
  const { business } = useBusiness()
  const toast = useToast()
  const [count, setCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const refresh = useCallback(async () => {
    setCount(await countDraftsAsync())
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    window.addEventListener(PENDING_EVENT, onChange)
    window.addEventListener('focus', onChange)
    document.addEventListener('visibilitychange', onChange)
    return () => {
      window.removeEventListener(PENDING_EVENT, onChange)
      window.removeEventListener('focus', onChange)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [refresh])

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      // Always attempt — never trust navigator.onLine to BLOCK (it lies when the
      // link is up but dead). Use it only to word the message.
      const { sent, pending, wrongOrg, auth } = await submitAll(business?.id)
      await refresh()
      if (wrongOrg > 0) {
        toast.error(`${wrongOrg} visit${wrongOrg > 1 ? 's' : ''} belong to another organisation and can't be sent from this account.`)
      }
      if (auth > 0) {
        toast.error(`Sign in again to send ${auth} pending visit${auth > 1 ? 's' : ''}.`)
      }
      if (sent > 0 && pending === 0) {
        toast.success(sent === 1 ? '1 visit sent.' : `${sent} visits sent.`)
      } else if (sent > 0) {
        toast.success(`${sent} sent, ${pending} still pending.`)
      } else if (pending > 0) {
        toast.error(navigator.onLine
          ? `Couldn't send — ${pending} still pending. Try again shortly.`
          : `Still offline — ${pending} will send when you reconnect.`)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [business?.id, refresh, toast])

  return { count, submitting, submit, refresh }
}
