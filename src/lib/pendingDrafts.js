import { supabase } from './supabase'
import { putDraft, getAllDrafts, deleteDraft, quotaOk, SCHEMA_VERSION } from './offlineDb'
import { recomputePoolNextDue } from './recomputePoolNextDue'

// Manual draft & submit — the offline model. Every completion/unable report is
// written as a durable local DRAFT, then submitted. Online, the submitting tap
// is the same tap; offline, the draft persists and goes up on the next Submit.
// There is NO background sync — sending unsent work is always a deliberate tap.
//
// Draft shape:
// {
//   serviceRecordId,                 // client UUID = the RPC idempotency key
//   kind: 'complete' | 'unable',
//   businessId, poolId, staffId, technicianName,
//   servicedAt,                      // ISO — the true time it was performed
//   recurringProfileId, occurrenceDate, isOneOff,
//   notes, readings, tasks, chemicals,   // complete only
//   reason, note, activity,              // unable only ({ type, title, description, linkTo })
//   photos: [{ clientPhotoId, blob, tag, meta:{ lat, lng, timestamp } }],
//   createdAt,
// }

// Fired whenever the draft set changes (created / submitted) so the Pending
// indicator can re-count live without polling.
export const PENDING_EVENT = 'pendingdrafts:changed'
function notifyPendingChanged() {
  try { window.dispatchEvent(new Event(PENDING_EVENT)) } catch { /* non-browser */ }
}

// Per-request network timeout. A pool's uplink can be "up but dead" (full signal
// bars, no throughput), and a bare fetch will then hang for the OS TCP timeout
// (a minute+) or effectively forever — which is exactly what froze the Submit
// button in the field. Cap every network op so a stalled attempt fails FAST and
// the auto-sender retries, instead of hanging the UI.
export const SEND_TIMEOUT_MS = 25_000

// Photo-upload concurrency for a completion's remaining photos, opened only when the
// probe proves the link is fast enough (see submitOne). Concurrent uploads split a
// fixed uplink, so this stays small.
const UPLOAD_CONCURRENCY = 3
// Probe faster than this ⇒ enough headroom that UPLOAD_CONCURRENCY uploads still fit
// inside SEND_TIMEOUT_MS (~3× the probe). Slower ⇒ stay sequential so we never split a
// marginal uplink into three simultaneous timeouts (which would regress a slow-but-
// alive link that succeeds one-at-a-time today). Well under SEND_TIMEOUT_MS, and there
// is no point raising SEND_TIMEOUT_MS to compensate — the global fetch wrapper hard-
// aborts every request at 30s (REQUEST_TIMEOUT_MS in ./supabase.js).
const PROBE_FAST_MS = 8_000

// Reject if `promise` hasn't settled within `ms`. The underlying request may keep
// running after we stop waiting — that's harmless here because every send is
// idempotent (deterministic upsert photo path + serviceRecordId RPC key), so a
// late-completing upload/RPC and its retry converge on the same single result.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { _timeout: true })),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function createDraft(draft) {
  // Quota gate — only for photo-bearing drafts. A photoless completion is never
  // blocked. Throws so the caller can tell the tech to submit before capturing more.
  if (draft.photos?.length) {
    const bytes = draft.photos.reduce((s, p) => s + (p.blob?.size || 0), 0)
    if (!(await quotaOk(bytes))) {
      throw new Error('Storage is full — submit your pending visits before capturing more photos.')
    }
  }
  draft.schemaVersion = SCHEMA_VERSION
  await putDraft(draft) // throws on IndexedDB failure — durability is the top property
  notifyPendingChanged()
  return draft.serviceRecordId
}

