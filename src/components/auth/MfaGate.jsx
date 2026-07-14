import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getAAL } from '../../lib/mfa'
import MfaChallenge from './MfaChallenge'

/**
 * Wraps the authenticated app. If the signed-in user has a verified TOTP factor
 * but the session is still AAL1, force the step-up challenge before anything
 * renders. Users WITHOUT a factor are unaffected (nextLevel stays 'aal1'), and
 * any API error fails OPEN so MFA can never lock someone out.
 */
export default function MfaGate({ children }) {
  const [status, setStatus] = useState('checking') // checking | ok | challenge

  async function check() {
    const { currentLevel, nextLevel } = await getAAL()
    if (nextLevel === 'aal2' && currentLevel === 'aal1') setStatus('challenge')
    else setStatus('ok')
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
