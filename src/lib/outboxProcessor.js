import { listDrafts, submitOne, PENDING_EVENT } from './pendingDrafts'
import { updateDraft } from './offlineDb'

// ─────────────────────────────────────────────────────────────────────────────
// Automatic outbox sender.
//
// The field reality: pool techs can't be relied on to babysit a "Submit" button
// or wait out a stalled upload — they refresh (cancelling the send) or re-enter
// the visit (creating a duplicate). So the app sends completed visits BY ITSELF,
// forever, until each one is confirmed. This deliberately supersedes the old
// "no background sync — always a human tap" decision (see poolpro-offline-decisions.md).
//
// This is a module-level SINGLETON, not a hook/provider state, so it survives
// React remounts and route changes. It is started once from OutboxSyncProvider,
// which is mounted ABOVE the router so it is never torn down.
//
// Why automatic retry is safe (can't duplicate): every send reuses the draft's
// serviceRecordId (the RPC idempotency key) and a deterministic upsert photo
// path; the draft is deleted only after the server confirms; the RPC collapses
// replays to `conflict`; the email is guarded by report_sent_at. See
// src/lib/pendingDrafts.js. The one invariant this file must uphold: NEVER mint a
// new serviceRecordId for an existing draft — only ever resend it.
// ─────────────────────────────────────────────────────────────────────────────

// Backoff (ms) indexed by attemptCount. First attempt is immediate; thereafter
// 10s → 30s → 1m → 2m → 5m, then holds at 5m forever. Kind to a weak uplink,
// but never gives up.
const BACKOFF_MS = [0, 10_000, 30_000, 60_000, 120_000, 300_000]
// When drafts remain but none are individually due yet, re-check at least this
// often (safety heartbeat).
const HEARTBEAT_MS = 60_000

// Status broadcast so the "waiting to send" banner can show calm auto-status
// instead of a scary manual button. Values: idle | sending | retrying | auth | wrong-org.
export const OUTBOX_STATUS_EVENT = 'outbox:status'

let _started = false
let _businessId = null
let _draining = false
let _rerun = false
let _forceNext = false
let _timer = null
let _status = 'idle'
let _lastError = null

function backoffFor(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

function setStatus(status, lastError = null) {
  _status = status
  _lastError = lastError
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_STATUS_EVENT, { detail: { status, lastError } }))
  } catch { /* non-browser */ }
}

export function getOutboxStatus() {
  return { status: _status, lastError: _lastError }
}

function scheduleTimer(ms) {
  if (_timer) { clearTimeout(_timer); _timer = null }
  if (ms == null) return
  _timer = setTimeout(() => { _timer = null; drainOutbox() }, Math.max(0, ms))
}

// Tell the processor which business is currently signed in (for the wrong-org
// guard). Changing to a real id triggers an immediate drain.
export function setOutboxBusiness(businessId) {
  const next = businessId || null
  if (next === _businessId) return
  _businessId = next
  if (_businessId) drainOutbox({ force: true })
}

// Request a drain now. `force` retries every draft immediately, ignoring its
// backoff (used for user/connectivity events — a good moment to try). Without
// force, drafts still waiting out their backoff are skipped.
export function kickOutbox({ force = false } = {}) {
  if (force) _forceNext = true
  scheduleTimer(0)
}

export async function drainOutbox({ force = false } = {}) {
  if (force) _forceNext = true
  if (_draining) { _rerun = true; return }
  _draining = true
  try {
    do {
      _rerun = false
      const useForce = _forceNext
      _forceNext = false
      await drainPass(useForce)
    } while (_rerun)
  } finally {
    _draining = false
  }
}

async function drainPass(force) {
  const drafts = await listDrafts()
  if (!drafts.length) { setStatus('idle'); scheduleTimer(null); return }

  const now = Date.now()
  let anyAuth = false
  let anyWrongOrg = false
  let soonestDue = null

  setStatus('sending')

  for (const d of drafts) {
    const dueAt = d.nextAttemptAt || 0
    if (!force && dueAt > now) {
      soonestDue = soonestDue == null ? dueAt : Math.min(soonestDue, dueAt)
      continue
    }

    const status = await submitOne(d, _businessId)
    if (status === 'sent' || status === 'conflict') continue // deleted inside submitOne

    // Failure — keep the draft, stamp retry bookkeeping, back off.
    const attempt = (d.attemptCount || 0) + 1
    const nextAttemptAt = Date.now() + backoffFor(attempt)
    await updateDraft({ ...d, attemptCount: attempt, lastAttemptAt: Date.now(), nextAttemptAt, lastError: status })
    soonestDue = soonestDue == null ? nextAttemptAt : Math.min(soonestDue, nextAttemptAt)
    if (status === 'auth') anyAuth = true
    else if (status === 'wrong-org') anyWrongOrg = true
  }

  const remaining = await listDrafts()
  if (!remaining.length) { setStatus('idle'); scheduleTimer(null); return }

  if (anyAuth) setStatus('auth', 'auth')
  else if (anyWrongOrg) setStatus('wrong-org', 'wrong-org')
  else setStatus('retrying')

  const wait = soonestDue != null ? soonestDue - Date.now() : HEARTBEAT_MS
  scheduleTimer(Math.min(Math.max(0, wait), HEARTBEAT_MS))
}

// Start the singleton once. Wires the triggers that should attempt a send:
// regaining connectivity, bringing the app to the foreground, and a new draft
// being created. Idempotent.
export function startOutboxProcessor() {
  if (_started || typeof window === 'undefined') return
  _started = true

  const kickForce = () => kickOutbox({ force: true })
  window.addEventListener('online', kickForce)
  window.addEventListener('focus', kickForce)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickForce()
  })
  window.addEventListener(PENDING_EVENT, kickForce) // a completion was just saved

  kickOutbox({ force: true }) // drain anything already waiting from a prior session
}