export async function listDrafts() {
  const drafts = await getAllDrafts()
  return drafts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function countDraftsAsync() {
  return (await getAllDrafts()).length
}

// Local YYYY-MM-DD of a date-like (or now). Mirrors the online path's ymdLocal.
function ymdLocalOf(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildPayload(draft, photoRows) {
  const base = {
    businessId: draft.businessId,
    poolId: draft.poolId,
    staffId: draft.staffId || null,
    technicianName: draft.technicianName || null,
    servicedAt: draft.servicedAt,
    recurringProfileId: draft.recurringProfileId || null,
    // A recurring completion with an identity but no occurrence date (e.g. a profile
    // with no computed next_generation_at) falls back to the SERVICE day
    // (draft.servicedAt) — matching the online path's ymdLocal(now) fallback
    // (useService.js) — so the RPC fulfils an occurrence instead of bumping
    // completed_visits against a null and leaving the schedule stuck (audit #12).
    occurrenceDate: draft.recurringProfileId
      ? (draft.occurrenceDate || ymdLocalOf(draft.servicedAt))
      : null,
    isOneOff: !!draft.isOneOff,
    poolCondition: draft.poolCondition || null,
    photos: photoRows,
  }
  if (draft.kind === 'unable') {
    return { ...base, reason: draft.reason || null, note: draft.note || null, activity: draft.activity || null }
  }
  return {
    ...base,
    notes: draft.notes || null,
    readings: draft.readings || {},
    tasks: draft.tasks || [],
    chemicals: draft.chemicals || [],
  }
}

// Upload ONE photo to its deterministic path. NEVER throws — normalises BOTH failure
// channels (a storage {error} and a withTimeout rejection) into a returned { error },
// so a pool worker can collect + classify without an early bail orphaning a rejecting
// promise. On success returns { row } (the payload row for the RPC).
async function uploadPhoto(draft, p) {
  const path = `${draft.businessId}/${draft.serviceRecordId}/${p.clientPhotoId}.jpg`
  try {
    const { error } = await withTimeout(
      supabase.storage
        .from('service-photos')
        .upload(path, p.blob, { upsert: true, contentType: 'image/jpeg' }),
      SEND_TIMEOUT_MS,
      'photo upload',
    )
    if (error) return { error }
    const { data: urlData } = supabase.storage.from('service-photos').getPublicUrl(path)
    return {
      row: {
        clientPhotoId: p.clientPhotoId,
        storagePath: path,
        signedUrl: urlData?.publicUrl || null,
        tag: p.tag || 'test-kit',
        lat: p.meta?.lat ?? null,
        lng: p.meta?.lng ?? null,
        capturedAt: p.meta?.timestamp ?? null,
      },
    }
  } catch (e) {
    // withTimeout rejection (or any throw) — transient, same shape as a storage error.
    return { error: e }
  }
}

// Bounded-concurrency upload of photos[startIndex..], filling photoRows[i] in place.
// Stops scheduling NEW uploads the instant any task errors (don't drain the pool on a
// dying link); in-flight uploads still settle (each capped by withTimeout). Returns the
// collected errors ([] = every photo uploaded). Workers never reject (uploadPhoto can't).
async function uploadPool(draft, photos, startIndex, concurrency, photoRows) {
  const errors = []
  let next = startIndex
  let stop = false
  async function worker() {
    // `next++` runs synchronously before the await, so no two workers claim the same i.
    while (!stop) {
      const i = next++
      if (i >= photos.length) return
      const res = await uploadPhoto(draft, photos[i])
      if (res.error) { errors.push(res.error); stop = true; return }
      photoRows[i] = res.row
    }
  }
  const n = Math.min(concurrency, photos.length - startIndex)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return errors
}

// Most-actionable status across ≥1 upload errors: auth > failed > pending. Mirrors the
// single-error precedence in classifyError so a thrown timeout can't mask a real 401.
function classifyWorst(errors) {
  let worst = 'pending'
  for (const e of errors) {
    const c = classifyError(e)
    if (c === 'auth') return 'auth'
    if (c === 'failed') worst = 'failed'
  }
  return worst
}

// ARCHITECTURAL INVARIANT: a draft's serviceRecordId is immutable for the life of
// the draft — it is the RPC idempotency key. Never regenerate/re-key it on retry,
// and never rebuild the payload; only retry metadata may change. Every no-duplicate
// guarantee below depends on the key staying constant across attempts.
//
// Submit one draft. NEVER throws — returns a status:
//   'sent'      RPC applied a fresh record
//   'conflict'  already recorded (replay / office-won) — treated as success
//   'pending'   TRANSIENT (offline / timeout / 5xx / unknown) — draft kept, keep retrying
//   'auth'      session expired / no permission — draft kept, tech must sign in
//   'failed'    PERMANENT (malformed payload) — draft kept, auto-retry STOPS
//   'wrong-org' draft belongs to another business — draft kept (server also rejects)
// The draft is deleted ONLY after BOTH all photo uploads AND the RPC return
// success/conflict. On a retry the photos overwrite their deterministic paths.
export async function submitOne(draft, currentBusinessId) {
  try {
    // A draft written by a newer app version (after a deploy/SW swap) can't be
    // safely submitted by older code — leave it for the updated client.
    if (draft.schemaVersion && draft.schemaVersion > SCHEMA_VERSION) return 'pending'
    if (currentBusinessId && draft.businessId && draft.businessId !== currentBusinessId) {
      return 'wrong-org'
    }

    // 1. Upload photos, then (only if ALL succeed) call the RPC — no partial-photo
    //    submit. Probe-then-parallel with a throughput gate: the first photo goes up
    //    ALONE (a dead link fails here at today's one-attempt cost); only if that probe
    //    was FAST do we upload the rest concurrently. Concurrent uploads split a fixed
    //    uplink, so on a slow-but-alive link a 3-wide wave would ~triple each photo's
    //    transfer time against the same 25s ceiling and regress to all-timeouts — so a
    //    slow probe stays sequential (today's behaviour). photoRows keeps position order.
    const photos = draft.photos || []
    const photoRows = new Array(photos.length)
    if (photos.length) {
      const t0 = Date.now()
      const probe = await uploadPhoto(draft, photos[0])
      if (probe.error) return classifyError(probe.error)
      photoRows[0] = probe.row
      if (photos.length > 1) {
        const concurrency = (Date.now() - t0) < PROBE_FAST_MS ? UPLOAD_CONCURRENCY : 1
        const errors = await uploadPool(draft, photos, 1, concurrency, photoRows)
        if (errors.length) return classifyWorst(errors)
      }
    }

    // 2. Call the atomic RPC. AbortController actually cancels the request on
    //    timeout; withTimeout guarantees we stop waiting even if the abort is
    //    ignored. Either way a stalled RPC becomes 'pending' (retried), not a hang.
    const fn = draft.kind === 'unable' ? 'mark_unable_to_service_tx' : 'complete_service_tx'
    const rpcAbort = new AbortController()
    const rpcTimer = setTimeout(() => rpcAbort.abort(), SEND_TIMEOUT_MS)
    let data, error
    try {
      ({ data, error } = await withTimeout(
        supabase.rpc(fn, {
          p_id: draft.serviceRecordId,
          p_payload: buildPayload(draft, photoRows),
        }).abortSignal(rpcAbort.signal),
        SEND_TIMEOUT_MS,
        'save',
      ))
    } finally {
      clearTimeout(rpcTimer)
    }
    if (error) return classifyError(error)

    // 3. Delete the draft — only now that both upload + RPC returned.
    await deleteDraft(draft.serviceRecordId)
    notifyPendingChanged()

    // 4. Best-effort next_due recompute (does NOT gate draft deletion — the
    //    completion is already committed; recompute re-derives the cache).
    try {
      await recomputePoolNextDue(draft.poolId, { now: new Date(draft.servicedAt) })
    } catch (e) {
      console.warn('recompute after submit failed (non-critical):', e?.message || e)
    }

    // 5. Report email — fire-and-forget. The edge function is idempotent on
    //    report_sent_at, so invoking on a conflict (replay) is a safe no-op and
    //    a never-emailed record still goes out.
    supabase.functions.invoke(draft.kind === 'unable' ? 'unable-service' : 'complete-service', {
      body: { service_record_id: draft.serviceRecordId },
    }).catch(() => {})

    return data?.conflict ? 'conflict' : 'sent'
  } catch (e) {
    console.warn('submitOne failed (draft kept):', e?.message || e)
    return 'pending'
  }
}

// A submit failure that WON'T resolve by simply retrying — the caller's session
// is expired/revoked or lacks permission (e.g. business changed under them). The
// draft is kept (no data loss), but the UI must tell the tech to sign in again
// rather than the misleading "will send when you reconnect".
function isFatalAuthError(err) {
  if (!err) return false
  const code = String(err.code || err.statusCode || err.status || '')
  const msg = String(err.message || '').toLowerCase()
  return code === '401' || code === '403' || code === '42501' || code === 'PGRST301'
    || msg.includes('jwt') || msg.includes('permission denied')
    || msg.includes('not authorized') || msg.includes('unauthorized')
    || msg.includes('authoris') // British spelling — the RPCs raise "Not authorised"
}

// Classify a submit failure. Order matters:
//   'auth'    session expired/revoked or lacks permission → keep, tell tech to sign in
//   'failed'  PERMANENT — the payload is malformed/invalid and will fail identically
//             on every retry → keep the draft but STOP auto-retrying
//   'pending' TRANSIENT (offline/timeout/abort/5xx/unknown) → keep, retry (the DEFAULT)
function classifyError(err) {
  if (!err) return 'pending'
  if (isFatalAuthError(err)) return 'auth'
  if (isPermanentError(err)) return 'failed'
  return 'pending'
}

// PERMANENT = deterministic bad-data failures retrying can't fix. Detected
// CONSERVATIVELY by Postgres SQLSTATE: data-exception 22xxx (bad numeric/date cast,
// out of range) or integrity-constraint 23xxx (not-null/check/FK) — EXCEPT unique
// 23505, which the RPC already collapses to `conflict` (success). Plus a storage
// "payload too large" (413). A transient network/timeout/abort error carries NO
// SQLSTATE, so it can never be mis-classified as permanent — anything unrecognised
// stays 'pending' (retry forever). This gates the RPC + storage errors only; the
// report-email edge function is fire-and-forget and never gates a draft.
function isPermanentError(err) {
  if (!err) return false
  const code = String(err.code || err.statusCode || err.status || '')
  const msg = String(err.message || '').toLowerCase()
  if (/^22[0-9a-z]{3}$/i.test(code)) return true
  if (/^23[0-9a-z]{3}$/i.test(code) && code !== '23505') return true
  if (code === '413' || /too large|exceeds the maximum|file size/i.test(msg)) return true
  return false
}

// Submit all pending drafts sequentially (never parallel), continue-on-failure.
// Returns a single summary for one toast — no per-draft noise, no retry counters.
export async function submitAll(currentBusinessId) {
  const drafts = await listDrafts()
  let sent = 0
  let pending = 0
  let wrongOrg = 0
  let auth = 0
  for (const d of drafts) {
    const status = await submitOne(d, currentBusinessId)
    if (status === 'sent' || status === 'conflict') sent++
    else if (status === 'wrong-org') wrongOrg++
    else if (status === 'auth') auth++
    else pending++
  }
  return { sent, pending, wrongOrg, auth, total: drafts.length }
}
