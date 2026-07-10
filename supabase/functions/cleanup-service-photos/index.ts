import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Nightly retention cleanup: delete service PHOTOS (the actual storage files AND
// their DB rows) older than RETENTION_DAYS. Service records / readings / chemicals
// / tasks / notes are KEPT — they're tiny and the 365-day history is what keeps
// recurring scheduling correct. Only the heavy image files are purged to reclaim
// storage.
//
// - Protected by CLEANUP_SECRET so only the scheduler can invoke it.
// - Uses the service-role key: bypasses RLS AND calls the Storage API to remove
//   the file (deleting only the DB row would orphan the file and reclaim nothing).
// - Processes in batches, capped per run; a large backlog is cleared over a few
//   nights.

const RETENTION_DAYS = 60
const CHUNK = 100
const MAX_PER_RUN = 3000

serve(async (req) => {
  const secret = Deno.env.get('CLEANUP_SECRET')
  const provided = req.headers.get('x-cleanup-secret') || new URL(req.url).searchParams.get('secret')
  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
  let removedRows = 0
  let removedFiles = 0

  try {
    for (let i = 0; i < Math.ceil(MAX_PER_RUN / CHUNK); i++) {
      const { data: rows, error } = await supabase
        .from('service_photos')
        .select('id, storage_path')
        .lt('created_at', cutoff)
        .limit(CHUNK)
      if (error) throw error
      if (!rows || rows.length === 0) break

      const paths = rows.map((r: any) => r.storage_path).filter(Boolean)
      if (paths.length > 0) {
        const { error: rmErr } = await supabase.storage.from('service-photos').remove(paths)
        if (!rmErr) removedFiles += paths.length
      }
      const ids = rows.map((r: any) => r.id)
      const { error: delErr } = await supabase.from('service_photos').delete().in('id', ids)
      if (delErr) throw delErr
      removedRows += ids.length

      if (rows.length < CHUNK) break
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, removedRows, removedFiles }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, retentionDays: RETENTION_DAYS, cutoff, removedRows, removedFiles }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
