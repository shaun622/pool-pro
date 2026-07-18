import { openDB } from 'idb'

// Low-level IndexedDB wrapper for offline mode. Three stores:
//   - snapshot : cached read data — the boot context (business/staff) and
//                today's route — keyed by a fixed id ('context' | 'route').
//   - drafts   : durable unsent completions/unable reports, keyed by the
//                client-generated serviceRecordId (= the RPC idempotency key).
//   - kv       : small scalars (schema version, etc.).
//
// Everything is wrapped in `safe()` so a browser with IndexedDB disabled
// (private mode, locked-down WebView) degrades to "no offline" rather than
// throwing into the app. Draft durability is the #1 property, so callers that
// store drafts should surface a failure (see putDraft) rather than silently drop.

const DB_NAME = 'poolpro-offline'
const DB_VERSION = 1
export const SCHEMA_VERSION = 1

let _dbPromise = null
function db() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('snapshot')) d.createObjectStore('snapshot', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts', { keyPath: 'serviceRecordId' })
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' })
      },
    })
  }
  return _dbPromise
}

async function safe(fn, fallback) {
  try {
    return await fn()
  } catch (e) {
    console.warn('offlineDb error:', e?.message || e)
    return fallback
  }
}

// ── Snapshot (cached reads) ──────────────────────────────────────────────
export async function putSnapshot(id, data) {
  return safe(async () => { await (await db()).put('snapshot', { id, ...data }) }, undefined)
}
export async function getSnapshot(id) {
  return safe(async () => (await db()).get('snapshot', id), null)
}

// ── Drafts (durable unsent work) ─────────────────────────────────────────
// Throws on failure on purpose: the caller must know if a draft didn't persist
// (draft durability is the top property — a silent drop is the one outcome we
// can't have).
export async function putDraft(draft) {
  return (await db()).put('drafts', draft)
}
// Update an existing draft in place (used to stamp retry bookkeeping —
// attemptCount / nextAttemptAt / lastError). SAFE (never throws): a failed
// metadata write just means the auto-sender retries on its normal cadence
// instead of the backed-off one. Durability of the ORIGINAL draft is unaffected.
export async function updateDraft(draft) {
  return safe(async () => { await (await db()).put('drafts', draft) }, undefined)
}
export async function getAllDrafts() {
  return safe(async () => (await db()).getAll('drafts'), [])
}
export async function deleteDraft(serviceRecordId) {
  return safe(async () => { await (await db()).delete('drafts', serviceRecordId) }, undefined)
}
export async function countDrafts() {
  return safe(async () => (await db()).count('drafts'), 0)
}

// ── Persistence + quota ──────────────────────────────────────────────────
// Ask the browser not to evict our storage under pressure. Best-effort.
export async function requestPersist() {
  return safe(async () => {
    if (!navigator.storage?.persist) return false
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true
    return navigator.storage.persist()
  }, false)
}

// True if storing `extraBytes` more would stay under 80% of quota. Used to gate
// photo-bearing drafts only — a photoless completion is never blocked.
export async function quotaOk(extraBytes = 0) {
  return safe(async () => {
    if (!navigator.storage?.estimate) return true
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    if (!quota) return true
    return (usage + extraBytes) / quota < 0.8
  }, true)
}
