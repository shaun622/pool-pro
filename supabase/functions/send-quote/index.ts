import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Caller is a member of the business if they own it or are an active staff row.
async function isBusinessMember(admin: any, userId: string, businessId: string) {
  const { data: biz } = await admin.from('businesses').select('owner_id').eq('id', businessId).maybeSingle()
  if (biz?.owner_id === userId) return true
  const { data: st } = await admin.from('staff_members')
    .select('id').eq('user_id', userId).eq('business_id', businessId).eq('is_active', true).maybeSingle()
  return !!st
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { quote_id } = await req.json()

    // Authorize: reject anon / customers / outsiders. Otherwise anyone with a
    // known quote_id could email it and flip it to "sent" (which unlocks the
    // public accept/decline → auto-job path).
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    )
    const { data: { user: caller } } = await callerClient.auth.getUser()
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*, clients!inner(name, email), businesses!inner(*)')
      .eq('id', quote_id)
      .single()

    if (error) throw error

    // The caller must own or be active staff of THIS quote's business.
    if (!(await isBusinessMember(supabase, caller.id, quote.business_id))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const client = quote.clients
    const business = quote.businesses
    const lineItems = quote.line_items || []
    const brandColour = business?.brand_colour || '#0EA5E9'
    const siteUrl = Deno.env.get('SITE_URL') || 'https://pool-pro-2jk.pages.dev'

    // HTML-escape user-controlled fields (client/business name, scope, terms, line
    // item descriptions) so a crafted value can't inject markup into the email.
    const esc = (s: any): string =>
      s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const safeUrl = (u: any): string => {
      const s = u == null ? '' : String(u)
      return /^https?:\/\//i.test(s) ? esc(s) : ''
    }

    const itemsHtml = lineItems.map((item: any) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;">${esc(item.description)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">$${Number(item.unit_price).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">$${(item.quantity * item.unit_price).toFixed(2)}</td>
      </tr>
    `).join('')

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F9FAFB;">
      <div style="max-width:600px;margin:0 auto;background:white;">
        <div style="background:${brandColour};padding:24px;text-align:center;">
          ${business?.logo_url ? `<img src="${safeUrl(business.logo_url)}" alt="" style="height:48px;margin-bottom:8px;" />` : ''}
          <h1 style="margin:0;color:white;font-size:20px;">${esc(business?.name) || 'PoolPro'}</h1>
        </div>
        <div style="padding:24px;">
          <h2 style="margin:0 0 4px;font-size:18px;">Quote for ${esc(client.name)}</h2>
          <p style="margin:0 0 20px;color:#6B7280;font-size:14px;">
            Date: ${new Date(quote.created_at).toLocaleDateString('en-AU')}
            ${business?.abn ? ` &bull; ABN: ${business.abn}` : ''}
          </p>

          ${quote.scope ? `<div style="margin-bottom:20px;"><h3 style="font-size:14px;margin:0 0 4px;">Scope of Work</h3><p style="font-size:14px;color:#374151;margin:0;">${esc(quote.scope)}</p></div>` : ''}

          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#F9FAFB;">
                <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #E5E7EB;">Item</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #E5E7EB;">Qty</th>
                <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #E5E7EB;">Unit Price</th>
                <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #E5E7EB;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          <div style="margin-top:16px;text-align:right;font-size:14px;">
            <p style="margin:4px 0;">Subtotal: $${Number(quote.subtotal).toFixed(2)}</p>
            ${Number(quote.gst) > 0 ? `<p style="margin:4px 0;">GST${Number(quote.subtotal) > 0 ? ` (${Math.round((Number(quote.gst) / Number(quote.subtotal)) * 100)}%)` : ''}: $${Number(quote.gst).toFixed(2)}</p>` : ''}
            <p style="margin:4px 0;font-size:18px;font-weight:bold;color:${brandColour};">Total: $${Number(quote.total).toFixed(2)}</p>
          </div>

          ${quote.terms ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;"><h3 style="font-size:14px;margin:0 0 4px;">Terms & Conditions</h3><p style="font-size:12px;color:#6B7280;margin:0;">${esc(quote.terms)}</p></div>` : ''}

          <div style="margin-top:24px;text-align:center;">
            <a href="${siteUrl}/quote/${quote.public_token}" style="display:inline-block;padding:12px 32px;background:${brandColour};color:white;text-decoration:none;border-radius:8px;font-weight:600;">View & Respond to Quote</a>
          </div>
        </div>
        <div style="padding:16px 24px;background:#F9FAFB;text-align:center;font-size:12px;color:#9CA3AF;">
          ${business?.phone ? business.phone + ' &bull; ' : ''}${business?.email || ''}
        </div>
      </div>
    </body>
    </html>`

    // Send via Resend
    let emailSent = false
    let emailError = null

    if (!client.email) {
      emailError = 'Client has no email address'
    } else {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (!resendKey) {
        emailError = 'RESEND_API_KEY is not configured'
        console.error('RESEND_API_KEY not set in Supabase secrets')
      } else {
        const fromAddress = `${business?.name || 'PoolPro'} <noreply@poolmateapp.online>`
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [client.email],
            subject: `Quote from ${business?.name || 'PoolPro'} — $${Number(quote.total).toFixed(2)}`,
            html,
          }),
        })

        if (res.ok) {
          emailSent = true
        } else {
          const errBody = await res.text()
          emailError = `Resend API error (${res.status}): ${errBody}`
          console.error('Resend API error:', res.status, errBody)
        }
      }
    }

    // Update sent_at
    await supabase
      .from('quotes')
      .update({ sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', quote_id)

    // Log activity
    await supabase.from('activity_feed').insert({
      business_id: business.id,
      type: 'quote_sent',
      title: `Quote sent to ${client.name}`,
      description: `$${Number(quote.total).toFixed(2)}${emailSent ? '' : ' (email failed)'}`,
      link_to: `/quotes/${quote_id}`,
    })

    return new Response(JSON.stringify({ success: true, email_sent: emailSent, email_error: emailError }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
