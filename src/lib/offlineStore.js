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

export async function cacheContext(userId, ctx) {
  if (!userId) return
  await putSnapshot(CONTEXT_ID, { userId, ...ctx, cachedAt: Date.now() })
}

export async function readCachedContext(userId) {
  const snap = await getSnapshot(CONTEXT_ID)
  if (!snap || !snap.business) return null
  if (userId && snap.userId && snap.userId !== userId) return null
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
  if (businessId && snap.businessId && snap.businessId !== businessId) return null
  if (staffId && snap.staffId && snap.staffId !== staffId) return null
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
