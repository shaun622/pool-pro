import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

// A single ceiling on EVERY request. Browser fetch has no timeout, so a
// dead-but-open connection makes an awaited read hang forever — which sticks the
// app on an infinite loading spinner (a hang never rejects, so no cache/finally
// path fires). This wrapper turns every hang into an ordinary REJECT (an aborted
// fetch), which the app already handles. There is NO "timeout state" — a timeout
// is just another rejected fetch. Do not add an `if (isTimeout)` branch anywhere.
//
// Uniform ~30s (matches the outbox's own 25s upload/RPC ceiling): storage-js
// upload() can't carry its own AbortSignal, so a shorter read default would kill a
// slow photo upload. We must never abort a legitimate upload. Reads getting 30s is
// fine — background refetches never show a spinner (Schedule uses hasLoadedRef), so
// a read timeout is invisible except on the rare initial-load hang.
const REQUEST_TIMEOUT_MS = 30_000

// Combine the caller's signal (e.g. the outbox's own 25s AbortController) with our
// timeout signal: abort when EITHER fires. Never replace or ignore the caller's
// signal. Manual AbortController on purpose — AbortSignal.any/timeout lag on iOS
// Safari. Every fetch option is spread through unchanged (headers/body/credentials).
function timeoutFetch(input, init = {}) {
  const controller = new AbortController()
  const started = Date.now()
  const timer = setTimeout(() => {
    if (import.meta.env.DEV) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const route = typeof location !== 'undefined' ? location.pathname : ''
      console.warn(`[supabase] request timed out after ${Date.now() - started}ms`, url, 'route:', route)
    }
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  const callerSignal = init.signal
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
})
