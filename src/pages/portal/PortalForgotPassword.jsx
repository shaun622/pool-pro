import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { supabase } from '../../lib/supabase'

// Customer "forgot password". Sends a BRANDED reset email (business logo/colour/
// name) via Resend through the portal-reset-password edge function — not Supabase's
// generic built-in template. The link still lands on /portal/reset-password where
// supabase-js exchanges the recovery token and updateUser({ password }) sets the
// new one. We ALWAYS show the same "check your inbox" confirmation regardless of
// whether the email exists, so this can't be used as an account-enumeration oracle
// (the edge function is likewise enumeration-safe — it always returns ok).
export default function PortalForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await supabase.functions.invoke('portal-reset-password', {
        body: {
          email: email.trim(),
          redirectTo: `${window.location.origin}/portal/reset-password`,
        },
      })
    } catch (err) {
      // Swallow — revealing success/failure per email would leak which addresses
      // have accounts. The confirmation below is intentionally the same either way.
      if (import.meta.env.DEV) console.warn('portal-reset-password:', err)
    } finally {
      setLoading(false)
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pool-50 via-white to-pool-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-400 mt-1">We'll email you a secure link to set a new one</p>
        </div>

        <div className="bg-white rounded-2xl shadow-elevated p-6 border border-gray-100">
          {sent ? (
            <div className="text-center py-4">
              <MailCheck className="w-11 h-11 text-emerald-500 mx-auto mb-3" strokeWidth={1.75} />
              <p className="text-sm font-semibold text-gray-900">Check your inbox</p>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                If an account exists for <span className="font-medium text-gray-700">{email.trim()}</span>, we've sent a
                link to reset your password. It expires in a little while, so use it soon.
              </p>
              <Link to="/portal/login" className="inline-block mt-5 text-sm font-medium text-pool-600 hover:text-pool-700">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                required
              />
              <Button type="submit" loading={loading} className="w-full min-h-[48px]">
                Send reset link
              </Button>
              <p className="text-center">
                <Link to="/portal/login" className="text-xs text-gray-400 hover:text-pool-600 transition-colors">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
