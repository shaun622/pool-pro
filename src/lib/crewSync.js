import { supabase } from './supabase'
import { listDrafts, countDraftsAsync, PENDING_EVENT } from './pendingDrafts'
import { OUTBOX_STATUS_EVENT, getOutboxStatus } from './outboxProcessor'

// ─────────────────────────────────────────────────────────────────────────────
// Crew-sync heartbeat writer.
//
// The tech's phone is the only place that knows its IndexedDB outbox pending count.
// This module reports that count to the `tech_sync_status` table so the operator
// dashboard can show who is still uploading — without messaging the crew.
//
// It is a module-level SINGLETON (like outboxProcessor), driven by CrewSyncProvider.
// Design points that matter (each carries a real failure if dropped):
//   • DEBOUNCE  — a multi-draft drain fires many PENDING_EVENT/status events; we
//     coalesce them (fire at most ~once per DEBOUNCE_MS) so beats don't pile onto the
//     same constrained uplink as the photo uploads they report on.
//   • SINGLE-FLIGHT — at most one upsert in flight; a trigger during a write just
//     re-runs afterwards, rebuilding the LATEST payload (latest-wins).
//   • REAL ABORT — the upsert carries an AbortController aborted at BEAT_TIMEOUT_MS.
//     Beats carry DIFFERENT payloads (unlike the idempotent photo uploads), so a stale
//     beat landing late could regress pending_count under a fresh updated_at. Aborting
//     (not merely un-awaiting) guarantees an abandoned beat cannot land late.
//   • SKIP-UNCHANGED — don't rewrite an identical snapshot.
//   • ZERO-WRITE REPAIR — keep beating until a 0-count write is CONFIRMED, so a failed
//     transition-to-0 can't leave a phantom "N queued" row until the next focus event.
//   • updated_at is owned by a BEFORE UPDATE trigger — never sent from the client.
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_KEY = 'poolpro-device-id'
const DEBOUNCE_MS = 2_500
const BEAT_TIMEOUT_MS = 8_000
const TICK_MS = 60_000

// Stable per-device id (survives reloads). Rows are per (staff, device) so two devices
// on one staff login don't overwrite each other's counts.
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // localStorage blocked (private mode) — a per-session id still works.
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

let _identity = null          // { businessId, staffId, staffName, staffPhone }
let _deviceId = null
let _started = false
let _debounceTimer = null
let _tick = null
let _inFlight = false
let _queued = false           // a trigger arrived while a write was in flight
let _lastWritten = null       // signature of the last SUCCESSFUL write (skip unchanged)
let _lastWrittenCount = null  // pending_count last successfully written (zero-write repair)

// Listener refs so stopCrewSync can remove exactly what startCrewSync added.
let _onPending = null
let _onStatus = null
let _onFocus = null
let _onVis = null

export function setCrewIdentity(identity) {
  _identity = (identity && identity.businessId && identity.staffId) ? { ...identity } : null
}

// One heartbeat: snapshot the live outbox state and upsert it. Best-effort — never
// throws; a schema/shape failure is console.warn'd (NOT silent) so verification can see it.
async function writeBeat() {
  if (!_identity || !_deviceId) return
  const { businessId, staffId, staffName, staffPhone } = _identity

  const drafts = await listDrafts()                       // sorted oldest-first
  const { status } = getOutboxStatus()                    // current snapshot (see note above)
  const pendingCount = drafts.length
  // draft.createdAt is epoch-ms; the column is timestamptz — a raw number 400s the upsert.
  const oldest = drafts[0]?.createdAt ? new Date(drafts[0].createdAt).toISOString() : null

  const sig = `${pendingCount}|${status}|${oldest}`
  if (sig === _lastWritten) return                        // unchanged since last confirmed write

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BEAT_TIMEOUT_MS)
  try {
    const { error } = await supabase
      .from('tech_sync_status')
      .upsert({
        business_id: businessId,
        staff_id: staffId,
        device_id: _deviceId,
        staff_name: staffName || null,
        staff_phone: staffPhone || null,
        pending_count: pendingCount,
        outbox_status: status,
        oldest_pending_at: oldest,
        // updated_at intentionally omitted — the BEFORE UPDATE trigger owns it.
      }, { onConflict: 'staff_id,device_id' })
      .abortSignal(controller.signal)
    if (error) { console.warn('crewSync beat failed:', error.message || error); return }
    _lastWritten = sig
    _lastWrittenCount = pendingCount
  } catch (e) {
    console.warn('crewSync beat error:', e?.message || e)
  } finally {
    clearTimeout(timer)
  }
}

// Single-flight runner: one write at a time; a trigger during a write re-runs it after,
// rebuilding the latest snapshot.
async function runBeat() {
  if (_inFlight) { _queued = true; return }
  _inFlight = true
  try {
    do {
      _queued = false
      await writeBeat()
    } while (_queued)
  } finally {
    _inFlight = false
  }
}

// Coalescing throttle: fire at most once per DEBOUNCE_MS from the FIRST trigger of a
// burst (don't reset the timer — bounds latency AND coalesces, unlike a resetting
// debounce which could starve under continuous events).
function scheduleBeat() {
  if (_debounceTimer) return
  _debounceTimer = setTimeout(() => { _debounceTimer = null; runBeat() }, DEBOUNCE_MS)
}

// 60s safety tick. Idle devices don't beat; keep beating only while there is queued work
// OR a 0-count write hasn't been confirmed yet (zero-write repair).
async function onTick() {
  try {
    const count = await countDraftsAsync()
    if (count > 0 || _lastWrittenCount !== 0) scheduleBeat()
  } catch { /* best-effort */ }
}

export function startCrewSync() {
  if (_started || typeof window === 'undefined') return
  _started = true
  _deviceId = getDeviceId()

  _onPending = () => scheduleBeat()
  _onStatus = () => scheduleBeat()                        // any outbox status change
  _onFocus = () => scheduleBeat()
  _onVis = () => { if (document.visibilityState === 'visible') scheduleBeat() }

  window.addEventListener(PENDING_EVENT, _onPending)
  window.addEventListener(OUTBOX_STATUS_EVENT, _onStatus)
  window.addEventListener('focus', _onFocus)
  document.addEventListener('visibilitychange', _onVis)
  _tick = setInterval(onTick, TICK_MS)

  scheduleBeat()                                          // initial: create/refresh the row
}

export function stopCrewSync() {
  if (!_started) return
  _started = false
  if (_onPending) window.removeEventListener(PENDING_EVENT, _onPending)
  if (_onStatus) window.removeEventListener(OUTBOX_STATUS_EVENT, _onStatus)
  if (_onFocus) window.removeEventListener('focus', _onFocus)
  if (_onVis) document.removeEventListener('visibilitychange', _onVis)
  if (_tick) { clearInterval(_tick); _tick = null }
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null }
  _onPending = _onStatus = _onFocus = _onVis = null
  // Reset write-dedup so a re-start (identity change) writes fresh.
  _lastWritten = null
  _lastWrittenCount = null
}
