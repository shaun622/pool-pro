// ─────────────────────────────────────────────────────────────────────────────
// Service-report email templates (customer report + admin summary).
//
// ⚠️  KEEP IN SYNC WITH supabase/functions/complete-service/index.ts  ⚠️
// The edge function is what actually SENDS these emails; this file is a faithful
// port used only to render the LIVE PREVIEW in Settings → Notifications. Because
// edge functions are pasted as one self-contained file, they can't import this —
// so any change to the email markup/sections must be mirrored in BOTH files.
//
// build*Report(data, cfg) -> { subject, html }
//   cfg = businesses.report_email_config (see shape below). Blank wording falls
//   back to DEFAULTS; a show.<key> flag of `false` hides that section.
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s) =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Substitute {tokens}, then treat as PLAIN TEXT (escape + newlines->br). '' = blank.
function renderCopy(t, vars) {
  if (!t || !String(t).trim()) return ''
  const sub = String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))
  return esc(sub).replace(/\n/g, '<br>')
}
function renderSubject(t, vars, fallback) {
  if (!t || !String(t).trim()) return fallback
  return String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))
}
const tokenVars = (d) => ({
  client_name: d.client?.name || '',
  pool_address: d.pool?.address || '',
  business_name: d.business?.name || '',
  technician_name: d.staffMember?.name || d.techName || 'Technician',
  service_date: d.serviceDate || '',
  service_date_short: d.serviceDateShort || '',
  next_service_date: d.nextServiceDate || '',
})
const shown = (obj, key) => obj?.show?.[key] !== false // undefined/true => shown

// Default wording — MUST match the edge function's fallback copy verbatim.
export const DEFAULTS = {
  customer: {
    subject: 'Pool Service Complete — {pool_address} — {service_date_short}',
    intro: "Your pool at {pool_address} has been serviced. Here's a summary of everything we did today.",
    signoff: '',
    portalButtonLabel: 'Customer Portal',
    historyButtonLabel: 'View Service History',
  },
  admin: {
    subject: '✅ {technician_name} completed {pool_address}',
    intro: '{technician_name} just completed a service at {pool_address} for {client_name}.',
    signoff: '',
  },
}

// Section toggles surfaced in the editor UI.
export const CUSTOMER_SECTIONS = [
  { key: 'portalButton', label: 'Customer portal button' },
  { key: 'staffCard', label: 'Technician card' },
  { key: 'infoBar', label: 'Date / technician / pool type' },
  { key: 'photo', label: 'Pool & test-kit photo' },
  { key: 'readings', label: 'Chemical readings' },
  { key: 'tasks', label: 'Tasks completed' },
  { key: 'chemicals', label: 'Chemicals added' },
  { key: 'notes', label: 'Notes & recommendations' },
  { key: 'nextService', label: 'Next service date' },
  { key: 'historyLink', label: 'View service history button' },
]
export const ADMIN_SECTIONS = [
  { key: 'notesCallout', label: 'Notes & issues callout' },
  { key: 'stats', label: 'Daily stats (jobs today / week / due)' },
  { key: 'summary', label: 'Service summary' },
  { key: 'photo', label: 'Pool photo' },
  { key: 'readings', label: 'Chemical readings' },
  { key: 'chemicals', label: 'Chemicals added' },
]

export const PLACEHOLDERS = [
  { token: '{client_name}', label: 'Client name' },
  { token: '{pool_address}', label: 'Pool address' },
  { token: '{business_name}', label: 'Business name' },
  { token: '{technician_name}', label: 'Technician' },
  { token: '{service_date}', label: 'Service date' },
  { token: '{service_date_short}', label: 'Service date (short)' },
  { token: '{next_service_date}', label: 'Next service' },
]

