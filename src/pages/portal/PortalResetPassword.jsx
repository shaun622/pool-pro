import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { supabase } from '../../lib/supabase'

// Customers land here from the password-reset email. supabase-js parses the
// recovery token from the URL fragment automatically and fires PASSWORD_RECOVERY;
// once that session exists, updateUser({ password }) sets the new password. On
// success the recovery session is already valid, so we send them straight into
// the portal. Mirrors the admin ResetPassword page.
export default function PortalResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setRecoveryReady(true)
    })
    // If the recovery event already fired before this listener attached (e.g. a
    // reload), a session will already exist — allow the update anyway.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setRecoveryReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
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
      // The recovery session is valid — take them straight into the portal.
      setTimeout(() => navigate('/portal', { replace: true }), 1500)
    } catch (err) {
      setError(err.message || 'Could not update your password. The reset link may have expired — please request a new one.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pool-50 via-white to-pool-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
          <p className="text-sm text-gray-400 mt-1">Choose a new password for your portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-elevated p-6 border border-gray-100">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-11 h-11 text-emerald-500 mx-auto mb-3" strokeWidth={2} />
              <p className="text-sm font-semibold text-gray-900">Password updated</p>
              <p className="text-xs text-gray-500 mt-1">Taking you to your portal…</p>
            </div>
          ) : !recoveryReady ? (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-500">Verifying your reset link…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600 font-medium">
                  {error}
                </div>
              )}
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 10 characters"
                autoComplete="new-password"
                required
              />
              <Input
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter the password"
                autoComplete="new-password"
                required
              />
              <Button type="submit" loading={saving} className="w-full min-h-[48px]">
                Update password
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          <Link to="/portal/login" className="hover:text-pool-600 transition-colors">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
