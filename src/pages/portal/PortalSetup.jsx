import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { supabase } from '../../lib/supabase'

export default function PortalSetup() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [clientInfo, setClientInfo] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    validateToken()
  }, [token])

  async function validateToken() {
    try {
      const { data, error } = await supabase.functions.invoke('portal-auth', {
        body: { action: 'validate-token', token },
      })
      if (error) throw error
      if (data.error) throw new Error(data.error)

      if (data.has_account) {
        // Already has account, redirect to login
        navigate('/portal/login', { replace: true })
        return
      }
      setClientInfo(data)
    } catch (err) {
      setError(err.message || 'Invalid portal link')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('portal-auth', {
        body: { action: 'create-account', token, password },
      })
      if (error) throw error
      if (data.error) throw new Error(data.error)

      // Sign in with the new credentials
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      })
      if (signInError) throw signInError

      navigate('/portal', { replace: true })
    } catch (err) {
      setError(err.message || 'Failed to create account')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-10 w-10 border-4 border-pool-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Verifying your link...</p>
        </div>
      </div>
    )
  }

  if (error && !clientInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-sm w-full text-center py-12">
          <div className="text-5xl mb-4">:(</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Link</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <Button variant="secondary" onClick={() => navigate('/portal/login')}>
            Go to Login
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set Up Your Account</h1>
          <p className="text-sm text-gray-500 mt-1">
            Hi {clientInfo?.client_name}, create a password to access your portal
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm font-medium text-gray-900">{clientInfo?.client_email}</p>
            </div>
            <Input
              label="Create Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
            />
            <Button type="submit" loading={submitting} className="w-full min-h-[48px] bg-green-600 hover:bg-green-700">
              Create Account
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
