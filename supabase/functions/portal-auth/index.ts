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

    const { action, token, email, password } = await req.json()

    // ── Validate a portal token ──────────────────────────────────
    if (action === 'validate-token') {
      const { data: pool, error } = await supabase
        .from('pools')
        .select('id, address, client_id, clients(id, name, email, auth_user_id)')
        .eq('portal_token', token)
        .single()

      if (error || !pool) {
        return new Response(JSON.stringify({ error: 'Invalid portal link' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const client = (pool as any).clients
      return new Response(JSON.stringify({
        client_name: client.name,
        client_email: client.email,
        has_account: !!client.auth_user_id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Create a customer account ────────────────────────────────
    if (action === 'create-account') {
      if (!token || !password) {
        return new Response(JSON.stringify({ error: 'Token and password required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Look up client via token
      const { data: pool } = await supabase
        .from('pools')
        .select('id, client_id, clients(id, name, email, auth_user_id)')
        .eq('portal_token', token)
        .single()

      if (!pool) {
        return new Response(JSON.stringify({ error: 'Invalid portal link' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const client = (pool as any).clients

      if (client.auth_user_id) {
        return new Response(JSON.stringify({ error: 'Account already exists. Please log in.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Never silently link an EXISTING auth account (a staff/owner login, a
      // client of another business, a prior signup) to this client record — that
      // would bind someone else's identity to this portal without their consent.
      // Only bootstrap a brand-new user; if the email is already registered,
      // refuse and send them to the login page (mirrors set-staff-password).
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: client.email,
        password,
        email_confirm: true,
        user_metadata: { role: 'customer', name: client.name },
      })
      if (createError) {
        const msg = createError.message || ''
        const isDup = /already/i.test(msg) || /registered/i.test(msg)
        return new Response(JSON.stringify({
          error: isDup
            ? 'An account already exists for this email. Please go to the login page and sign in.'
            : (msg || 'Failed to create account'),
        }), {
          status: isDup ? 409 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const userId = newUser.user.id

      // Link the new auth user to this client record.
      await supabase
        .from('clients')
        .update({ auth_user_id: userId })
        .eq('id', client.id)

      // Return success - client will sign in with credentials
      return new Response(JSON.stringify({
        success: true,
        email: client.email,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sign-in is handled entirely client-side via supabase.auth.signInWithPassword
    // (which verifies the password). We intentionally expose NO endpoint that
    // confirms whether an email has an account — that was an enumeration oracle.

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
