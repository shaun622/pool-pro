import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Server-side report-email BACKSTOP. Runs on a schedule (Supabase Cron, ~every
// 3 min). Finds completed / unable-to-service records whose report never sent
// and re-invokes the sender — guaranteeing the email eventually goes out
// regardless of the tech's device or network. The sender's atomic claim
// (claim_service_report) is authoritative; this sweep is only a pre-filter, so
// overlapping runs are harmless (the loser's invocation returns skipped).
//
// Auth: header x-cron-secret must equal env CRON_SECRET. Mirrors
// cleanup-service-photos. The platform's verify_jwt gate is satisfied by the
// caller passing a valid project key as Authorization (the Supabase Cron job
// sends the anon key; the header below is the real gate).

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type, apikey',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS })

// Bounds (mirror claim_service_report — this is only a pre-filter):
const ATTEMPT_CAP = 20        // stop after ~20 tries (≈1h at a 3-min cadence)
const GRACE_MIN = 3           // don't touch a record until 3 min after service (avoid racing the client fast path)
const STALE_HOURS = 24        // never first-send a record older than this (staleness guard)
const SPACING_MIN = 3         // don't re-invoke a record attempted in the last 3 min
const BATCH = 200

serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const service = createClient(url, serviceKey)

  const now = Date.now()
  const graceIso = new Date(now - GRACE_MIN * 60_000).toISOString()
  const staleIso = new Date(now - STALE_HOURS * 3_600_000).toISOString()
  const spacingMs = now - SPACING_MIN * 60_000

  // Candidate set — matches the partial index idx_service_records_unsent_reports.
  const { data: rows, error } = await service
    .from('service_records')
    .select('id, status, report_last_attempt_at')
    .is('report_sent_at', null)
    .eq('report_retryable', true)
    .in('status', ['completed', 'unable_to_service'])
    .gte('serviced_at', staleIso)
    .lte('serviced_at', graceIso)
    .lt('report_attempts', ATTEMPT_CAP)
    .order('serviced_at', { ascending: true })
    .limit(BATCH)

  if (error) return json({ error: error.message }, 500)

  // Spacing pre-filter in JS (the claim's 2-min lease is authoritative anyway).
  const candidates = (rows ?? []).filter(
    (r: any) => !r.report_last_attempt_at || new Date(r.report_last_attempt_at).getTime() < spacingMs,
  )

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const r of candidates) {
    const fn = r.status === 'unable_to_service' ? 'unable-service' : 'complete-service'
    try {
      const res = await fetch(`${url}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Bearer satisfies the platform verify_jwt gate; x-cron-secret is the
          // real auth the sender checks to take its trusted cron path.
          'Authorization': `Bearer ${serviceKey}`,
          'x-cron-secret': secret,
        },
        body: JSON.stringify({ service_record_id: r.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (body?.skipped) skipped++
      else if (res.ok && body?.success) sent++
      else failed++
    } catch (e) {
      console.error(`send-pending-reports: ${fn} for ${r.id} threw:`, (e as Error).message)
      failed++
    }
  }

  return json({ swept: candidates.length, sent, skipped, failed })
})
