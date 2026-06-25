import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sent when a technician marks a pool "unable to service" (locked gate, no
// access, dog in yard, etc.). UNLIKE complete-service this emails ONLY the
// business owner — there is no customer report. The point is to hand the
// office the reason, photos and the customer's full contact details so they
// can decide whether to call / message / email the customer.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { service_record_id } = await req.json()

    const { data: record, error: recordError } = await supabase
      .from('service_records')
      .select(`
        *,
        pools!inner(*, clients(name, email, phone, address)),
        service_photos(*)
      `)
      .eq('id', service_record_id)
      .single()

    if (recordError) throw recordError
    if (record.status !== 'unable_to_service') {
      return new Response(JSON.stringify({ skipped: true, reason: 'not an unable_to_service record' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', record.business_id)
      .single()

    let staffMember: any = null
    if (record.staff_id) {
      const { data } = await supabase
        .from('staff_members')
        .select('name, phone')
        .eq('id', record.staff_id)
        .single()
      staffMember = data
    }

    const pool = record.pools
    const client = pool.clients || { name: '', email: null, phone: null, address: null }
    const techName = staffMember?.name || record.technician_name || 'Technician'

    // Escape user-controlled text before embedding it in the email HTML
    // (technician note/reason, customer name/contact, pool address, etc.).
    const esc = (s: any): string => {
      if (s == null) return ''
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const allPhotos = record.service_photos || []
    const unablePhotos = allPhotos.filter((p: any) => p.tag === 'unable_access')
    const photoList = unablePhotos.length ? unablePhotos : allPhotos
    const photoUrls = photoList.map((p: any) =>
      p.signed_url || `${supabaseUrl}/storage/v1/object/public/service-photos/${p.storage_path}`
    )

    const serviceDate = new Date(record.serviced_at).toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
    const serviceDateShort = new Date(record.serviced_at).toLocaleDateString('en-AU')
    // Orange theme to signal the access issue, independent of brand colour.
    const ORANGE = '#EA580C'

    const contactRow = (label: string, value: string | null, href: string | null) => {
      if (!value) return ''
      const inner = href
        ? `<a href="${esc(href)}" style="color:${ORANGE};text-decoration:none;font-weight:600;">${esc(value)}</a>`
        : `<span style="color:#111827;font-weight:600;">${esc(value)}</span>`
      return `<tr>
        <td style="padding:6px 0;color:#6B7280;font-size:13px;width:90px;vertical-align:top;">${label}</td>
        <td style="padding:6px 0;text-align:right;font-size:13px;">${inner}</td>
      </tr>`
    }

    const photosHtml = photoUrls.length
      ? `<div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Photos</h3>
          ${photoUrls.map((u: string) =>
            `<img src="${u}" alt="Access issue" width="520" style="width:100%;max-width:520px;height:auto;display:block;border-radius:8px;border:1px solid #E5E7EB;margin-bottom:8px;" />`
          ).join('')}
        </div>`
      : ''

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
      <div style="max-width:600px;margin:0 auto;">
        <!-- Header -->
        <div style="background:${ORANGE};padding:28px 24px;text-align:center;">
          <h1 style="margin:0;color:white;font-size:20px;font-weight:700;">Unable to Service</h1>
          <p style="margin:6px 0 0;color:#FFE4D5;font-size:13px;">${esc(business?.name) || 'PoolPro'}</p>
        </div>

        <!-- Summary -->
        <div style="background:white;padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            <strong>${esc(techName)}</strong> could not service the pool at <strong>${esc(pool.address)}</strong> for ${esc(client.name)}.
          </p>

          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
            <p style="margin:0;font-size:12px;color:#9A3412;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Reason</p>
            <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#9A3412;">${esc(record.unable_reason) || 'Not specified'}</p>
            ${record.notes ? `<p style="margin:8px 0 0;font-size:14px;color:#7C2D12;line-height:1.5;">${esc(record.notes)}</p>` : ''}
          </div>

          <table style="width:100%;font-size:13px;color:#6B7280;background:#F9FAFB;border-radius:8px;">
            <tr><td style="padding:10px 14px;"><strong style="color:#374151;">Date:</strong> ${serviceDate}</td></tr>
            <tr><td style="padding:0 14px 10px;"><strong style="color:#374151;">Technician:</strong> ${techName}</td></tr>
          </table>
        </div>

        ${photosHtml}

        <!-- Customer contact for follow-up -->
        <div style="background:white;padding:0 24px 24px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Customer — follow up</h3>
          <div style="background:#F9FAFB;border-radius:8px;padding:8px 16px;">
            <table style="width:100%;">
              ${contactRow('Name', client.name, null)}
              ${contactRow('Phone', client.phone, client.phone ? `tel:${client.phone}` : null)}
              ${contactRow('Email', client.email, client.email ? `mailto:${client.email}` : null)}
              ${contactRow('Address', pool.address || client.address, null)}
            </table>
          </div>
          <p style="margin:12px 0 0;font-size:12px;color:#9CA3AF;line-height:1.5;">
            The next service has been rescheduled to the pool's normal cycle. Contact the customer if a sooner visit is needed.
          </p>
        </div>

        <!-- Footer -->
        <div style="padding:20px 24px;text-align:center;font-size:12px;color:#9CA3AF;">
          <p style="margin:0;">${esc(business?.name) || 'PoolPro'} — Service notification</p>
        </div>
      </div>
    </body>
    </html>`

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY not found in environment')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailResults: any[] = []
    if (business?.email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${business?.name || 'PoolPro'} <noreply@poolmateapp.online>`,
          to: [business.email],
          subject: `⚠ Unable to service — ${pool.address} — ${serviceDateShort}`,
          html,
        }),
      })
      const result = await res.json()
      if (!res.ok) console.error('Resend error:', JSON.stringify(result))
      emailResults.push({ to: business.email, status: res.status })
    } else {
      console.warn('No business email — admin notification not sent')
    }

    // Mark the notification as sent (reuses report_sent_at — same column the
    // completion report uses to record "the owner has been told").
    await supabase
      .from('service_records')
      .update({ report_sent_at: new Date().toISOString() })
      .eq('id', service_record_id)

    return new Response(JSON.stringify({ success: true, emails: emailResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as any).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
