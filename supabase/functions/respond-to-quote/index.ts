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

    const { public_token, response } = await req.json()

    if (!['accepted', 'declined'].includes(response)) {
      throw new Error('Invalid response. Must be "accepted" or "declined".')
    }

    // Find quote by public token
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('*, clients!inner(name), businesses!inner(name, email, owner_id)')
      .eq('public_token', public_token)
      .single()

    if (error) throw error
    if (quote.status !== 'sent') {
      throw new Error('Quote has already been responded to.')
    }

    // Update quote status
    await supabase
      .from('quotes')
      .update({ status: response, responded_at: new Date().toISOString() })
      .eq('id', quote.id)

    // If accepted, create a job
    if (response === 'accepted') {
      await supabase.from('jobs').insert({
        business_id: quote.business_id,
        client_id: quote.client_id,
        pool_id: quote.pool_id,
        quote_id: quote.id,
        title: `Job from quote for ${quote.clients.name}`,
        status: 'scheduled',
      })

      // Notify business owner
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey && quote.businesses.email) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${quote.businesses.name || 'PoolPro'} <noreply@poolmateapp.online>`,
            to: [quote.businesses.email],
            subject: `Quote Accepted by ${quote.clients.name}`,
            html: `<p><strong>${quote.clients.name}</strong> has accepted your quote for <strong>$${Number(quote.total).toFixed(2)}</strong>.</p><p>A new job has been created automatically.</p>`,
          }),
        })
        if (!res.ok) {
          console.error('Resend error:', res.status, await res.text())
        }
      }
    }

    return new Response(JSON.stringify({ success: true, status: response }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
