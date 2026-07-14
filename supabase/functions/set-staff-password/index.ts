// Edge function: set-staff-password
//
// Lets a business owner / admin staff set or reset a password for any
// staff member in their business. Two flows in one endpoint:
//
//   1. Staff already has a user_id  → admin.updateUserById to change pw
//   2. Staff has email, no user_id  → admin.createUser, then link the
//      new auth.users.id back to staff_members.user_id
//
// Authorization: caller must be the businesses.owner_id, OR an active
// staff member with role admin/manager/owner in the same business as
// the target staff member.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_ROLES = new Set(['admin', 'manager', 'owner'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Best-effort security audit trail (see security_events). Never let a logging
// failure fail the password operation.
async function logSecurityEvent(admin: any, businessId: string, caller: any, staffId: string, kind: string) {
  try {
    await admin.from('security_events').insert({
      business_id: businessId,
      actor_user_id: caller?.id ?? null,
      actor_email: caller?.email ?? null,
      action: 'staff.password_set',
      target_type: 'staff_member',
      target_id: staffId,
      metadata: { kind },
    })
  } catch { /* ignore */ }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. Verify the caller's identity ──────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401)

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return jsonResponse({ error: 'Invalid session' }, 401)

    // ── 2. Validate body ─────────────────────────────────────
    const body = await req.json().catch(() => null)
    const staffId: string | undefined = body?.staff_id
    const newPassword: string | undefined = body?.new_password
    if (!staffId || !newPassword) {
      return jsonResponse({ error: 'staff_id and new_password are required' }, 400)
    }
    if (newPassword.length < 6) {
      return jsonResponse({ error: 'Password must be at least 6 characters' }, 400)
    }

    // ── 3. Privileged client for the rest ────────────────────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── 4. Look up the target staff member ───────────────────
    const { data: staff, error: staffErr } = await adminClient
      .from('staff_members')
      .select('id, business_id, user_id, email')
      .eq('id', staffId)
      .maybeSingle()
    if (staffErr) return jsonResponse({ error: staffErr.message }, 500)
    if (!staff) return jsonResponse({ error: 'Staff member not found' }, 404)

    // ── 5. Authorize the caller against the target's business ──
    const { data: business, error: bizErr } = await adminClient
      .from('businesses')
      .select('id, owner_id')
      .eq('id', staff.business_id)
      .maybeSingle()
    if (bizErr) return jsonResponse({ error: bizErr.message }, 500)
    if (!business) return jsonResponse({ error: 'Business not found' }, 404)

    let authorized = business.owner_id === caller.id
    if (!authorized) {
      const { data: callerStaff } = await adminClient
        .from('staff_members')
        .select('role, is_active')
        .eq('user_id', caller.id)
        .eq('business_id', staff.business_id)
        .eq('is_active', true)
        .maybeSingle()
      const role = (callerStaff?.role || '').toLowerCase()
      authorized = !!callerStaff && ADMIN_ROLES.has(role)
    }
    if (!authorized) return jsonResponse({ error: 'Not authorized' }, 403)

    // ── 6. Apply the password ────────────────────────────────
    if (staff.user_id) {
      // Existing user → update password
      const { error: updErr } = await adminClient.auth.admin.updateUserById(staff.user_id, {
        password: newPassword,
      })
      if (updErr) return jsonResponse({ error: updErr.message }, 500)
      await logSecurityEvent(adminClient, staff.business_id, caller, staff.id, 'updated')
      return jsonResponse({ success: true, action: 'updated', user_id: staff.user_id })
    } else {
      // No user_id → must have an email to bootstrap a new auth user
      if (!staff.email) {
        return jsonResponse({
          error: 'Staff member has no email — add an email first, then set the password',
        }, 400)
      }
      // Create the auth user (email-confirmed, since the admin is vouching).
      // If the email is already registered (customer portal account, owner
      // of another business, prior signup, etc.) this returns an error and
      // we MUST surface it — never silently link an existing auth user to
      // a new staff_members row.
      const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
        email: staff.email,
        password: newPassword,
        email_confirm: true,
        user_metadata: { role: 'staff' },
      })
      if (createErr) {
        const msg = createErr.message || ''
        // 422 Conflict-style for "email already registered"; everything
        // else is a 500.
        const isDup = /already/i.test(msg) || /registered/i.test(msg)
        return jsonResponse(
          {
            error: isDup
              ? `That email is already registered to another account. Use a different email — never reuse a customer or portal email for staff logins.`
              : msg || 'Failed to create login.',
          },
          isDup ? 409 : 500,
        )
      }
      const newUserId = createData?.user?.id
      if (!newUserId) {
        return jsonResponse({ error: 'Failed to create auth user' }, 500)
      }
      // Link the staff_members row
      const { error: linkErr } = await adminClient
        .from('staff_members')
        .update({ user_id: newUserId, invite_status: 'accepted' })
        .eq('id', staff.id)
      if (linkErr) return jsonResponse({ error: linkErr.message }, 500)

      await logSecurityEvent(adminClient, staff.business_id, caller, staff.id, 'created')
      return jsonResponse({ success: true, action: 'created', user_id: newUserId })
    }
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Unexpected error' }, 500)
  }
})
