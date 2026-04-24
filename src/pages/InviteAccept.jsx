import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { supabase } from '../lib/supabase'

export default function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    async function fetchInvite() {
      // Find the staff member by invite token
      const { data, error: err } = await supabase
        .from('staff_members')
        .select('*, businesses(name)')
        .eq('invite_token', token)
        .eq('invite_status', 'pending')
        .maybeSingle()

      if (err || !data) {
        setError('This invite link is invalid or has already been used.')
        setLoading(false)
        return
      }

      setInvite(data)
      setBusinessName(data.businesses?.name || 'a business')
      setLoading(false)
    }
    fetchInvite()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    setError('')

    try {
      // 1. Create the auth user
      const { data: authData, error: signupErr } = await supabase.auth.signUp({
        email: invite.email,
        password,
        options: {
          data: { role: 'staff' },
          emailRedirectTo: `${window.location.origin}/tech`,
        },
      })

      if (signupErr) throw signupErr

      // 2. Link the staff member to the auth user
      const userId = authData.user?.id
      if (userId) {
        await supabase
          .from('staff_members')
          .update({
            user_id: userId,
            invite_status: 'accepted',
            invite_token: null,
          })
          .eq('id', invite.id)
      }

      // 3. Sign in immediately
      await supabase.auth.signInWithPassword({ email: invite.email, password })

      // 4. Navigate to tech view
      navigate('/tech', { replace: true })
    } catch (err) {
      console.error('Error accepting invite:', err)
      setError(err.message || 'Failed to set up your account. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 px-4">
        <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Invalid Invite</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">{error}</p>
          <button onClick={() => navigate('/login')} className="text-pool-600 dark:text-pool-400 font-semibold text-sm hover:text-pool-700">
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Welcome to PoolPro</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            You've been invited to join <strong>{businessName}</strong>
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-100 px-4 py-3 text-sm text-red-600 dark:text-red-400 font-medium">
            {error}
          </div>
        )}

        {/* Setup form */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-elevated p-6 border border-gray-100 dark:border-gray-800">
          <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">Setting up account for</p>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{invite?.name}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">{invite?.email}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Create Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              autoComplete="new-password"
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              autoComplete="new-password"
            />
            <Button type="submit" disabled={saving} className="w-full min-h-[48px]">
              {saving ? 'Setting up...' : 'Get Started'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
