import { putSnapshot, getSnapshot } from './offlineDb'

// Read-side facade over the snapshot store. Two cached blobs:
//   - 'context' : the resolved business / staff / role, so the PWA can boot
//                 offline (useBusiness falls back to this when the network read
//                 fails — otherwise TechGuard bounces the tech to /login).
//   - 'route'   : exactly what TechRunSheet.fetchData returns, so the run sheet
//                 renders today's route (and Week/Upcoming) from cache offline.
//
// Both are stamped with the owning id (userId / businessId+staffId) and only
// returned on a match, so a different login never reads the previous user's data.

const CONTEXT_ID = 'context'
const ROUTE_ID = 'route'
// Never serve a cached route older than this — better an empty "pull to refresh"
// state than a stale route after the dispatcher reassigned jobs.
const ROUTE_TTL_MS = 72 * 60 * 60 * 1000 // 72h

export async function cacheContext(userId, ctx) {
  if (!userId) return
  await putSnapshot(CONTEXT_ID, { userId, ...ctx, cachedAt: Date.now() })
}

export async function readCachedContext(userId) {
  const snap = await getSnapshot(CONTEXT_ID)
  if (!snap || !snap.business) return null
  // Only ever serve the snapshot back to the exact user it was cached for. If we
  // don't know who's asking (userId null) or the snapshot isn't stamped, refuse —
  // a stale snapshot must never leak across a logout/login. (The old `a && b &&`
  // guard failed open when either side was null.)
  if (!userId || snap.userId !== userId) return null
  return snap
}

export async function cacheRoute({ businessId, staffId, jobs, pools, profiles, serviceRecords }) {
  if (!businessId) return
  await putSnapshot(ROUTE_ID, {
    businessId,
    staffId: staffId || null,
    jobs: jobs || [],
    pools: pools || [],
    profiles: profiles || [],
    serviceRecords: serviceRecords || [],
    cachedAt: Date.now(),
  })
}

export async function readCachedRoute(businessId, staffId) {
  const snap = await getSnapshot(ROUTE_ID)
  if (!snap) return null
  // Exact match on BOTH sides (staffId may legitimately be null for an owner/admin
  // viewing the run sheet), so a tech-specific route never surfaces for a different
  // staff id or for the owner, and vice versa. The old `a && b &&` guard failed
  // open when either id was null.
  if (!businessId || snap.businessId !== businessId) return null
  if ((snap.staffId || null) !== (staffId || null)) return null
  if (snap.cachedAt && Date.now() - snap.cachedAt > ROUTE_TTL_MS) return null
  return snap
}

// Optimistic offline completion: fold a synthetic completed/unable record into
// the cached route so a reload-while-offline keeps the just-done stop hidden
// (the projector dedupes/renders off serviceRecords). Replaced by the real row
// once the draft submits and the route is refetched online.
export async function appendCachedServiceRecord(record) {
  const snap = await getSnapshot(ROUTE_ID)
  if (!snap) return
  const serviceRecords = (snap.serviceRecords || []).filter((r) => r.id !== record.id)
  serviceRecords.push(record)
  await putSnapshot(ROUTE_ID, { ...snap, serviceRecords })
}
