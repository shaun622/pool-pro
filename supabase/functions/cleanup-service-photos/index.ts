import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Retention cleanup: delete service PHOTOS (the actual storage files AND their DB
// rows) older than RETENTION_DAYS. Service records / readings / chemicals / tasks
// / notes are KEPT (tiny + needed for the 365-day scheduling history) — only the
// heavy image files are purged to reclaim storage.
//
// Two invocation modes:
//   1. CRON — header `x-cleanup-secret` == CLEANUP_SECRET → GLOBAL cleanup (all
//      businesses). Use from a scheduler.
//   2. ADMIN — a logged-in owner/admin (JWT via supabase.functions.invoke) →
//      cleanup scoped to THAT admin's business only. Powers the Settings button.
// Uses the service-role key for the actual deletes so it can remove the storage
// FILE (not just the DB row, which would orphan the file and reclaim nothing).

const RETENTION_DAYS = 60
const CHUNK = 100
const MAX_PER_RUN = 3000

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cleanup-secret, content-type, apikey',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS })

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // ── Authorize + decide scope ──────────────────────────────────────────────
  const secret = Deno.env.get('CLEANUP_SECRET')
  const provided = req.headers.get('x-cleanup-secret') || new URL(req.url).searchParams.get('secret')
  let businessId: string | null = null // null = global (cron); set = one business (admin)

  if (secret && provided === secret) {
    // cron path — global, no scoping
  } else {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: isAdmin } = await userClient.rpc('current_user_is_admin')
    if (!isAdmin) return json({ error: 'Admins only' }, 403)
    // Derive the business from the VERIFIED user — never trust a client-supplied id.
    const { data: owned } = await service.from('businesses').select('id').eq('owner_id', user.id).maybeSingle()
    businessId = owned?.id ?? null
    if (!businessId) {
      const { data: staff } = await service.from('staff_members').select('business_id')
        .eq('user_id', user.id).eq('is_active', true).maybeSingle()
      businessId = staff?.business_id ?? null
    }
    if (!businessId) return json({ error: 'No business for this user' }, 403)
  }

  // ── Purge in capped batches ───────────────────────────────────────────────
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
  let removedRows = 0
  let removedFiles = 0
  try {
    for (let i = 0; i < Math.ceil(MAX_PER_RUN / CHUNK); i++) {
      let q = service.from('service_photos')
        .select(businessId ? 'id, storage_path, service_records!inner(business_id)' : 'id, storage_path')
        .lt('created_at', cutoff)
        .limit(CHUNK)
      if (businessId) q = q.eq('service_records.business_id', businessId)
      const { data: rows, error } = await q
      if (error) throw error
      if (!rows || rows.length === 0) break

      const paths = rows.map((r: any) => r.storage_path).filter(Boolean)
      if (paths.length > 0) {
        const { error: rmErr } = await service.storage.from('service-photos').remove(paths)
        if (!rmErr) removedFiles += paths.length
      }
      const ids = rows.map((r: any) => r.id)
      const { error: delErr } = await service.from('service_photos').delete().in('id', ids)
      if (delErr) throw delErr
      removedRows += ids.length

      if (rows.length < CHUNK) break
    }
  } catch (e) {
    return json({ error: (e as Error).message, removedRows, removedFiles }, 500)
  }

  return json({ ok: true, scope: businessId ? 'business' : 'global', retentionDays: RETENTION_DAYS, removedRows, removedFiles })
})
