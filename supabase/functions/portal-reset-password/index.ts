// Edge function: portal-reset-password
//
// Sends the CUSTOMER PORTAL "forgot password" email BRANDED as the pool business,
// via Resend — instead of Supabase's generic built-in "Supabase Auth" template.
// The portal is white-labeled per business, so the reset email must look like it
// came from that business (logo/colour/name), like every other PoolPro email.
//
// We generate the recovery link ourselves with admin.generateLink (which does NOT
// send Supabase's own email) and deliver it via Resend. The link is identical to
// the one Supabase would have emailed, so /portal/reset-password is unchanged.
//
// Enumeration-safe: ALWAYS returns { ok: true } — it never reveals whether an
// email is registered. Only actually sends when the email maps to a real portal
// customer, and rate-limits per address via recovery_sent_at.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Module-scope so no handler execution order can put them in a temporal dead zone.
function esc(s: any): string {
  return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function safeUrl(u: any): string {
  const s = u == null ? '' : String(u)
  return /^https?:\/\//i.test(s) ? esc(s) : ''
}
// Strip characters that could break the RFC5322 From/Subject header.
function headerSafe(s: any): string {
  return String(s ?? '').replace(/[\r\n"<>]/g, '').trim().slice(0, 78)
}

const COOLDOWN_MS = 60_000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  // ALWAYS return ok — never leak whether an email has an account.
  const ok = () => json({ ok: true })

  try {
    const { email, redirectTo } = await req.json().catch(() => ({}))
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) return ok()

    // Host-ANCHORED redirect check. The emailed link carries recovery tokens, so it
    // must only ever point back to OUR portal — a path-only check would let
    // https://evil.com/portal/reset-password through (token exfiltration → ATO).
    // Origin must be allow-listed AND the path exact. generateLink also enforces
    // Supabase's own allow-list; this is a second, tighter, server-controlled gate.
    // PORTAL_ALLOWED_ORIGINS (comma-separated) overrides the default for custom
    // domains / preview deploys; unknown origin → fail closed (no email).
    const ALLOWED_ORIGINS = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') || 'https://pool-pro-2jk.pages.dev')
      .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
    let redirUrl: URL
    try { redirUrl = new URL(String(redirectTo || '')) } catch { return ok() }
    if (redirUrl.pathname !== '/portal/reset-password' || !ALLOWED_ORIGINS.includes(redirUrl.origin)) {
      console.warn('portal-reset-password: redirect not allowed:', String(redirectTo || ''))
      return ok()
    }
    const redir = redirUrl.toString()

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Map email → a portal customer with an auth login. Escape LIKE wildcards
    //    so ilike is an exact case-insensitive match (an email can contain '_').
    const likeEmail = cleanEmail.replace(/([\\%_])/g, '\\$1')
    const { data: client } = await admin
      .from('clients')
      .select('business_id, auth_user_id, name, email')
      .ilike('email', likeEmail)
      .not('auth_user_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (!client?.auth_user_id) return ok()

    const targetEmail = client.email || cleanEmail

    // 2. Cooldown — skip if a recovery link was just sent (the public endpoint
    //    bypasses Supabase's own per-email rate limit, so guard inbox-flooding).
    try {
      const { data: userRes } = await admin.auth.admin.getUserById(client.auth_user_id)
      const sentAt = (userRes?.user as any)?.recovery_sent_at
      if (sentAt && Date.now() - new Date(sentAt).getTime() < COOLDOWN_MS) return ok()
    } catch { /* non-fatal — proceed to send */ }

    // 3. Branding for THIS customer's business.
    const { data: business } = await admin
      .from('businesses')
      .select('name, logo_url, brand_colour, phone, email')
      .eq('id', client.business_id)
      .maybeSingle()

    // 4. Generate the recovery link (does NOT trigger Supabase's own email).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
      options: { redirectTo: redir },
    })
    const actionLink = (linkData as any)?.properties?.action_link
    if (linkErr || !actionLink) {
      if (linkErr) console.error('generateLink failed:', linkErr.message)
      return ok()
    }

    // 5. Send the branded email via Resend.
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) { console.error('RESEND_API_KEY not configured'); return ok() }

    const brand = /^#[0-9a-f]{6}$/i.test(business?.brand_colour || '') ? business!.brand_colour : '#0EA5E9'
    const bizName = business?.name || 'Your pool service'
    const fromName = headerSafe(bizName) || 'Pool service'

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:480px;margin:0 auto;padding:24px;">
        <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="background:${brand};padding:28px 24px;text-align:center;">
            ${business?.logo_url ? `<img src="${safeUrl(business.logo_url)}" alt="${esc(bizName)}" width="56" style="height:56px;width:56px;border-radius:12px;object-fit:cover;margin-bottom:10px;display:inline-block;" />` : ''}
            <h1 style="margin:0;color:#ffffff;font-size:18px;">${esc(bizName)}</h1>
          </div>
          <div style="padding:28px 24px;">
            <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">Reset your password</h2>
            <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.5;">
              We received a request to reset the password for your customer portal. Tap the button below to choose a new one.
            </p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${safeUrl(actionLink)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:10px;">Reset password</a>
            </div>
            <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.5;">
              This link expires soon. If you didn't request a password reset, you can safely ignore this email — your password won't change.
            </p>
          </div>
          <div style="padding:16px 24px;border-top:1px solid #F3F4F6;text-align:center;font-size:12px;color:#9CA3AF;">
            <p style="margin:0 0 2px;font-weight:600;color:#6B7280;">${esc(bizName)}</p>
            <p style="margin:0;">${business?.phone ? esc(business.phone) + (business?.email ? ' &bull; ' : '') : ''}${esc(business?.email)}</p>
          </div>
        </div>
      </div>
    </body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${fromName} <noreply@poolmateapp.online>`,
        to: [targetEmail],
        subject: `Reset your ${fromName} password`,
        html,
      }),
    })
    if (!res.ok) console.error('Resend error:', res.status, await res.text().catch(() => ''))

    return ok()
  } catch (e) {
    // Enumeration-safe even on error — the caller must never learn what happened.
    console.error('portal-reset-password error:', (e as Error).message)
    return json({ ok: true })
  }
})
