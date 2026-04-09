import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { quote_id } = await req.json()

    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*, clients!inner(name, email), businesses!inner(*)')
      .eq('id', quote_id)
      .single()

    if (error) throw error

    const client = quote.clients
    const business = quote.businesses
    const lineItems = quote.line_items || []
    const brandColour = business?.brand_colour || '#0EA5E9'
    const siteUrl = Deno.env.get('SITE_URL') || ''

    const itemsHtml = lineItems.map((item: any) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;">${item.description}</td>
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
          ${business?.logo_url ? `<img src="${business.logo_url}" alt="" style="height:48px;margin-bottom:8px;" />` : ''}
          <h1 style="margin:0;color:white;font-size:20px;">${business?.name || 'PoolPro'}</h1>
        </div>
        <div style="padding:24px;">
          <h2 style="margin:0 0 4px;font-size:18px;">Quote for ${client.name}</h2>
          <p style="margin:0 0 20px;color:#6B7280;font-size:14px;">
            Date: ${new Date(quote.created_at).toLocaleDateString('en-AU')}
            ${business?.abn ? ` &bull; ABN: ${business.abn}` : ''}
          </p>

          ${quote.scope ? `<div style="margin-bottom:20px;"><h3 style="font-size:14px;margin:0 0 4px;">Scope of Work</h3><p style="font-size:14px;color:#374151;margin:0;">${quote.scope}</p></div>` : ''}

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
            <p style="margin:4px 0;">GST (10%): $${Number(quote.gst).toFixed(2)}</p>
            <p style="margin:4px 0;font-size:18px;font-weight:bold;color:${brandColour};">Total: $${Number(quote.total).toFixed(2)}</p>
          </div>

          ${quote.terms ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;"><h3 style="font-size:14px;margin:0 0 4px;">Terms & Conditions</h3><p style="font-size:12px;color:#6B7280;margin:0;">${quote.terms}</p></div>` : ''}

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
