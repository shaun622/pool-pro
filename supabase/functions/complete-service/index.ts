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

    const { service_record_id } = await req.json()

    // Fetch full service record with related data
    const { data: record, error: recordError } = await supabase
      .from('service_records')
      .select(`
        *,
        pools!inner(*, clients!inner(name, email)),
        chemical_logs(*),
        service_tasks(*),
        chemicals_added(*),
        service_photos(*)
      `)
      .eq('id', service_record_id)
      .single()

    if (recordError) throw recordError

    // Fetch business branding
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', record.business_id)
      .single()

    const pool = record.pools
    const client = pool.clients
    const chemicals = record.chemical_logs?.[0] || {}
    const tasks = record.service_tasks || []
    const chemicalsAdded = record.chemicals_added || []
    const targetRanges = pool.target_ranges || {}

    // Build status indicator
    function chemStatus(value: number | null, range: number[] | undefined): string {
      if (value == null || !range) return '#9CA3AF'
      const [min, max] = range
      if (value < min * 0.9 || value > max * 1.1) return '#EF4444'
      if (value < min || value > max) return '#F59E0B'
      return '#22C55E'
    }

    // Build chemical readings HTML rows
    const chemicalRows = [
      { label: 'pH', value: chemicals.ph, range: targetRanges.ph },
      { label: 'Free Chlorine', value: chemicals.free_chlorine, range: targetRanges.free_cl, unit: 'ppm' },
      { label: 'Total Chlorine', value: chemicals.total_chlorine, range: targetRanges.total_cl, unit: 'ppm' },
      { label: 'Alkalinity', value: chemicals.alkalinity, range: targetRanges.alk, unit: 'ppm' },
      { label: 'Stabiliser', value: chemicals.stabiliser, range: targetRanges.stabiliser, unit: 'ppm' },
      { label: 'Calcium Hardness', value: chemicals.calcium_hardness, range: targetRanges.calcium, unit: 'ppm' },
      { label: 'Salt', value: chemicals.salt, unit: 'ppm' },
    ]
      .filter(r => r.value != null)
      .map(r => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;">${r.label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${chemStatus(r.value, r.range)};margin-right:6px;"></span>
            ${r.value}${r.unit ? ' ' + r.unit : ''}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#9CA3AF;">
            ${r.range ? `${r.range[0]}–${r.range[1]}` : '—'}
          </td>
        </tr>
      `).join('')

    const tasksHtml = tasks.map((t: any) => `
      <li style="padding:4px 0;color:${t.completed ? '#111827' : '#9CA3AF'};">
        ${t.completed ? '&#10003;' : '&#10007;'} ${t.task_name}
      </li>
    `).join('')

    const chemicalsAddedHtml = chemicalsAdded.length > 0
      ? `<h3 style="margin:20px 0 8px;font-size:16px;">Chemicals Added</h3>
         <ul style="list-style:none;padding:0;">
           ${chemicalsAdded.map((c: any) => `<li style="padding:4px 0;">${c.product_name} — ${c.quantity} ${c.unit}</li>`).join('')}
         </ul>`
      : ''

    const serviceDate = new Date(record.serviced_at).toLocaleDateString('en-AU')
    const brandColour = business?.brand_colour || '#0EA5E9'

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
          <h2 style="margin:0 0 4px;font-size:18px;">Service Report</h2>
          <p style="margin:0 0 16px;color:#6B7280;">
            ${pool.address} &bull; ${serviceDate} &bull; ${record.technician_name || 'Technician'}
          </p>

          <h3 style="margin:20px 0 8px;font-size:16px;">Chemical Readings</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="background:#F9FAFB;">
                <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #E5E7EB;">Reading</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #E5E7EB;">Value</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #E5E7EB;">Target</th>
              </tr>
            </thead>
            <tbody>${chemicalRows}</tbody>
          </table>

          <h3 style="margin:20px 0 8px;font-size:16px;">Tasks</h3>
          <ul style="list-style:none;padding:0;font-size:14px;">
            ${tasksHtml}
          </ul>

          ${chemicalsAddedHtml}

          ${record.notes ? `<h3 style="margin:20px 0 8px;font-size:16px;">Notes</h3><p style="font-size:14px;color:#374151;">${record.notes}</p>` : ''}

          ${pool.portal_token ? `<p style="margin:24px 0 0;text-align:center;"><a href="${Deno.env.get('SITE_URL') || ''}/portal/${pool.portal_token}" style="color:${brandColour};font-size:14px;">View full service history</a></p>` : ''}
        </div>
        <div style="padding:16px 24px;background:#F9FAFB;text-align:center;font-size:12px;color:#9CA3AF;">
          ${business?.phone ? business.phone + ' &bull; ' : ''}${business?.email || ''}
        </div>
      </div>
    </body>
    </html>`

    // Send email via Resend
    if (client.email) {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${business?.name || 'PoolPro'} <onboarding@resend.dev>`,
            to: [client.email],
            subject: `Service Report — ${pool.address} — ${serviceDate}`,
            html,
          }),
        })
      }
    }

    // Update report_sent_at
    await supabase
      .from('service_records')
      .update({ report_sent_at: new Date().toISOString() })
      .eq('id', service_record_id)

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
