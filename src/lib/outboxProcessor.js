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
// src/lib/pendingDrafts.js.
//
// ARCHITECTURAL INVARIANT: never mint a new serviceRecordId for an existing draft —
// only ever resend it. The processor mutates ONLY retry metadata
// (attemptCount/nextAttemptAt/lastAttemptAt/lastError/failed), never draft contents.
//
// ARCHITECTURAL INVARIANT: one occurrence produces at most one ServiceRecord. A
// completion carries its recurring_profile_id + occurrence_date (identity); a
// null-identity completion on a multi-profile pool is a bug (audit #3), not a valid
// one-off. The processor never manufactures identity — it sends the draft as written.
// ─────────────────────────────────────────────────────────────────────────────

// Backoff (ms) indexed by attemptCount. First attempt is immediate; thereafter
// 10s → 30s → 1m → 2m → 5m, then holds at 5m forever. Kind to a weak uplink,
// but never gives up.
const BACKOFF_MS = [0, 10_000, 30_000, 60_000, 120_000, 300_000]
// When drafts remain but none are individually due yet, re-check at least this
// often (safety heartbeat).
const HEARTBEAT_MS = 60_000
// A TRANSIENT draft still retrying past either threshold escalates its status from
// the calm "retrying" to "stuck" — it keeps retrying forever, just louder, so a
// genuinely wedged visit gets noticed instead of blending into normal weak-signal.
const STUCK_ATTEMPTS = 100
const STUCK_AGE_MS = 7 * 24 * 60 * 60 * 1000
// In a FORCED rerun, don't re-hit a draft attempted within this window. A mixed pass
// (some sent, some failed) fires PENDING_EVENT → force-kick → immediate rerun, which
// ignores nextAttemptAt; without this a just-failed draft would be re-attempted with
// zero backoff on a flaky link. New drafts (no lastAttemptAt) are unaffected.
const FORCE_MIN_GAP_MS = 5_000

// Status broadcast so the "waiting to send" banner can show calm auto-status
// instead of a scary manual button.
// Values: idle | sending | retrying | stuck | failed | auth | wrong-org.
export const OUTBOX_STATUS_EVENT = 'outbox:status'

let _started = false
let _businessId = null
let _draining = false
let _rerun = false
let _forceNext = false
let _retryFailedNext = false
let _timer = null
let _status = 'idle'
let _lastError = null

function backoffFor(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

// A draft whose transient retries have run long enough to warrant a louder warning.
function isAged(draft) {
  if ((draft.attemptCount || 0) >= STUCK_ATTEMPTS) return true
  const created = draft.createdAt || draft.lastAttemptAt
  return created ? (Date.now() - created) >= STUCK_AGE_MS : false
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
// backoff (used for user/connectivity events — a good moment to try). `retryFailed`
// ALSO re-attempts permanently-failed drafts — reserved for an explicit manual
// "Send now" tap; automatic/event kicks leave failed drafts alone.
export function kickOutbox({ force = false, retryFailed = false } = {}) {
  if (force) _forceNext = true
  if (retryFailed) _retryFailedNext = true
  scheduleTimer(0)
}

export async function drainOutbox({ force = false, retryFailed = false } = {}) {
  if (force) _forceNext = true
  if (retryFailed) _retryFailedNext = true
  if (_draining) { _rerun = true; return }
  _draining = true
  try {
    do {
      _rerun = false
      const useForce = _forceNext
      const useRetryFailed = _retryFailedNext
      _forceNext = false
      _retryFailedNext = false
      await drainPass(useForce, useRetryFailed)
    } while (_rerun)
  } finally {
    _draining = false
  }
}

async function drainPass(force, retryFailed) {
  const drafts = await listDrafts()
  if (!drafts.length) { setStatus('idle'); scheduleTimer(null); return }

  const now = Date.now()
  let anyAuth = false
  let anyWrongOrg = false
  let anyFailed = false
  let anyStuck = false
  let anyRetryable = false
  let soonestDue = null

  setStatus('sending')

  for (const d of drafts) {
    // Permanently failed — never auto-retried. Only an explicit manual "Send now"
    // (retryFailed) re-attempts it; otherwise it just waits for operator attention.
    if (d.failed && !retryFailed) { anyFailed = true; continue }

    // FORCED rerun: skip a draft we JUST attempted so a mid-pass success (which
    // force-kicks a rerun) can't instantly re-hit the just-failed drafts with zero
    // backoff. The scheduled timer still picks this one up at its backoff time.
    if (force && !d.failed && d.lastAttemptAt && (now - d.lastAttemptAt) < FORCE_MIN_GAP_MS) {
      anyRetryable = true
      if (isAged(d)) anyStuck = true
      const dueSoon = d.nextAttemptAt || (d.lastAttemptAt + FORCE_MIN_GAP_MS)
      soonestDue = soonestDue == null ? dueSoon : Math.min(soonestDue, dueSoon)
      continue
    }

    const dueAt = d.nextAttemptAt || 0
    if (!force && !d.failed && dueAt > now) {
      anyRetryable = true
      if (isAged(d)) anyStuck = true
      soonestDue = soonestDue == null ? dueAt : Math.min(soonestDue, dueAt)
      continue
    }

    const status = await submitOne(d, _businessId)
    if (status === 'sent' || status === 'conflict') continue // deleted inside submitOne

    const attempt = (d.attemptCount || 0) + 1

    if (status === 'failed') {
      // PERMANENT: a malformed payload can't succeed on retry. Keep the draft (no
      // data loss), stop auto-retrying, flag for attention.
      await updateDraft({ ...d, attemptCount: attempt, lastAttemptAt: Date.now(), failed: true, lastError: status })
      anyFailed = true
      continue
    }

    // TRANSIENT / auth / wrong-org — keep, back off (with jitter), keep retrying.
    // Jitter avoids a whole crew hammering the server in lockstep on reconnect.
    const base = backoffFor(attempt)
    const jitter = base > 0 ? Math.floor(Math.random() * Math.min(base * 0.3, 10_000)) : 0
    const nextAttemptAt = Date.now() + base + jitter
    const next = { ...d, attemptCount: attempt, lastAttemptAt: Date.now(), nextAttemptAt, lastError: status, failed: false }
    await updateDraft(next)
    anyRetryable = true
    if (status === 'auth') anyAuth = true
    else if (status === 'wrong-org') anyWrongOrg = true
    else if (isAged(next)) anyStuck = true
    soonestDue = soonestDue == null ? nextAttemptAt : Math.min(soonestDue, nextAttemptAt)
  }

  const remaining = await listDrafts()
  if (!remaining.length) { setStatus('idle'); scheduleTimer(null); return }

  // Status precedence, most-actionable first.
  if (anyFailed) setStatus('failed', 'failed')
  else if (anyAuth) setStatus('auth', 'auth')
  else if (anyWrongOrg) setStatus('wrong-org', 'wrong-org')
  else if (anyStuck) setStatus('stuck', 'stuck')
  else setStatus('retrying')

  // Schedule the next pass only if something is actually retryable. If every
  // remaining draft is permanently failed, stop the timer — a manual retry or a
  // connectivity/focus event will re-trigger a drain.
  if (anyRetryable && soonestDue != null) {
    scheduleTimer(Math.min(Math.max(0, soonestDue - Date.now()), HEARTBEAT_MS))
  } else {
    scheduleTimer(null)
  }
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
