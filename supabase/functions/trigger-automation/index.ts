import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Internal-only: this endpoint does privileged (service-role) work driven by
    // a business_id in the body, so it must never be publicly callable. The sole
    // caller is complete-service, which forwards the service-role key as its
    // bearer — require that here. No app or anon caller exists.
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!bearer || bearer !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { trigger_event, business_id, job_id, service_record_id, client_id, pool_id, staff_name } = await req.json()

    if (!trigger_event || !business_id) {
      return new Response(JSON.stringify({ error: 'trigger_event and business_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch active automation rules for this trigger
    const { data: rules } = await supabase
      .from('automation_rules')
      .select('*, communication_templates:template_id(*)')
      .eq('business_id', business_id)
      .eq('trigger_event', trigger_event)
      .eq('is_active', true)

    if (!rules?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No matching automations' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch context data
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', business_id)
      .single()

    let client = null
    let pool = null

    if (client_id) {
      const { data } = await supabase.from('clients').select('*').eq('id', client_id).single()
      client = data
    }
    if (pool_id) {
      const { data } = await supabase.from('pools').select('*').eq('id', pool_id).single()
      pool = data
    }

    // If we have a job_id but no client/pool, fetch from job
    if (job_id && (!client || !pool)) {
      const { data: job } = await supabase.from('jobs').select('*, clients(*), pools(*)').eq('id', job_id).single()
      if (job) {
        if (!client) client = job.clients
        if (!pool) pool = job.pools
      }
    }

    // If we have a service_record_id but no client/pool, fetch from service record
    if (service_record_id && (!client || !pool)) {
      const { data: sr } = await supabase
        .from('service_records')
        .select('*, pools(*, clients(*))')
        .eq('id', service_record_id)
        .single()
      if (sr) {
        if (!pool) pool = sr.pools
        if (!client && sr.pools?.clients) client = sr.pools.clients
      }
    }

    // Build template variables
    const vars: Record<string, string> = {
      business_name: business?.name || '',
      business_phone: business?.phone || '',
      business_email: business?.email || '',
      client_name: client?.name || '',
      client_first_name: (client?.name || '').split(' ')[0],
      client_email: client?.email || '',
      client_phone: client?.phone || '',
      pool_address: pool?.address || '',
      pool_type: pool?.type || '',
      technician_name: staff_name || '',
    }

    if (pool?.portal_token) {
      vars.portal_link = `${Deno.env.get('SITE_URL') || 'https://pool-pro-2jk.pages.dev'}/portal/${pool.portal_token}`
    }
    if (pool?.next_due_at) {
      vars.next_service_date = new Date(pool.next_due_at).toLocaleDateString('en-AU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      })
    }

    // Render template
    function render(template: string) {
      return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] || match)
    }

    // HTML-escape a value before embedding it in the email markup. Templates are
    // plain text, so escaping whole rendered lines is safe and blocks HTML
    // injection via substituted client/business fields (e.g. a client name
    // containing markup).
    const esc = (s: any): string =>
      s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const results: any[] = []

    for (const rule of rules) {
      const template = rule.communication_templates
      if (!template) continue

      // Only process immediate (delay_minutes === 0) automations for now
      // Scheduled automations would need a cron-based processor
      if (rule.delay_minutes !== 0) continue

      const renderedBody = render(template.body)
      const renderedSubject = template.subject ? render(template.subject) : ''

      const shouldEmail = (rule.action_type === 'send_email' || rule.action_type === 'both') && template.type === 'email'
      const shouldSms = (rule.action_type === 'send_sms' || rule.action_type === 'both') && template.type === 'sms'

      if (shouldEmail && client?.email && resendKey) {
        try {
          // Wrap in simple branded HTML
          const brandColour = business?.brand_colour || '#0EA5E9'
          const emailHtml = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:${brandColour};padding:24px;text-align:center;">
      ${business?.logo_url ? `<img src="${esc(business.logo_url)}" alt="" style="height:40px;margin-bottom:8px;" />` : ''}
      <h1 style="margin:0;color:white;font-size:18px;">${esc(business?.name) || 'PoolPro'}</h1>
    </div>
    <div style="background:white;padding:28px 24px;">
      ${renderedBody.split('\n').map(line => `<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">${esc(line) || '&nbsp;'}</p>`).join('')}
    </div>
    <div style="padding:16px 24px;text-align:center;font-size:12px;color:#9CA3AF;">
      ${esc(business?.name) || 'PoolPro'}${business?.phone ? ' • ' + esc(business.phone) : ''}
    </div>
  </div>
</body>
</html>`

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `${business?.name || 'PoolPro'} <noreply@poolmateapp.online>`,
              to: [client.email],
              subject: renderedSubject || `Update from ${business?.name || 'PoolPro'}`,
              html: emailHtml,
            }),
          })

          const logStatus = res.ok ? 'sent' : 'failed'
          const logResult = await res.json()

          await supabase.from('automation_logs').insert({
            automation_rule_id: rule.id,
            business_id,
            job_id: job_id || null,
            service_record_id: service_record_id || null,
            recipient_email: client.email,
            channel: 'email',
            status: logStatus,
            template_name: template.name,
            rendered_body: renderedBody,
            error_message: logStatus === 'failed' ? JSON.stringify(logResult) : null,
          })

          results.push({ rule: rule.name, channel: 'email', status: logStatus })
        } catch (err) {
          await supabase.from('automation_logs').insert({
            automation_rule_id: rule.id,
            business_id,
            job_id: job_id || null,
            service_record_id: service_record_id || null,
            recipient_email: client.email,
            channel: 'email',
            status: 'failed',
            template_name: template.name,
            error_message: err.message,
          })
          results.push({ rule: rule.name, channel: 'email', status: 'failed', error: err.message })
        }
      }

      // SMS placeholder — log as pending until Twilio is configured
      if (shouldSms && client?.phone) {
        await supabase.from('automation_logs').insert({
          automation_rule_id: rule.id,
          business_id,
          job_id: job_id || null,
          service_record_id: service_record_id || null,
          recipient_phone: client.phone,
          channel: 'sms',
          status: 'pending',
          template_name: template.name,
          rendered_body: renderedBody,
          error_message: 'SMS sending not yet configured — Twilio integration pending',
        })
        results.push({ rule: rule.name, channel: 'sms', status: 'pending' })
      }
    }

    return new Response(JSON.stringify({ success: true, automations_processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
