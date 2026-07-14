import { useState, useEffect } from 'react'
import { Shield, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { listVerifiedTotp } from '../../lib/mfa'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'

const ACTION_LABELS = {
  'staff.create': 'Staff member added',
  'staff.role_change': 'Staff role changed',
  'staff.activate': 'Staff reactivated',
  'staff.deactivate': 'Staff deactivated',
  'staff.delete': 'Staff member removed',
  'staff.password_set': 'Staff password reset',
  'client.delete': 'Client deleted',
}

/**
 * Security settings — two-factor authentication (TOTP) enrolment & management,
 * plus a read-only view of the business's security audit log.
 * Renders inside the Settings pane <Outlet />, so no PageWrapper/Header here.
 */
export default function Security() {
  const [loading, setLoading] = useState(true)
  const [factor, setFactor] = useState(null)        // the verified factor, if any
  const [enrolling, setEnrolling] = useState(null)   // { factorId, qr, secret } mid-enrolment
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [events, setEvents] = useState([])

  async function refresh() {
    setLoading(true)
    const factors = await listVerifiedTotp()
    setFactor(factors[0] || null)
    setLoading(false)
  }

  async function loadEvents() {
    const { data } = await supabase
      .from('security_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setEvents(data || [])
  }

  useEffect(() => { refresh(); loadEvents() }, [])

  async function startEnrol() {
    setError(''); setNotice(''); setBusy(true)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (error) throw error
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (err) {
      setError(err.message || 'Could not start setup. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnrol(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const { factorId } = enrolling
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
      if (chErr) throw chErr
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() })
      if (vErr) throw vErr
      setEnrolling(null); setCode(''); setNotice('Two-factor authentication is now on.')
      await refresh()
    } catch (err) {
      setError('That code didn’t work. Check your authenticator app and try again.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function cancelEnrol() {
    // Remove the half-finished (unverified) factor so it doesn't pile up.
    if (enrolling?.factorId) {
      try { await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }) } catch { /* ignore */ }
    }
    setEnrolling(null); setCode(''); setError('')
  }

  async function disable() {
    if (!factor) return
    setError(''); setBusy(true)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (error) throw error
      setNotice('Two-factor authentication has been turned off.')
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not turn off two-factor authentication.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 italic">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Two-factor authentication</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password…).
          Strongly recommended for owner and admin accounts.
        </p>
      </div>

      {notice && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm rounded-xl px-4 py-3">
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Enrolled state */}
      {factor && !enrolling && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-4 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Two-factor is on</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">You’ll be asked for a code each time you sign in.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={disable} loading={busy} className="shrink-0">Turn off</Button>
        </div>
      )}

      {/* Not enrolled, not mid-setup */}
      {!factor && !enrolling && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-gray-500 dark:text-gray-400" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Two-factor is off</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Protect your account from stolen passwords.</p>
            </div>
          </div>
          <Button onClick={startEnrol} loading={busy} className="shrink-0">Enable</Button>
        </div>
      )}

      {/* Mid-enrolment: show QR + secret, ask for the first code */}
      {enrolling && (
        <form onSubmit={confirmEnrol} className="rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            1. Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div className="flex flex-col items-center gap-3">
            {enrolling.qr && (
              <img src={enrolling.qr} alt="Two-factor QR code" className="w-44 h-44 rounded-lg bg-white p-2 border border-gray-200" />
            )}
            <div className="text-center">
              <p className="text-xs text-gray-400 dark:text-gray-500">Can’t scan? Enter this key manually:</p>
              <code className="text-xs font-mono break-all text-gray-700 dark:text-gray-300">{enrolling.secret}</code>
            </div>
          </div>
          <Input
            label="6-digit code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            autoFocus
            required
          />
          <div className="flex items-center gap-2">
            <Button type="submit" loading={busy} disabled={code.length < 6} className="flex-1">Verify &amp; turn on</Button>
            <Button type="button" variant="secondary" onClick={cancelEnrol} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}

      {/* Security audit log */}
      <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Recent security activity</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-3">
          Staff role changes, password resets and client deletions across your business.
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">No security events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100">{ACTION_LABELS[ev.action] || ev.action}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {ev.actor_email || 'System'}{ev.metadata?.name ? ` · ${ev.metadata.name}` : ''}
                  </p>
                </div>
                <time className="text-xs text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">
                  {new Date(ev.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
