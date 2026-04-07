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

      // Check if this email already exists in auth (business owner or another client)
      const { data: existingUsers } = await supabase.auth.admin.listUsers()
      const existingUser = existingUsers?.users?.find(u => u.email === client.email)

      let userId: string

      if (existingUser) {
        // Link existing auth user to this client
        userId = existingUser.id
      } else {
        // Create new auth user
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: client.email,
          password,
          email_confirm: true,
          user_metadata: { role: 'customer', name: client.name },
        })
        if (createError) {
          return new Response(JSON.stringify({ error: createError.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        userId = newUser.user.id
      }

      // Link auth user to client record
      await supabase
        .from('clients')
        .update({ auth_user_id: userId })
        .eq('id', client.id)

      // Sign them in and return session
      const { data: session, error: signInError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: client.email,
      })

      // Return success - client will sign in with credentials
      return new Response(JSON.stringify({
        success: true,
        email: client.email,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Sign in a customer ───────────────────────────────────────
    if (action === 'sign-in') {
      if (!email || !password) {
        return new Response(JSON.stringify({ error: 'Email and password required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Verify this email belongs to a client
      const { data: clients } = await supabase
        .from('clients')
        .select('id, auth_user_id')
        .eq('email', email)
        .not('auth_user_id', 'is', null)
        .limit(1)

      if (!clients || clients.length === 0) {
        return new Response(JSON.stringify({ error: 'No customer account found for this email' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ valid: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
