import { supabase, lastFetchAt } from './supabase'

// Heal a wedged auth client on tab-return.
//
// supabase-js serialises every query's token behind an auth lock
// (navigator.locks). If the browser froze the tab that held that lock
// (background-tab suspension / Memory Saver), the in-process wait has NO timeout,
// so every query hangs BEFORE fetch — the "come back to the tab, infinite spinner,
// refresh fixes it" bug. Layer 1 (withDeadline) keeps the UI from hanging forever;
// this watchdog goes further and automates the manual refresh: on tab-return, if a
// getSession() can't complete in time, the client is wedged → reload once.
//
// Deliberately conservative — reloads ONLY when getSession is provably
// unresponsive (> PROBE_MS, which is > the library's own 5s cross-tab
// acquire+steal window, so a legitimately-recovering client is never reloaded),
// NEVER mid-service-entry, and at most once per COOLDOWN_MS.

const SETTLE_MS = 1500        // let gotrue's own _recoverAndRefresh run first
const PROBE_MS = 8000         // > the lib's 5s cross-tab acquire+steal window
const COOLDOWN_MS = 120_000   // ≥2 min between auto-reloads → no reload loops
const COOLDOWN_KEY = 'authwatchdog:lastReload'

// Never yank a tech mid-service-entry: drafts are durable (IndexedDB) and the
// outbox self-heals after a reload, but losing half-entered readings is bad UX.
const SERVICE_ENTRY_RE = /^\/pools\/[^/]+\/service/

let started = false

export function initAuthWatchdog() {
  if (started || typeof document === 'undefined') return
  started = true

  let probing = false
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || probing) return
    probing = true
    // Anchor before the settle delay: any supabase fetch that STARTS from here on
    // proves the client is making network progress (alive, just slow) rather than
    // wedged — a wedge queues every query behind a frozen in-process lock BEFORE
    // any fetch, so no fetch ever starts.
    const probeAnchor = Date.now()
    setTimeout(async () => {
      let timer
      try {
        if (document.visibilityState !== 'visible') return
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('probe-timeout')), PROBE_MS)
        })
        await Promise.race([supabase.auth.getSession(), timeout])
        // getSession resolved → the client is healthy; nothing to do.
      } catch {
        // The probe timed out. Reload ONLY for a genuine WEDGE. If any fetch has
        // started since we began watching, the client is alive but slow (e.g. a
        // token refresh over a weak uplink) — reloading wouldn't help and would
        // recur, so leave the slowness to Layer 1 (withDeadline), don't reload.
        if (lastFetchAt() > probeAnchor) return
        maybeReload()
      } finally {
        clearTimeout(timer)
        probing = false
      }
    }, SETTLE_MS)
  })
}

function maybeReload() {
  if (document.visibilityState !== 'visible') return
  if (SERVICE_ENTRY_RE.test(location.pathname)) {
    console.warn('[authwatchdog] auth client looks wedged, but on service-entry route — not reloading')
    return
  }
  try {
    const last = Number(sessionStorage.getItem(COOLDOWN_KEY) || 0)
    if (Date.now() - last < COOLDOWN_MS) return
    sessionStorage.setItem(COOLDOWN_KEY, String(Date.now()))
  } catch { /* sessionStorage unavailable — proceed with the reload */ }
  console.warn('[authwatchdog] auth client wedged on tab-return — reloading to recover')
  location.reload()
}