// ── Shared section builders (mirror the edge function) ──────────────────────
const CATEGORY_EMAIL_COLORS = {
  sanitiser: { bg: '#DBEAFE', text: '#1D4ED8', label: 'Sanitiser' },
  oxidiser: { bg: '#FEF3C7', text: '#B45309', label: 'Oxidiser / Shock' },
  balancer: { bg: '#D1FAE5', text: '#047857', label: 'Water Balancer' },
  algaecide: { bg: '#E0E7FF', text: '#4338CA', label: 'Algaecide' },
  clarifier: { bg: '#F3E8FF', text: '#7C3AED', label: 'Clarifier' },
  stabiliser: { bg: '#CCFBF1', text: '#0F766E', label: 'Stabiliser' },
  salt: { bg: '#CFFAFE', text: '#0E7490', label: 'Salt' },
  other: { bg: '#F3F4F6', text: '#4B5563', label: 'Other' },
}
// Preview-only category guess (the live email uses the business's chemical
// library; the preview approximates from the name so sample chemicals look right).
function guessCategory(name = '') {
  const n = name.toLowerCase()
  if (/chlor|sanitis|sanitiz/.test(n)) return 'sanitiser'
  if (/shock|oxidis|oxidiz/.test(n)) return 'oxidiser'
  if (/acid|alkalin|balance|buffer|soda/.test(n)) return 'balancer'
  if (/algae/.test(n)) return 'algaecide'
  if (/clarif|floc/.test(n)) return 'clarifier'
  if (/stabilis|stabiliz|cyanuric/.test(n)) return 'stabiliser'
  if (/salt/.test(n)) return 'salt'
  return 'other'
}
function chemStatus(value, range) {
  if (value == null || !range) return '#9CA3AF'
  const [min, max] = range
  if (value < min * 0.9 || value > max * 1.1) return '#EF4444'
  if (value < min || value > max) return '#F59E0B'
  return '#22C55E'
}
function buildChemicalRows(readings = {}, targetRanges = {}) {
  return [
    { label: 'pH', value: readings.ph, range: targetRanges.ph },
    { label: 'Free Chlorine', value: readings.free_chlorine, range: targetRanges.free_cl, unit: 'ppm' },
    { label: 'Total Chlorine', value: readings.total_chlorine, range: targetRanges.total_cl, unit: 'ppm' },
    { label: 'Alkalinity', value: readings.alkalinity, range: targetRanges.alk, unit: 'ppm' },
    { label: 'Stabiliser', value: readings.stabiliser, range: targetRanges.stabiliser, unit: 'ppm' },
    { label: 'Calcium Hardness', value: readings.calcium_hardness, range: targetRanges.calcium, unit: 'ppm' },
    { label: 'Salt', value: readings.salt, unit: 'ppm' },
  ]
    .filter((r) => r.value != null)
    .map((r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;">${r.label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${chemStatus(r.value, r.range)};margin-right:6px;"></span>
            ${r.value}${r.unit ? ' ' + r.unit : ''}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#9CA3AF;">
            ${r.range ? `${r.range[0]}–${r.range[1]}` : '—'}
          </td>
        </tr>`).join('')
}

// ── Customer report ─────────────────────────────────────────────────────────
export function buildCustomerReport(data, cfg = {}) {
  const c = cfg.customer || {}
  const vars = tokenVars(data)
  const business = data.business || {}
  const client = data.client || {}
  const pool = data.pool || {}
  const staffMember = data.staffMember || null
  const brandColour = business.brand_colour || '#0EA5E9'
  const siteUrl = data.siteUrl || 'https://pool-pro-2jk.pages.dev'
  const tasks = data.tasks || []
  const chemicalsAdded = data.chemicalsAdded || []
  const photoUrl = data.photoUrl || null
  const completedTaskCount = tasks.filter((t) => t.completed).length
  const chemicalRows = buildChemicalRows(data.readings, data.targetRanges)
  const introHtml = renderCopy(c.intro, vars) || renderCopy(DEFAULTS.customer.intro, vars)
  const signoffHtml = renderCopy(c.signoff, vars)
  const portalLabel = esc((c.portalButtonLabel && c.portalButtonLabel.trim()) || DEFAULTS.customer.portalButtonLabel)
  const historyLabel = esc((c.historyButtonLabel && c.historyButtonLabel.trim()) || DEFAULTS.customer.historyButtonLabel)

  const tasksHtml = tasks.filter((t) => t.completed).map((t) => `
      <li style="padding:4px 0;color:#374151;">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:#22C55E;color:white;text-align:center;line-height:18px;font-size:11px;margin-right:8px;vertical-align:middle;">&#10003;</span>
        ${esc(t.task_name)}
      </li>`).join('')

  const subject = renderSubject(c.subject, vars, renderSubject(DEFAULTS.customer.subject, vars, ''))

  const html = `
    <!DOCTYPE html><html>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
      <div style="max-width:600px;margin:0 auto;">
        <div style="background:white;padding:28px 24px 16px;text-align:center;border-bottom:3px solid ${brandColour};">
          ${business.logo_url ? `<img src="${business.logo_url}" alt="${esc(business.name)}" style="max-height:56px;max-width:220px;margin-bottom:10px;" />` : ''}
          <h1 style="margin:0;color:#111827;font-size:20px;font-weight:700;">${esc(business.name) || 'PoolPro'}</h1>
        </div>
        <div style="background:white;padding:28px 24px 20px;">
          <p style="margin:0 0 4px;font-size:16px;color:#111827;">Hi ${esc(client.name)},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#6B7280;line-height:1.5;">${introHtml}</p>

          ${shown(c, 'portalButton') && pool.portal_token ? `
          <div style="margin-bottom:20px;text-align:center;">
            <a href="${siteUrl}/portal/${pool.portal_token}" style="display:inline-block;background:${brandColour};color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">${portalLabel}</a>
          </div>` : ''}

          ${shown(c, 'staffCard') && staffMember ? `
          <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
            <table style="width:100%;"><tr>
              <td style="width:56px;vertical-align:top;">
                ${staffMember.photo_url
                  ? `<img src="${staffMember.photo_url}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`
                  : `<div style="width:48px;height:48px;border-radius:50%;background:${brandColour}20;color:${brandColour};font-size:18px;font-weight:700;text-align:center;line-height:48px;">${(staffMember.name || '?').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}</div>`}
              </td>
              <td style="vertical-align:top;padding-left:12px;">
                <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">${esc(staffMember.name)}</p>
                <p style="margin:2px 0 0;font-size:13px;color:#6B7280;">${{ technician: 'Pool Technician', senior_tech: 'Senior Technician', manager: 'Manager', owner: 'Owner' }[staffMember.role] || staffMember.role || ''}</p>
                ${staffMember.phone ? `<p style="margin:2px 0 0;font-size:13px;color:${brandColour};">${esc(staffMember.phone)}</p>` : ''}
              </td>
            </tr></table>
          </div>` : ''}

          ${shown(c, 'infoBar') ? `
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;">
            <table style="width:100%;font-size:13px;color:#6B7280;">
              <tr><td style="padding:2px 0;"><strong style="color:#374151;">Date:</strong> ${esc(data.serviceDate)}</td></tr>
              <tr><td style="padding:2px 0;"><strong style="color:#374151;">Technician:</strong> ${esc(staffMember?.name || data.techName || 'Technician')}</td></tr>
              ${pool.type ? `<tr><td style="padding:2px 0;"><strong style="color:#374151;">Pool type:</strong> ${esc(pool.type)}</td></tr>` : ''}
            </table>
          </div>` : ''}
        </div>

        ${shown(c, 'photo') && photoUrl ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Pool & Test Kit Photo</h3>
          <img src="${photoUrl}" alt="Pool and test kit" width="520" style="width:100%;max-width:520px;height:auto;display:block;border-radius:8px;border:1px solid #E5E7EB;" />
        </div>` : ''}

        ${shown(c, 'readings') && chemicalRows ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Chemical Readings</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E5E7EB;border-radius:8px;">
            <thead><tr style="background:#F9FAFB;">
              <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Reading</th>
              <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Result</th>
              <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #E5E7EB;font-weight:600;color:#374151;">Target Range</th>
            </tr></thead>
            <tbody>${chemicalRows}</tbody>
          </table>
        </div>` : ''}

        ${shown(c, 'tasks') && completedTaskCount > 0 ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Tasks Completed <span style="font-weight:400;color:#9CA3AF;font-size:13px;">(${completedTaskCount})</span></h3>
          <div style="background:#F9FAFB;border-radius:8px;padding:12px 16px;">
            <ul style="list-style:none;padding:0;margin:0;font-size:13px;">${tasksHtml}</ul>
          </div>
        </div>` : ''}

        ${shown(c, 'chemicals') && chemicalsAdded.length > 0 ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111827;">Chemicals Added</h3>
          ${chemicalsAdded.map((ch) => {
            const cat = CATEGORY_EMAIL_COLORS[guessCategory(ch.product_name)] || CATEGORY_EMAIL_COLORS.other
            const dose = (ch.dose_text && String(ch.dose_text).trim()) || [ch.quantity, ch.unit].filter((v) => v != null && v !== '').join(' ')
            return `
          <div style="background:#F9FAFB;border-radius:10px;padding:14px 16px;margin-bottom:8px;border-left:4px solid ${cat.text};">
            <table style="width:100%;"><tr>
              <td style="vertical-align:top;">
                <span style="display:inline-block;font-size:14px;font-weight:600;color:#111827;margin-bottom:4px;">${esc(ch.product_name)}</span><br/>
                <span style="display:inline-block;background:${cat.bg};color:${cat.text};font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-top:2px;">${cat.label}</span>
              </td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap;">
                <span style="font-size:18px;font-weight:700;color:${brandColour};">${esc(dose) || '--'}</span>
              </td>
            </tr></table>
          </div>`
          }).join('')}
        </div>` : ''}

        ${shown(c, 'notes') && data.notes ? `
        <div style="background:white;padding:0 24px 20px;">
          <h3 style="margin:0 0 8px;font-size:15px;font-weight:600;color:#111827;">Notes & Recommendations</h3>
          <p style="font-size:14px;color:#374151;line-height:1.5;margin:0;background:#F9FAFB;border-radius:8px;padding:12px 16px;">${esc(data.notes)}</p>
        </div>` : ''}

        ${shown(c, 'nextService') && data.nextServiceDate && !data.isOneOff ? `
        <div style="background:white;padding:0 24px 24px;">
          <div style="background:${brandColour}10;border:1px solid ${brandColour}30;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Next Service${data.scheduleLabel ? ` (${esc(data.scheduleLabel)})` : ''}</p>
            <p style="margin:0;font-size:17px;font-weight:700;color:${brandColour};">${esc(data.nextServiceDate)}</p>
          </div>
        </div>` : ''}

        ${shown(c, 'historyLink') && pool.portal_token ? `
        <div style="background:white;padding:0 24px 24px;text-align:center;">
          <a href="${siteUrl}/portal/${pool.portal_token}" style="display:inline-block;background:${brandColour};color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">${historyLabel}</a>
        </div>` : ''}

        ${signoffHtml ? `<div style="background:white;padding:0 24px 24px;"><p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">${signoffHtml}</p></div>` : ''}

        <div style="padding:20px 24px;text-align:center;font-size:12px;color:#9CA3AF;">
          <p style="margin:0 0 4px;">${esc(business.name) || 'PoolPro'}</p>
          <p style="margin:0;">${business.phone ? esc(business.phone) + ' &bull; ' : ''}${esc(business.email) || ''}</p>
        </div>
      </div>
    </body></html>`
  return { subject, html }
}

// ── Admin summary ─────────────────────────────────────────────────────────────
export function buildAdminReport(data, cfg = {}) {
  const a = cfg.admin || {}
  const vars = tokenVars(data)
  const business = data.business || {}
  const client = data.client || {}
  const pool = data.pool || {}
  const staffMember = data.staffMember || null
  const brandColour = business.brand_colour || '#0EA5E9'
  const techName = staffMember?.name || data.techName || 'Technician'
  const tasks = data.tasks || []
  const chemicalsAdded = data.chemicalsAdded || []
  const photoUrl = data.photoUrl || null
  const completedTaskCount = tasks.filter((t) => t.completed).length
  const chemicalRows = buildChemicalRows(data.readings, data.targetRanges)
  const stats = data.stats || { jobsToday: '—', jobsThisWeek: '—', remainingToday: '—' }
  const introHtml = renderCopy(a.intro, vars) || renderCopy(DEFAULTS.admin.intro, vars)
  const signoffHtml = renderCopy(a.signoff, vars)
  const subject = renderSubject(a.subject, vars, renderSubject(DEFAULTS.admin.subject, vars, ''))

  const html = `
      <!DOCTYPE html><html>
      <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;">
        <div style="max-width:560px;margin:0 auto;">
          <div style="background:${brandColour};padding:24px;text-align:center;">
            <h1 style="margin:0;color:white;font-size:18px;">Service Completed</h1>
          </div>
          <div style="background:white;padding:24px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">${introHtml}</p>

            ${shown(a, 'notesCallout') && data.notes ? `
            <div style="background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
              <p style="margin:0 0 5px;font-size:12px;color:#991B1B;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">&#9888;&#65039; Notes &amp; issues from ${esc(techName)}</p>
              <p style="margin:0;font-size:14px;color:#7F1D1D;line-height:1.5;">${esc(data.notes)}</p>
            </div>` : ''}

            ${shown(a, 'stats') ? `
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tr>
              <td style="padding:12px;text-align:center;background:#F0FDF4;border-radius:8px 0 0 8px;">
                <div style="font-size:24px;font-weight:700;color:#16A34A;">${stats.jobsToday}</div>
                <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">Jobs Today</div>
              </td>
              <td style="padding:12px;text-align:center;background:#EFF6FF;">
                <div style="font-size:24px;font-weight:700;color:#2563EB;">${stats.jobsThisWeek}</div>
                <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">This Week</div>
              </td>
              <td style="padding:12px;text-align:center;background:#FFF7ED;border-radius:0 8px 8px 0;">
                <div style="font-size:24px;font-weight:700;color:#EA580C;">${stats.remainingToday}</div>
                <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;">Still Due Today</div>
              </td>
            </tr></table>` : ''}

            ${shown(a, 'summary') ? `
            <div style="background:#F9FAFB;border-radius:8px;padding:16px;margin-bottom:16px;">
              <table style="width:100%;font-size:13px;color:#374151;">
                <tr><td style="padding:3px 0;color:#6B7280;">Client</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(client.name)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Pool</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(pool.address)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Technician</td><td style="padding:3px 0;text-align:right;font-weight:600;">${esc(techName)}</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Tasks</td><td style="padding:3px 0;text-align:right;font-weight:600;">${completedTaskCount}/${tasks.length} completed</td></tr>
                <tr><td style="padding:3px 0;color:#6B7280;">Chemicals added</td><td style="padding:3px 0;text-align:right;font-weight:600;">${chemicalsAdded.length}</td></tr>
              </table>
            </div>` : ''}

            ${shown(a, 'photo') && photoUrl ? `
            <div style="margin-bottom:16px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Pool Photo</p>
              <img src="${photoUrl}" alt="Pool and test kit" width="512" style="width:100%;max-width:512px;height:auto;display:block;border-radius:6px;border:1px solid #E5E7EB;" />
            </div>` : ''}

            ${shown(a, 'readings') && chemicalRows ? `
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Readings</p>
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:16px;">
              <thead><tr style="background:#F9FAFB;">
                <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E5E7EB;">Reading</th>
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #E5E7EB;">Result</th>
                <th style="padding:6px 10px;text-align:center;border-bottom:1px solid #E5E7EB;">Range</th>
              </tr></thead>
              <tbody>${chemicalRows}</tbody>
            </table>` : ''}

            ${shown(a, 'chemicals') && chemicalsAdded.length > 0 ? `
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Chemicals Added</p>
            <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:16px;"><tbody>
              ${chemicalsAdded.map((ch) => {
                const dose = (ch.dose_text && String(ch.dose_text).trim()) || [ch.quantity, ch.unit].filter((v) => v != null && v !== '').join(' ')
                return `<tr>
                  <td style="padding:6px 10px;border-bottom:1px solid #F3F4F6;color:#374151;">${esc(ch.product_name)}</td>
                  <td style="padding:6px 10px;border-bottom:1px solid #F3F4F6;text-align:right;font-weight:600;color:#111827;">${esc(dose) || '--'}</td>
                </tr>`
              }).join('')}
            </tbody></table>` : ''}
          </div>
          ${signoffHtml ? `<div style="padding:0 24px 16px;"><p style="margin:0;font-size:13px;color:#374151;line-height:1.5;">${signoffHtml}</p></div>` : ''}
          <div style="padding:16px 24px;text-align:center;font-size:11px;color:#9CA3AF;">
            ${esc(business.name) || 'PoolPro'} — Service notification
          </div>
        </div>
      </body></html>`
  return { subject, html }
}

// Sample visit for the preview. The caller merges the REAL business over this.
export const SAMPLE_VISIT = {
  business: { name: 'Your Pool Co', brand_colour: '#0EA5E9', logo_url: null, phone: '', email: '' },
  client: { name: 'Jane Smith' },
  pool: { address: '12 Marina Boulevard, Sydney', type: 'chlorine', portal_token: 'sample-token', schedule_frequency: 'weekly' },
  staffMember: { name: 'Alex Turner', role: 'technician', phone: '0412 345 678', photo_url: null },
  techName: 'Alex Turner',
  serviceDate: 'Friday 11 July 2026',
  serviceDateShort: '11/07/2026',
  nextServiceDate: 'Friday 18 July 2026',
  scheduleLabel: 'Weekly',
  isOneOff: false,
  photoUrl: 'https://placehold.co/520x320/e0f2fe/0369a1?text=Pool+%26+Test+Kit+Photo',
  readings: { ph: 7.4, free_chlorine: 2.1, total_chlorine: 2.3, alkalinity: 110, stabiliser: 45, calcium_hardness: 220, salt: null },
  targetRanges: { ph: [7.2, 7.6], free_cl: [1, 3], total_cl: [1, 3], alk: [80, 120], stabiliser: [30, 50], calcium: [200, 400] },
  tasks: [
    { task_name: 'Skim surface & empty baskets', completed: true },
    { task_name: 'Vacuum pool floor', completed: true },
    { task_name: 'Brush walls & tiles', completed: true },
    { task_name: 'Backwash filter', completed: false },
  ],
  chemicalsAdded: [
    { product_name: 'Liquid Chlorine', dose_text: '2 L' },
    { product_name: 'pH Buffer (Alkalinity)', dose_text: '500 g' },
  ],
  notes: 'Water was slightly cloudy on arrival — added chlorine and it cleared up. Recommend running the pump an extra 2 hours/day this week.',
  stats: { jobsToday: 4, jobsThisWeek: 18, remainingToday: 2 },
  siteUrl: 'https://pool-pro-2jk.pages.dev',
}
