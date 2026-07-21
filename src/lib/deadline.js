// A deadline on any UI-gating await — the second half of the §0.5 lesson.
//
// timeoutFetch (supabase.js) bounds the FETCH itself, but a supabase query first
// resolves its auth token behind the auth lock (getSession → navigator.locks)
// BEFORE fetch is ever called. If the browser froze the tab that held that lock
// (background-tab suspension), the in-process lock queue has NO timeout, so the
// await hangs with no fetch to time out — the "come back to the tab, infinite
// spinner, refresh fixes it" bug. withDeadline bounds the WHOLE awaited promise,
// so any such hang becomes an ordinary REJECT — same catch, same cache fallback,
// same loading-clears. There is NO "deadline state"; a deadline is just a reject
// (mirrors timeoutFetch's rule — do not add an `if (isDeadline)` branch anywhere).
//
// DEADLINE_MS is deliberately LONGER than supabase.js's 30s REQUEST_TIMEOUT_MS, so
// for a plain network stall the per-fetch timeout fires first and this outer bound
// only bites the pre-fetch stalls the fetch timeout can't see.
export const DEADLINE_MS = 35_000

export class DeadlineError extends Error {
  constructor(label, ms) {
    super(`${label || 'operation'} exceeded ${ms}ms deadline`)
    this.name = 'DeadlineError'
  }
}

// Reject if `promise` hasn't settled within `ms`; clears the timer on settle so a
// fast path leaves no dangling timeout. The underlying work may keep running after
// we stop waiting — callers that own an AbortController abort it on reject so the
// abandoned queries can't late-fire; where the work isn't cancellable (auth /
// business resolve), the reject simply routes to the existing cache fallback.
export function withDeadline(promise, ms = DEADLINE_MS, label = 'operation') {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (import.meta.env && import.meta.env.DEV) {
        const route = typeof location !== 'undefined' ? location.pathname : ''
        console.warn(`[deadline] ${label} exceeded ${ms}ms`, 'route:', route)
      }
      reject(new DeadlineError(label, ms))
    }, ms)
  })
  // Promise.resolve() adopts thenables (supabase query builders) into a real
  // promise so Promise.race is safe for both promises and PromiseLike builders.
  return Promise.race([Promise.resolve(promise), deadline]).finally(() => clearTimeout(timer))
}
