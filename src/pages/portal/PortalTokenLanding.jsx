import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function PortalTokenLanding() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState(null)

  useEffect(() => {
    checkToken()
  }, [token])

  async function checkToken() {
    try {
      // Check if user is already signed in with a linked client
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id')
          .eq('auth_user_id', user.id)
          .limit(1)

        if (clients?.length) {
          navigate('/portal', { replace: true })
          return
        }
      }

      // Validate the token
      const { data, error } = await supabase.functions.invoke('portal-auth', {
        body: { action: 'validate-token', token },
      })

      if (error || data?.error) {
        setError('This portal link is invalid or has expired.')
        return
      }

      if (data.has_account) {
        navigate('/portal/login', { replace: true })
      } else {
        navigate(`/portal/setup/${token}`, { replace: true })
      }
    } catch (err) {
      setError('Something went wrong.')
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-4">:(</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Portal Not Found</h2>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-10 w-10 border-4 border-pool-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Loading your portal...</p>
      </div>
    </div>
  )
}
