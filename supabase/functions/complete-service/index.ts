import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ⚠️  The two report-email templates below (customer `html`, admin `ownerHtml`)
// are mirrored in src/lib/serviceReportEmail.js, which renders the LIVE PREVIEW
// in Settings → Notifications. If you change the markup, wording defaults, or the
// section show/hide flags here, mirror it there (and vice-versa).

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

  // Hoisted so the outer catch can surface WHY a claimed report crashed — a throw
  // between the claim and the stamp otherwise leaves report_sent_at AND
  // report_last_error both null, and the sweep silently retries with no signal.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  let sid: string | null = null

  try {
    const { service_record_id } = await req.json()
    sid = service_record_id

    // Two invocation paths:
    //   • CRON — header x-cron-secret == CRON_SECRET → the trusted server backstop
    //     (send-pending-reports). No user JWT; the request is already scoped to a
    //     single service_record_id. Mirrors cleanup-service-photos.
    //   • CLIENT — the app invokes with the tech's access token. Reject anon,
    //     customers, and outsiders before any privileged (service-role) work —
    //     otherwise anyone with a known service_record_id could fire a report.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const isCron = !!(cronSecret && req.headers.get('x-cron-secret') === cronSecret)

    let caller: any = null
    if (!isCron) {
      const callerClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
      )
      const { data: { user } } = await callerClient.auth.getUser()
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      caller = user
    }

    // Fetch full service record with related data
    const { data: record, error: recordError } = await supabase
      .from('service_records')
      .select(`
        *,
        pools!inner(*, clients!inner(name, email, branch_id, branches(email, notify_enabled))),
        chemical_logs(*),
        service_tasks(*),
        chemicals_added(*),
        service_photos(*)
      `)
      .eq('id', service_record_id)
      .single()

    if (recordError) throw recordError

    // The caller must own or be active staff of THIS record's business.
    // (Skipped on the trusted cron path, which has no user.)
    if (!isCron && !(await isBusinessMember(supabase, caller.id, record.business_id))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Atomic claim (lease). The single row-locked UPDATE in claim_service_report
    // guarantees at most one concurrent invocation proceeds to send — the client
    // fast path and the cron backstop both funnel through here. Returns the new
    // attempt number when claimed; null when not (already sent, non-retryable, at
    // the attempt cap, or another invocation holds the lease). REPLACES the old
    // report_sent_at-only guard, which couldn't serialise concurrent senders.
    const { data: claimedAttempt, error: claimErr } = await supabase
      .rpc('claim_service_report', { p_id: service_record_id })
    if (claimErr) throw claimErr
    if (claimedAttempt == null) {
      return new Response(JSON.stringify({ skipped: true, reason: 'not claimable (already sent, in-flight, capped, or non-retryable)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    // Fetch chemical products for this business (for category/dosage enrichment)
    const { data: chemProducts } = await supabase
      .from('chemical_products')
      .select('name, category, suggested_dose, notes')
      .eq('business_id', record.business_id)

    const chemProductList = chemProducts || []
    const chemProductMap: Record<string, any> = {}
    for (const cp of chemProductList) {
      chemProductMap[cp.name.toLowerCase()] = cp
    }

    // Fuzzy lookup: exact match first, then check if product name contains the search term or vice versa
    function findChemProduct(productName: string) {
      const key = productName.toLowerCase().trim()
      // Exact match
      if (chemProductMap[key]) return chemProductMap[key]
      // Product library name contains the added name (e.g. "Chlorine" matches "Liquid Chlorine")
      for (const cp of chemProductList) {
        const cpLower = cp.name.toLowerCase()
        if (cpLower.includes(key) || key.includes(cpLower)) return cp
      }
      return null
    }

    const pool = record.pools
    const client = pool.clients
    const chemicals = record.chemical_logs?.[0] || {}
    const tasks = record.service_tasks || []
    const chemicalsAdded = record.chemicals_added || []
    const servicePhotos = record.service_photos || []
    const targetRanges = pool.target_ranges || {}

    // Build photo URL for email
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const testKitPhoto = servicePhotos.find((p: any) => p.tag === 'test-kit') || servicePhotos[0]
    const photoUrl = testKitPhoto
      ? (testKitPhoto.signed_url || `${supabaseUrl}/storage/v1/object/public/service-photos/${testKitPhoto.storage_path}`)
      : null

    // Category styling for email
    const CATEGORY_EMAIL_COLORS: Record<string, { bg: string; text: string; label: string }> = {
      sanitiser:  { bg: '#DBEAFE', text: '#1D4ED8', label: 'Sanitiser' },
      oxidiser:   { bg: '#FEF3C7', text: '#B45309', label: 'Oxidiser / Shock' },
      balancer:   { bg: '#D1FAE5', text: '#047857', label: 'Water Balancer' },
      algaecide:  { bg: '#E0E7FF', text: '#4338CA', label: 'Algaecide' },
      clarifier:  { bg: '#F3E8FF', text: '#7C3AED', label: 'Clarifier' },
      stabiliser: { bg: '#CCFBF1', text: '#0F766E', label: 'Stabiliser' },
      salt:       { bg: '#CFFAFE', text: '#0E7490', label: 'Salt' },
      other:      { bg: '#F3F4F6', text: '#4B5563', label: 'Other' },
    }

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

    // Customer email lists ONLY completed tasks — the customer doesn't
    // need to see what wasn't done. Admins see the full ticked/unticked
    // list on the in-app service detail page.
    const tasksHtml = tasks
      .filter((t: any) => t.completed)
      .map((t: any) => `
      <li style="padding:4px 0;color:#374151;">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:#22C55E;color:white;text-align:center;line-height:18px;font-size:11px;margin-right:8px;vertical-align:middle;">&#10003;</span>
        ${esc(t.task_name)}
      </li>
    `).join('')

    // (chemicalsAddedHtml is now built inline in the email template below)

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

    // A one-off ("extra") visit is off-schedule: it doesn't set or move the
    // recurring cadence, so the email must not frame it as a routine visit or
    // promise a "Next Service" date (that date belongs to the unrelated schedule).
    const isOneOff = !!record.is_one_off

    const completedTaskCount = tasks.filter((t: any) => t.completed).length

    // Tech's free-text Notes & Issues — escaped for safe HTML embedding and
    // surfaced prominently to the owner (red callout in the summary email).
    // HTML-escape every user-controlled value interpolated into the email body
    // (client/business names, addresses, chemical names, doses, notes) so a
    // stray "<" or a crafted name can't inject markup into the customer/owner email.
    // Function declarations (NOT const arrows) so they hoist to the top of the
    // handler: the tasks map ABOVE calls esc(t.task_name), which with a const/arrow
    // would be in the temporal dead zone ("Cannot access 'esc' before
    // initialization" — a crash on every send). HTML-escape every user-controlled
    // value interpolated into the email so a crafted name can't inject markup.
    function esc(s: any): string {
      return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }
    // URL destined for an <img src> / <a href>: only http(s), attribute-escaped,
    // else empty — blocks attribute breakout and javascript:/data: URLs.
    function safeUrl(u: any): string {
      const s = u == null ? '' : String(u)
      return /^https?:\/\//i.test(s) ? esc(s) : ''
    }
    const notesEscaped = record.notes ? esc(record.notes) : ''

    // ── Customisable email copy (Settings → Notifications) ──────────────────
    // business.report_email_config = { customer: {subject,intro,signoff},
    // admin: {subject,intro,signoff} }. Blank fields fall back to defaults below.
    const emailCfg: any = (business as any)?.report_email_config || {}
    const cfgCustomer = emailCfg.customer || {}
    const cfgAdmin = emailCfg.admin || {}
    const techNameShared = staffMember?.name || record.technician_name || 'Technician'
    const tmplVars: Record<string, string> = {
      client_name: client.name || '',
      pool_address: pool.address || '',
      business_name: business?.name || '',
      technician_name: techNameShared,
      service_date: serviceDate,
      service_date_short: serviceDateShort,
      next_service_date: nextServiceDate || '',
    }
    // Section show/hide flags + button labels (Settings → Notifications; mirrors
    // src/lib/serviceReportEmail.js). A flag of `false` hides that section.
    const showC = (k: string) => cfgCustomer.show?.[k] !== false
    const showA = (k: string) => cfgAdmin.show?.[k] !== false
    const portalLabel = esc((cfgCustomer.portalButtonLabel && String(cfgCustomer.portalButtonLabel).trim()) || 'Customer Portal')
    const historyLabel = esc((cfgCustomer.historyButtonLabel && String(cfgCustomer.historyButtonLabel).trim()) || 'View Service History')
    // Custom copy is treated as PLAIN TEXT: substitute {tokens}, then HTML-escape
    // the whole thing (so a stray "<" can't break the layout) and turn newlines
    // into <br>. Returns '' for a blank template so callers fall back to default.
    const renderCopy = (t: any): string => {
      if (!t || !String(t).trim()) return ''
      const sub = String(t).replace(/\{(\w+)\}/g, (m, k) => (tmplVars[k] ?? m))
      return esc(sub).replace(/\n/g, '<br>')
    }
    // Subjects are plain text — substitute only (no HTML escaping); blank → fallback.
    const renderSubject = (t: any, fallback: string): string => {
      if (!t || !String(t).trim()) return fallback
      return String(t).replace(/\{(\w+)\}/g, (m, k) => (tmplVars[k] ?? m))
    }
    const customerIntroHtml = renderCopy(cfgCustomer.intro)
    const customerSignoffHtml = renderCopy(cfgCustomer.signoff)
    const adminIntroHtml = renderCopy(cfgAdmin.intro)
    const adminSignoffHtml = renderCopy(cfgAdmin.signoff)

    const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
      <div style="max-width:600px;margin:0 auto;">
        <!-- Header -->
        <div style="background:white;padding:28px 24px 16px;text-align:center;border-bottom:3px solid ${brandColour};">
          ${business?.logo_url ? `<img src="${safeUrl(business.logo_url)}" alt="${esc(business?.name)}" style="max-height:56px;max-width:220px;margin-bottom:10px;" />` : ''}
          <h1 style="margin:0;color:#111827;font-size:20px;font-weight:700;">${esc(business?.name) || 'PoolPro'}</h1>
        </div>

        <!-- Greeting -->
        <div style="background:white;padding:28px 24px 20px;">
          <p style="margin:0 0 4px;font-size:16px;color:#111827;">Hi ${esc(client.name)},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#6B7280;line-height:1.5;">
            ${customerIntroHtml || (isOneOff
              ? `We made an extra one-off visit to your pool at <strong>${esc(pool.address)}</strong>. Here's a summary of what we did.`
              : `Your pool at <strong>${esc(pool.address)}</strong> has been serviced. Here's a summary of everything we did today.`)}
          </p>

          ${pool.portal_token && showC('portalButton') ? `
          <!-- Portal button top -->
          <div style="margin-bottom:20px;text-align:center;">
            <a href="${Deno.env.get('SITE_URL') || 'https://pool-pro-2jk.pages.dev'}/portal/${pool.portal_token}" style="display:inline-block;background:${brandColour};color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">${portalLabel}</a>
          </div>
          ` : ''}

          <!-- Staff Card -->
          ${staffMember && showC('staffCard') ? `
          <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
            <table style="width:100%;">
              <tr>
                <td style="width:56px;vertical-align:top;">
                  ${staffMember.photo_url
                    ? `<img src="${safeUrl(staffMember.photo_url)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`
                    : `<div style="width:48px;height:48px;border-radius:50%;background:${brandColour}20;color:${brandColour};font-size:18px;font-weight:700;text-align:center;line-height:48px;">${(staffMember.name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}</div>`
                  }
                </td>
                <td style="vertical-align:top;padding-left:12px;">
                  <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">${esc(staffMember.name)}</p>
                  <p style="margin:2px 0 0;font-size:13px;color:#6B7280;">${{technician:'Pool Technician',senior_tech:'Senior Technician',manager:'Manager',owner:'Owner'}[staffMember.role] || esc(staffMember.role)}</p>
                  ${staffMember.phone ? `<p style="margin:2px 0 0;font-size:13px;color:${brandColour};">${esc(staffMember.phone)}</p>` : ''}
                </td>
              </tr>
            </table>
          </div>
          ` : ''}

          <!-- Service info bar -->
          ${showC('infoBar') ? `
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;display:flex;">
            <table style="width:100%;font-size:13px;color:#6B7280;">
              <tr>
                <td style="padding:2px 0;"><strong style="color:#374151;">Date:</strong> ${serviceDate}</td>
              </tr>
              <tr>
                <td style="padding:2px 0;"><strong style="color:#374151;">Technician:</strong> ${esc(staffMember?.name || record.technician_name || 'Technician')}</td>
              </tr>
              ${pool.type ? `<tr><td style="padding:2px 0;"><strong style="color:#374151;">Pool type:</strong> ${esc(pool.type)}</td></tr>` : ''}
            </table>
          </div>
          ` : ''}
        </div>

        <!-- Pool Photo -->
        ${photoUrl && showC('photo') ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Pool & Test Kit Photo</h3>
          <img src="${safeUrl(photoUrl)}" alt="Pool and test kit" width="520" style="width:100%;max-width:520px;height:auto;display:block;border-radius:8px;border:1px solid #E5E7EB;" />
        </div>
        ` : ''}

        <!-- Chemical Readings -->
        ${chemicalRows && showC('readings') ? `
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

        <!-- Tasks (completed only) -->
        ${completedTaskCount > 0 && showC('tasks') ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Tasks Completed <span style="font-weight:400;color:#9CA3AF;font-size:13px;">(${completedTaskCount})</span></h3>
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;">
            <ul style="list-style:none;padding:0;margin:0;font-size:13px;">
              ${tasksHtml}
            </ul>
          </div>
        </div>
        ` : ''}

        <!-- Chemicals Added -->
        ${chemicalsAdded.length > 0 && showC('chemicals') ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Chemicals Added</h3>
          ${chemicalsAdded.map((c: any) => {
            const product = findChemProduct(c.product_name)
            const cat = product?.category || 'other'
            const catStyle = CATEGORY_EMAIL_COLORS[cat] || CATEGORY_EMAIL_COLORS.other
            // Prefer the free-text dose the tech typed (e.g. "100g"); fall back to
            // the legacy structured quantity+unit for rows that predate dose_text.
            const dose = (c.dose_text && String(c.dose_text).trim())
              || [c.quantity, c.unit].filter((v: any) => v != null && v !== '').join(' ')
            return `
          <div style="background:#F9FAFB;border-radius:10px;padding:14px 16px;margin-bottom:8px;border-left:4px solid ${catStyle.text};">
            <table style="width:100%;"><tr>
              <td style="vertical-align:top;">
                <span style="display:inline-block;font-size:14px;font-weight:600;color:#111827;margin-bottom:4px;">${esc(c.product_name)}</span>
                <br/>
                <span style="display:inline-block;background:${catStyle.bg};color:${catStyle.text};font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-top:2px;">${catStyle.label}</span>
              </td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap;">
                <span style="font-size:18px;font-weight:700;color:${brandColour};">${esc(dose) || '--'}</span>
              </td>
            </tr></table>
            ${product?.suggested_dose ? `<p style="margin:6px 0 0;font-size:12px;color:#6B7280;">Recommended dose: ${esc(product.suggested_dose)}</p>` : ''}
            ${product?.notes ? `<p style="margin:3px 0 0;font-size:11px;color:#9CA3AF;line-height:1.4;">${esc(product.notes)}</p>` : ''}
          </div>`
          }).join('')}
        </div>
        ` : ''}

        <!-- Notes -->
        ${record.notes && showC('notes') ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#111827;">Notes & Recommendations</h3>
          <p style="font-size:14px;color:#374151;line-height:1.5;margin:0;background:#F9FAFB;border-radius:8px;padding:12px 16px;">${notesEscaped}</p>
        </div>
        ` : ''}

        <!-- Next Service (suppressed for one-off visits — not part of the schedule) -->
        ${nextServiceDate && !isOneOff && showC('nextService') ? `
        <div style="background:white;padding:0 24px 24px;">
          <div style="background:${brandColour}10;border:1px solid ${brandColour}30;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Next Service${scheduleLabel ? ` (${scheduleLabel})` : ''}</p>
            <p style="margin:0;font-size:17px;font-weight:700;color:${brandColour};">${nextServiceDate}</p>
          </div>
        </div>
        ` : ''}

        <!-- Portal link -->
        ${pool.portal_token && showC('historyLink') ? `
        <div style="background:white;padding:0 24px 24px;text-align:center;">
          <a href="${Deno.env.get('SITE_URL') || 'https://pool-pro-2jk.pages.dev'}/portal/${pool.portal_token}" style="display:inline-block;background:${brandColour};color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">${historyLabel}</a>
        </div>
        ` : ''}

        ${customerSignoffHtml ? `
        <!-- Custom sign-off -->
        <div style="background:white;padding:0 24px 24px;">
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">${customerSignoffHtml}</p>
        </div>
        ` : ''}

        <!-- Footer -->
        <div style="padding:20px 24px;text-align:center;font-size:12px;color:#9CA3AF;">
          <p style="margin:0 0 4px;">${esc(business?.name) || 'PoolPro'}</p>
          <p style="margin:0;">${business?.phone ? business.phone + ' &bull; ' : ''}${business?.email || ''}</p>
        </div>
      </div>
    </body>
    </html>`

    // Send emails via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const emailResults: any[] = []
    const officeResults: any[] = []

    if (!resendKey) {
      console.error('RESEND_API_KEY not found in environment')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Never throws: a network/timeout error surfaces as status 0 so the caller's
    // success-gating + failure classification always run deterministically
    // instead of bubbling to the outer 400 (which would strand a customer send
    // that already succeeded while an office copy failed).
    async function sendEmail(to: string, subject: string, emailHtml: string) {
      // 30s timeout (< the 2-min claim lease) so a hung send can never outlive its
      // lease and let a concurrent invocation re-send the same email.
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 30_000)
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            // Provider-level idempotency: if a retry re-sends (e.g. a crash between
            // Resend's 2xx and the report_sent_at commit), Resend returns the cached
            // result instead of delivering a second email. Keyed per (record,
            // recipient) so the customer and each office copy stay distinct.
            'Idempotency-Key': `svc-${service_record_id}-${to}`,
          },
          body: JSON.stringify({
            from: `${business?.name || 'PoolPro'} <noreply@poolmateapp.online>`,
            to: [to],
            subject,
            html: emailHtml,
          }),
          signal: ac.signal,
        })
        const result = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error(`Resend error sending to ${to}:`, JSON.stringify(result))
        }
        return { to, status: res.status, result }
      } catch (e) {
        console.error(`Network error sending to ${to}:`, (e as Error).message)
        return { to, status: 0, result: { error: (e as Error).message } }
      } finally {
        clearTimeout(timer)
      }
    }

    // 1. Client email — service report. This is the PRIMARY send: it decides
    //    report_sent_at (I1) and whether automations fire (I3).
    let customerResult: any = null
    if (client.email) {
      customerResult = await sendEmail(client.email, renderSubject(cfgCustomer.subject, `Pool Service Complete — ${pool.address} — ${serviceDateShort}`), html)
      emailResults.push(customerResult)
    }

    // 2. Office summary — head office + the assigned client's branch (if enabled).
    // The branch (a to-one embed) may be null; each office recipient gets a copy.
    const branch = (client as any).branches || null
    // Head office copy → the dedicated report_email if the operator set one,
    // otherwise the public/customer-facing email (back-compat default).
    const officeRecipients = [...new Set([
      business?.report_email || business?.email,
      (branch?.notify_enabled && branch?.email) ? branch.email : null,
    ].filter(Boolean))]
    // The office copy is SECONDARY when there's a customer email → send it once,
    // on the first server attempt, so a failing/retried CUSTOMER send can't spam
    // the office with a duplicate summary on every sweep. When there is NO customer
    // email the office copy IS the primary, so it must keep retrying until it 2xx's.
    const sendOffice = officeRecipients.length > 0 && (!client.email || claimedAttempt === 1)
    if (sendOffice) {
      const techName = staffMember?.name || record.technician_name || 'Technician'
      const today = new Date()
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
      const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + 1).toISOString()

      // Fetch tech stats — separate queries to avoid mutable builder bug
      const [todayRes, weekRes, remainingRes] = await Promise.all([
        staffMember?.id
          ? supabase.from('service_records').select('id', { count: 'exact', head: true }).eq('staff_id', staffMember.id).eq('status', 'completed').gte('serviced_at', startOfDay)
          : Promise.resolve({ count: null }),
        staffMember?.id
          ? supabase.from('service_records').select('id', { count: 'exact', head: true }).eq('staff_id', staffMember.id).eq('status', 'completed').gte('serviced_at', startOfWeek)
          : Promise.resolve({ count: null }),
        supabase.from('pools').select('id', { count: 'exact', head: true })
          .eq('business_id', record.business_id)
          .lte('next_due_at', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString())
          .gt('next_due_at', startOfDay),
      ])

      const jobsToday = todayRes.count ?? '—'
      const jobsThisWeek = weekRes.count ?? '—'
      const remainingToday = remainingRes.count ?? '—'

      // Pool condition on arrival — ADMIN report only. Colour: Good=green,
      // Cloudy/Dirty=orange, Green=red. Styled like the Notes & Issues callout.
      const poolCondition = record.pool_condition || null
      const conditionStyle = ({
        Good:   { bg: '#F0FDF4', border: '#BBF7D0', accent: '#16A34A', label: '#166534', text: '#14532D' },
        Cloudy: { bg: '#FFF7ED', border: '#FED7AA', accent: '#EA580C', label: '#9A3412', text: '#7C2D12' },
        Dirty:  { bg: '#FFF7ED', border: '#FED7AA', accent: '#EA580C', label: '#9A3412', text: '#7C2D12' },
        Green:  { bg: '#FEF2F2', border: '#FECACA', accent: '#DC2626', label: '#991B1B', text: '#7F1D1D' },
      } as Record<string, any>)[poolCondition as string]
      const poolConditionBanner = (poolCondition && conditionStyle) ? `
            <div style="background:${conditionStyle.bg};border:1px solid ${conditionStyle.border};border-left:4px solid ${conditionStyle.accent};border-radius:8px;padding:14px 16px;margin-bottom:16px;">
              <p style="margin:0 0 5px;font-size:12px;color:${conditionStyle.label};text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Pool condition on arrival</p>
              <p style="margin:0;font-size:16px;color:${conditionStyle.text};line-height:1.5;font-weight:700;">${esc(poolCondition)}</p>
            </div>` : ''

      const ownerHtml = `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
        <div style="max-width:560px;margin:0 auto;">
          <div style="background:${brandColour};padding:24px;text-align:center;">
            <h1 style="margin:0;color:white;font-size:18px;">Service Completed</h1>
          </div>
          <div style="background:white;padding:24px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">
              ${adminIntroHtml || `<strong>${esc(techName)}</strong> just completed a service at <strong>${esc(pool.address)}</strong> for ${esc(client.name)}.`}
            </p>

            ${record.notes && showA('notesCallout') ? `
            <!-- Tech Notes & Issues — red callout so the office sees flagged issues immediately -->
            <div style="background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
              <p style="margin:0 0 5px;font-size:12px;color:#991B1B;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">&#9888;&#65039; Notes &amp; issues from ${esc(techName)}</p>
              <p style="margin:0;font-size:14px;color:#7F1D1D;line-height:1.5;">${notesEscaped}</p>
            </div>
            ` : ''}

            <!-- Quick stats -->
            ${showA('stats') ? `
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="padding:12px;text-align:center;background:#F0FDF4;border-radius:8px 0 0 8px;">
                  <div style="font-size:24px;font-weight:700;color:#16A34A;">${jobsToday}</div>
                  <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">Jobs Today</div>
                </td>
                <td style="padding:12px;text-align:center;background:#EFF6FF;">
                  <div style="font-size:24px;font-weight:700;color:#2563EB;">${jobsThisWeek}</div>
                  <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">This Week</div>
                </td>
                <td style="padding:12px;text-align:center;background:#FFF7ED;border-radius:0 8px 8px 0;">
                  <div style="font-size:24px;font-weight:700;color:#EA580C;">${remainingToday}</div>
                  <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">Still Due Today</div>
                </td>
              </tr>
            </table>
            ` : ''}

            <!-- Service summary -->
            ${showA('summary') ? `
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
              <table style="width:100%;font-size:13px;color:#374151;">
                <tr><td style="padding:3px 0;color:#6B7280;">Client</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(client.name)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Pool</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(pool.address)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Technician</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(techName)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Tasks</td><td style="padding:3px 0;text-align:right;font-weight:600;">${completedTaskCount}/${tasks.length} completed</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Chemicals added</td><td style="padding:3px 0;text-align:right;font-weight:600;">${chemicalsAdded.length}</td></tr>
              </table>
            </div>
            ` : ''}

            ${poolConditionBanner}

            ${photoUrl && showA('photo') ? `
            <div style="margin-bottom:16px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Pool Photo</p>
              <img src="${safeUrl(photoUrl)}" alt="Pool and test kit" width="512" style="width:100%;max-width:512px;height:auto;display:block;border-radius:6px;border:1px solid #E5E7EB;" />
            </div>
            ` : ''}

            ${chemicalRows && showA('readings') ? `
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Readings</p>
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:16px;">
              <thead><tr style="background:#F9FAFB;">
                <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E5E7EB;">Reading</th>
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #E5E7EB;">Result</th>
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #E5E7EB;">Range</th>
              </tr></thead>
              <tbody>${chemicalRows}</tbody>
            </table>
            ` : ''}

            ${chemicalsAdded.length > 0 && showA('chemicals') ? `
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Chemicals Added</p>
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:16px;">
              <tbody>
                ${chemicalsAdded.map((c: any) => {
                  const dose = (c.dose_text && String(c.dose_text).trim())
                    || [c.quantity, c.unit].filter((v: any) => v != null && v !== '').join(' ')
                  return `<tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #F3F4F6;color:#374151;">${esc(c.product_name)}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #F3F4F6;text-align:right;font-weight:600;color:#111827;">${esc(dose) || '--'}</td>
                  </tr>`
                }).join('')}
              </tbody>
            </table>
            ` : ''}
          </div>
          ${adminSignoffHtml ? `<div style="padding:0 24px 16px;"><p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">${adminSignoffHtml}</p></div>` : ''}
          <div style="padding:16px 24px;text-align:center;font-size:11px;color:#9CA3AF;">
            ${esc(business?.name) || 'PoolPro'} — Service notification
          </div>
        </div>
      </body>
      </html>`

      for (const to of officeRecipients) {
        const r = await sendEmail(to, renderSubject(cfgAdmin.subject, `✅ ${techName} completed ${pool.address}`), ownerHtml)
        officeResults.push(r)
        emailResults.push(r)
      }
    }

    // Success-gate report_sent_at (I1). PRIMARY = the customer email; with no
    // customer email the office copy stands in; with no recipients at all there
    // is nothing to send, so treat as done (never retry forever). The office copy
    // is attempted on the first server attempt regardless of the customer result,
    // so the operator still gets their copy when a customer address is bad.
    const isOk = (r: any) => r && r.status >= 200 && r.status < 300
    const primaryResult = customerResult ?? officeResults[0] ?? null
    const primaryOk = primaryResult == null ? true : isOk(primaryResult)

    if (primaryOk) {
      // Sent for real → stamp report_sent_at and clear any prior error.
      const { error: stampErr } = await supabase
        .from('service_records')
        .update({ report_sent_at: new Date().toISOString(), report_last_error: null })
        .eq('id', service_record_id)
      if (stampErr) console.error('report_sent_at stamp failed:', stampErr.message, JSON.stringify(stampErr))

      // Automations fire EXACTLY once (I3): only on the run that actually sent,
      // and only when a real recipient existed (not the no-email no-op case, where
      // we still stamp report_sent_at just to stop retries). A later invocation
      // can't reach here — the claim above returns null once report_sent_at is set.
      if (primaryResult != null) try {
        const autoUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/trigger-automation`
        fetch(autoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({
            trigger_event: 'service_completed',
            business_id: record.business_id,
            service_record_id,
            client_id: pool.client_id,
            pool_id: pool.id,
            staff_name: staffMember?.name || record.technician_name,
          }),
        }).catch(e => console.error('Automation trigger failed:', e))
      } catch (e) {
        console.error('Automation trigger error:', e)
      }
    } else {
      // Not sent. Classify on HTTP STATUS only (never message text — Resend's
      // wording isn't a stable contract). Permanent = the recipient/request is
      // invalid (400/422) → stop retrying immediately. Everything else (0/network,
      // 429, 5xx, and any systemic auth error such as a bad Resend key) is
      // transient → stays retryable; the attempt cap bounds it.
      const status = primaryResult?.status ?? 0
      const permanent = status === 400 || status === 422
      const errMsg = `status ${status}: ${JSON.stringify(primaryResult?.result ?? {}).slice(0, 400)}`
      await supabase
        .from('service_records')
        .update({ report_last_error: errMsg, ...(permanent ? { report_retryable: false } : {}) })
        .eq('id', service_record_id)
    }

    return new Response(JSON.stringify({ success: primaryOk, emails: emailResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const msg = (error as any)?.message ?? String(error)
    console.error('complete-service crashed:', msg, (error as any)?.stack)
    // Surface the crash on the record (queryable) so a claimed-but-failed report
    // stops retrying silently with no signal — review finding: a throw after the
    // claim used to leave report_last_error null.
    if (sid) {
      try {
        await supabase.from('service_records')
          .update({ report_last_error: `crash: ${msg}`.slice(0, 400) })
          .eq('id', sid)
      } catch (_) { /* best effort — never mask the original error */ }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
