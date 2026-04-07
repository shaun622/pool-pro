import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const statusMessages: Record<string, string> = {
  scheduled: "We've scheduled your job",
  in_progress: "Work has started on your job",
  on_hold: 'Your job is currently on hold',
  completed: 'Your job has been completed',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { job_id, status } = await req.json()

    const validStatuses = ['scheduled', 'in_progress', 'on_hold', 'completed']
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid status')
    }

    const { data: job, error } = await supabase
      .from('jobs')
      .select('*, clients!inner(name, email), businesses!inner(name, brand_colour, logo_url, phone, email)')
      .eq('id', job_id)
      .single()

    if (error) throw error

    await supabase
      .from('jobs')
      .update({ status })
      .eq('id', job_id)

    // Send status update email to client
    const client = job.clients
    const business = job.businesses
    const brandColour = business?.brand_colour || '#0EA5E9'

    if (client.email) {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey) {
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
              <h2 style="margin:0 0 8px;font-size:18px;">Job Update</h2>
              <p style="font-size:16px;color:#374151;">${statusMessages[status] || 'Your job status has been updated'}.</p>
              <p style="font-size:14px;color:#6B7280;">Job: ${job.title}</p>
              ${job.scheduled_date ? `<p style="font-size:14px;color:#6B7280;">Scheduled: ${new Date(job.scheduled_date).toLocaleDateString('en-AU')}</p>` : ''}
            </div>
            <div style="padding:16px 24px;background:#F9FAFB;text-align:center;font-size:12px;color:#9CA3AF;">
              ${business?.phone ? business.phone + ' &bull; ' : ''}${business?.email || ''}
            </div>
          </div>
        </body>
        </html>`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${business?.name || 'PoolPro'} <onboarding@resend.dev>`,
            to: [client.email],
            subject: `Job Update — ${job.title}`,
            html,
          }),
        })
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
