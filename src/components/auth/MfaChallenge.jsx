import { useState } from 'react'
import { verifyTotpCode } from '../../lib/mfa'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Input from '../ui/Input'

/**
 * Step-up screen shown when a signed-in user holds a verified TOTP factor but
 * their session is still AAL1. Blocks the app until they enter a valid code.
 * `onVerified` is called once the session reaches AAL2.
 */
export default function MfaChallenge({ onVerified }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verifyTotpCode(code.trim())
      onVerified?.()
    } catch (err) {
      setError('That code didn’t work. Check your authenticator app and try again.')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pool-50 via-white to-pool-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Two-factor authentication</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Enter the 6-digit code from your authenticator app.</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-elevated p-6 border border-gray-100 dark:border-gray-800">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium rounded-xl px-4 py-3">
                {error}
              </div>
            )}
            <Input
              label="Authentication code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              autoFocus
              required
            />
            <Button type="submit" loading={loading} disabled={code.length < 6} className="w-full min-h-[48px]">
              Verify
            </Button>
          </form>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full text-center text-xs text-gray-400 dark:text-gray-500 mt-5 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
