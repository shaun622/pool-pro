import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { supabase } from '../lib/supabase'

// Lands here from the password-reset email link. Supabase parses the
// recovery token from the URL fragment automatically and fires a
// PASSWORD_RECOVERY auth event; once that happens, calling
// supabase.auth.updateUser({ password }) sets a new password for the
// recovered user.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    // Detect that we arrived via a recovery link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setRecoveryReady(true)
      }
    })

    // If the page was reloaded after the recovery event already fired,
    // a session will already exist — we can still allow the update.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setRecoveryReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      // Bounce them to login after a moment so they sign in with the new password
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err.message || 'Failed to update password. The reset link may have expired — please request a new one.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pool-50 via-white to-pool-100 dark:from-gray-950 dark:via-gray-900 dark:to-pool-950/40 px-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Set a new password</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Choose a new password for your PoolMate account.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-elevated p-6 border border-gray-100 dark:border-gray-800">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" strokeWidth={2} />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Password updated</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Redirecting to login…</p>
            </div>
          ) : !recoveryReady ? (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Verifying reset link…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-800/40 px-3 py-2 text-xs text-red-600 dark:text-red-400 font-medium">
                  {error}
                </div>
              )}
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                required
              />
              <Input
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat the password"
                autoComplete="new-password"
                required
              />
              <Button type="submit" loading={saving} className="w-full min-h-[44px]">
                Update password
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          <button onClick={() => navigate('/login')} className="hover:text-pool-600 dark:hover:text-pool-400 transition-colors">
            Back to login
          </button>
        </p>
      </div>
    </div>
  )
}
