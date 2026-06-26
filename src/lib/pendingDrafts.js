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

function buildPayload(draft, photoRows) {
  const base = {
    businessId: draft.businessId,
    poolId: draft.poolId,
    staffId: draft.staffId || null,
    technicianName: draft.technicianName || null,
    servicedAt: draft.servicedAt,
    recurringProfileId: draft.recurringProfileId || null,
    occurrenceDate: draft.occurrenceDate || null,
    isOneOff: !!draft.isOneOff,
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

// Submit one draft. NEVER throws — returns a status:
//   'sent'      RPC applied a fresh record
//   'conflict'  already recorded (replay / office-won) — treated as success
//   'pending'   couldn't send (offline / upload or RPC failed) — draft kept
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

    // 1. Upload every photo first. If ANY upload fails, do not call the RPC —
    //    leave the draft intact (no partial-photo submit).
    const photoRows = []
    for (const p of (draft.photos || [])) {
      const path = `${draft.businessId}/${draft.serviceRecordId}/${p.clientPhotoId}.jpg`
      const { error: upErr } = await supabase.storage
        .from('service-photos')
        .upload(path, p.blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) return 'pending'
      const { data: urlData } = supabase.storage.from('service-photos').getPublicUrl(path)
      photoRows.push({
        clientPhotoId: p.clientPhotoId,
        storagePath: path,
        signedUrl: urlData?.publicUrl || null,
        tag: p.tag || 'test-kit',
        lat: p.meta?.lat ?? null,
        lng: p.meta?.lng ?? null,
        capturedAt: p.meta?.timestamp ?? null,
      })
    }

    // 2. Call the atomic RPC.
    const fn = draft.kind === 'unable' ? 'mark_unable_to_service_tx' : 'complete_service_tx'
    const { data, error } = await supabase.rpc(fn, {
      p_id: draft.serviceRecordId,
      p_payload: buildPayload(draft, photoRows),
    })
    if (error) return 'pending'

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

// Submit all pending drafts sequentially (never parallel), continue-on-failure.
// Returns a single summary for one toast — no per-draft noise, no retry counters.
export async function submitAll(currentBusinessId) {
  const drafts = await listDrafts()
  let sent = 0
  let pending = 0
  let wrongOrg = 0
  for (const d of drafts) {
    const status = await submitOne(d, currentBusinessId)
    if (status === 'sent' || status === 'conflict') sent++
    else if (status === 'wrong-org') wrongOrg++
    else pending++
  }
  return { sent, pending, wrongOrg, total: drafts.length }
}
