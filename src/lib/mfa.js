import { supabase } from './supabase'

// Thin wrappers around supabase.auth.mfa so the UI doesn't repeat the shapes.
// Everything here fails soft (returns a safe default on error) — MFA must never
// be able to lock a user out because of a transient API hiccup.

export async function getAAL() {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error) return { currentLevel: null, nextLevel: null }
    return data
  } catch {
    return { currentLevel: null, nextLevel: null }
  }
}

// Verified TOTP factors only (an unfinished enrolment is status:'unverified').
export async function listVerifiedTotp() {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return []
    return (data?.totp || []).filter((f) => f.status === 'verified')
  } catch {
    return []
  }
}

export async function hasVerifiedMfa() {
  return (await listVerifiedTotp()).length > 0
}

// Run the challenge→verify step-up against the caller's verified factor.
export async function verifyTotpCode(code) {
  const factors = await listVerifiedTotp()
  const factorId = factors[0]?.id
  if (!factorId) throw new Error('No authenticator is set up on this account.')
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
  if (chErr) throw chErr
  const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code })
  if (vErr) throw vErr
  return true
}
