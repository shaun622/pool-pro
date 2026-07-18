import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getAAL, hasVerifiedMfa } from '../../lib/mfa'
import MfaChallenge from './MfaChallenge'

/**
 * Wraps the authenticated app. If the signed-in user has a verified TOTP factor
 * but the session is still AAL1, force the step-up challenge before anything
 * renders. Users WITHOUT a factor are unaffected. On an inconclusive AAL check we
 * now fail CLOSED only when a verified factor is CONFIRMED (audit #5) — a non-MFA
 * user is never locked out by a transient error.
 *
 * NOTE: this is a UX / defence-in-depth gate; being client-side it is bypassable
 * via a direct API call. Real enforcement needs AAL2 in RLS (#5 Part B — not shipped;
 * requires an MFA-enrolled account to test the lockout boundary safely).
 */
export default function MfaGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | ok | challenge

  async function check() {
    const { currentLevel, nextLevel } = await getAAL()
    if (nextLevel === 'aal2' && currentLevel === 'aal1') { setStatus('challenge'); return }
    if (currentLevel === 'aal2') { setStatus('ok'); return }
    // AAL was inconclusive (null → API error). Fail CLOSED only if we can CONFIRM a
    // verified factor exists (audit #5); otherwise fail open so a transient hiccup
    // never locks out a user who has no MFA.
    if (currentLevel == null && nextLevel == null) {
      setStatus((await hasVerifiedMfa()) ? 'challenge' : 'ok')
      return
    }
    setStatus('ok')
  }

  useEffect(() => {
    check()
    // Re-evaluate if the session changes (sign-in, token refresh, sign-out).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check())
    return () => subscription.unsubscribe()
  }, [])

  if (status === 'checking') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pool-500" />
      </div>
    )
  }
  if (status === 'challenge') return <MfaChallenge onVerified={() => setStatus('ok')} />
  return children
}
