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

    // Fetch staff member if assigned
    let staffMember = null
    if (record.staff_id) {
      const { data: staffData } = await supabase
        .from('staff_members')
        .select('*')
        .eq('id', record.staff_id)
        .single()
      staffMember = staffData
    }

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
      <li style="padding:4px 0;color:${t.completed ? '#374151' : '#9CA3AF'};">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${t.completed ? '#22C55E' : '#E5E7EB'};color:white;text-align:center;line-height:18px;font-size:11px;margin-right:8px;vertical-align:middle;">${t.completed ? '&#10003;' : ''}</span>
        ${t.task_name}
      </li>
    `).join('')

    const chemicalsAddedHtml = chemicalsAdded.length > 0
      ? `<h3 style="margin:20px 0 8px;font-size:16px;">Chemicals Added</h3>
         <ul style="list-style:none;padding:0;">
           ${chemicalsAdded.map((c: any) => `<li style="padding:4px 0;">${c.product_name} — ${c.quantity} ${c.unit}</li>`).join('')}
         </ul>`
      : ''

    const serviceDate = new Date(record.serviced_at).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const serviceDateShort = new Date(record.serviced_at).toLocaleDateString('en-AU')
    const brandColour = business?.brand_colour || '#0EA5E9'

    // Calculate next service date
    const nextDueAt = pool.next_due_at ? new Date(pool.next_due_at) : null
    const nextServiceDate = nextDueAt ? nextDueAt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null
    const frequencyLabel: Record<string, string> = {
      weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', '6_weekly': 'Every 6 Weeks',
    }
    const scheduleLabel = frequencyLabel[pool.schedule_frequency] || pool.schedule_frequency || ''

    const completedTaskCount = tasks.filter((t: any) => t.completed).length

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
      <div style="max-width:600px;margin:0 auto;">
        <!-- Header -->
        <div style="background:${brandColour};padding:32px 24px;text-align:center;border-radius:0 0 0 0;">
          ${business?.logo_url ? `<img src="${business.logo_url}" alt="" style="height:48px;margin-bottom:12px;" />` : ''}
          <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">${business?.name || 'PoolPro'}</h1>
        </div>

        <!-- Greeting -->
        <div style="background:white;padding:28px 24px 20px;">
          <p style="margin:0 0 4px;font-size:16px;color:#111827;">Hi ${client.name},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#6B7280;line-height:1.5;">
            Your pool at <strong>${pool.address}</strong> has been serviced. Here's a summary of everything we did today.
          </p>

          <!-- Staff Card -->
          ${staffMember ? `
          <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
            <table style="width:100%;">
              <tr>
                <td style="width:56px;vertical-align:top;">
                  ${staffMember.photo_url
                    ? `<img src="${staffMember.photo_url}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`
                    : `<div style="width:48px;height:48px;border-radius:50%;background:${brandColour}20;color:${brandColour};font-size:18px;font-weight:700;text-align:center;line-height:48px;">${(staffMember.name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}</div>`
                  }
                </td>
                <td style="vertical-align:top;padding-left:12px;">
                  <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">${staffMember.name}</p>
                  <p style="margin:2px 0 0;font-size:13px;color:#6B7280;">${{technician:'Pool Technician',senior_tech:'Senior Technician',manager:'Manager',owner:'Owner'}[staffMember.role] || staffMember.role}</p>
                  ${staffMember.phone ? `<p style="margin:2px 0 0;font-size:13px;color:${brandColour};">${staffMember.phone}</p>` : ''}
                </td>
              </tr>
            </table>
          </div>
          ` : ''}

          <!-- Service info bar -->
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;display:flex;">
            <table style="width:100%;font-size:13px;color:#6B7280;">
              <tr>
                <td style="padding:2px 0;"><strong style="color:#374151;">Date:</strong> ${serviceDate}</td>
              </tr>
              <tr>
                <td style="padding:2px 0;"><strong style="color:#374151;">Technician:</strong> ${staffMember?.name || record.technician_name || 'Technician'}</td>
              </tr>
              ${pool.type ? `<tr><td style="padding:2px 0;"><strong style="color:#374151;">Pool type:</strong> ${pool.type}</td></tr>` : ''}
            </table>
          </div>
        </div>

        <!-- Chemical Readings -->
        ${chemicalRows ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Chemical Readings</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E5E7EB;border-radius:8px;">
            <thead>
              <tr style="background:#F9FAFB;">
                <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Reading</th>
                <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Result</th>
                <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Target Range</th>
              </tr>
            </thead>
            <tbody>${chemicalRows}</tbody>
          </table>
        </div>
        ` : ''}

        <!-- Tasks -->
        ${tasks.length > 0 ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Tasks Completed <span style="font-weight:400;color:#9CA3AF;font-size:13px;">(${completedTaskCount}/${tasks.length})</span></h3>
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;">
            <ul style="list-style:none;padding:0;margin:0;font-size:13px;">
              ${tasksHtml}
            </ul>
          </div>
        </div>
        ` : ''}

        <!-- Chemicals Added -->
        ${chemicalsAdded.length > 0 ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Chemicals Added</h3>
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;">
            <ul style="list-style:none;padding:0;margin:0;font-size:13px;">
              ${chemicalsAdded.map((c: any) => `<li style="padding:4px 0;color:#374151;">&bull; ${c.product_name} — ${c.quantity} ${c.unit}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <!-- Notes -->
        ${record.notes ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#111827;">Notes & Recommendations</h3>
          <p style="font-size:14px;color:#374151;line-height:1.5;margin:0;background:#F9FAFB;border-radius:8px;padding:12px 16px;">${record.notes}</p>
        </div>
        ` : ''}

        <!-- Next Service -->
        ${nextServiceDate ? `
        <div style="background:white;padding:0 24px 24px;">
          <div style="background:${brandColour}10;border:1px solid ${brandColour}30;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Next Service${scheduleLabel ? ` (${scheduleLabel})` : ''}</p>
            <p style="margin:0;font-size:17px;font-weight:700;color:${brandColour};">${nextServiceDate}</p>
          </div>
        </div>
        ` : ''}

        <!-- Portal link -->
        ${pool.portal_token ? `
        <div style="background:white;padding:0 24px 24px;text-align:center;">
          <a href="${Deno.env.get('SITE_URL') || ''}/portal/${pool.portal_token}" style="display:inline-block;background:${brandColour};color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">View Service History</a>
        </div>
        ` : ''}

        <!-- Footer -->
        <div style="padding:20px 24px;text-align:center;font-size:12px;color:#9CA3AF;">
          <p style="margin:0 0 4px;">${business?.name || 'PoolPro'}</p>
          <p style="margin:0;">${business?.phone ? business.phone + ' &bull; ' : ''}${business?.email || ''}</p>
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
            subject: `Pool Service Complete — ${pool.address} — ${serviceDateShort}`,
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
