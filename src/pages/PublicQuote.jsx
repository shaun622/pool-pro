import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { formatDate, formatCurrency } from '../lib/utils'

function StatusBanner({ status }) {
  const config = {
    accepted: {
      bg: 'bg-green-50 border-green-200',
      text: 'text-green-800',
      label: 'Quote Accepted',
      message: 'You have accepted this quote. We will be in touch to arrange the work.',
    },
    declined: {
      bg: 'bg-red-50 border-red-200',
      text: 'text-red-800',
      label: 'Quote Declined',
      message: 'You have declined this quote. Please contact us if you change your mind.',
    },
  }

  const c = config[status]
  if (!c) return null

  return (
    <div className={`rounded-xl border-2 p-6 text-center ${c.bg}`}>
      <div className={`text-2xl font-bold mb-2 ${c.text}`}>{c.label}</div>
      <p className={`text-sm ${c.text} opacity-80`}>{c.message}</p>
    </div>
  )
}

export default function PublicQuote() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [quote, setQuote] = useState(null)
  const [business, setBusiness] = useState(null)
  const [client, setClient] = useState(null)
  const [responded, setResponded] = useState(false)

  useEffect(() => {
    if (!token) return
    fetchQuote()
  }, [token])

  async function fetchQuote() {
    try {
      setLoading(true)
      setError(null)

      const { data: quoteData, error: quoteError } = await supabase
        .from('quotes')
        .select('*, client:clients(*)')
        .eq('public_token', token)
        .single()

      if (quoteError || !quoteData) {
        setError('This quote link is invalid or has expired.')
        setLoading(false)
        return
      }

      setQuote(quoteData)
      setClient(quoteData.client)

      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', quoteData.business_id)
        .single()

      setBusiness(bizData)
    } catch (err) {
      setError('Something went wrong loading the quote.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResponse(newStatus) {
    try {
      setSubmitting(true)

      const { error: updateError } = await supabase
        .from('quotes')
        .update({
          status: newStatus,
          responded_at: new Date().toISOString(),
        })
        .eq('id', quote.id)

      if (updateError) throw updateError

      setQuote(prev => ({ ...prev, status: newStatus }))
      setResponded(true)
    } catch (err) {
      setError('Failed to submit response. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Loading quote...</p>
        </div>
      </div>
    )
  }

  if (error && !quote) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center py-12">
          <div className="text-4xl mb-4">:(</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Quote Not Found</h2>
          <p className="text-gray-500">{error}</p>
        </Card>
      </div>
    )
  }

  const brandColor = business?.brand_colour || '#2563eb'
  const lineItems = quote?.line_items || []
  const subtotal = lineItems.reduce((sum, item) => sum + (item.amount || item.quantity * item.unit_price || 0), 0)
  const gst = Math.round(subtotal * 0.1 * 100) / 100
  const total = subtotal + gst
  const alreadyResponded = quote?.status === 'accepted' || quote?.status === 'declined'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Branded Header */}
      <header
        className="w-full py-6 px-4"
        style={{ backgroundColor: brandColor }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          {business?.logo_url && (
            <img
              src={business.logo_url}
              alt={business.name}
              className="h-12 w-12 rounded-lg object-cover bg-white/20"
            />
          )}
          <div className="text-white">
            <h1 className="text-xl font-bold">{business?.name || 'Pool Service'}</h1>
            <p className="text-sm opacity-80">Quote</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full px-4 py-6 flex-1">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Status Banner (if already responded or just responded) */}
        {(alreadyResponded || responded) && (
          <div className="mb-6">
            <StatusBanner status={quote.status} />
          </div>
        )}

        {/* Quote Details Card */}
        <Card className="mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Quote #{quote?.quote_number || quote?.id?.slice(0, 8)}
              </h2>
              <p className="text-sm text-gray-500">
                Date: {formatDate(quote?.created_at)}
              </p>
              {quote?.valid_until && (
                <p className="text-sm text-gray-500">
                  Valid until: {formatDate(quote.valid_until)}
                </p>
              )}
            </div>
            <Badge
              variant={
                quote?.status === 'accepted' ? 'success'
                : quote?.status === 'declined' ? 'danger'
                : quote?.status === 'sent' ? 'primary'
                : 'default'
              }
            >
              {quote?.status}
            </Badge>
          </div>

          {/* Client Info */}
          <div className="border-t pt-3 mb-4">
            <p className="text-sm text-gray-500 mb-0.5">Prepared for</p>
            <p className="font-medium text-gray-900">
              {client?.first_name} {client?.last_name}
            </p>
            {client?.email && (
              <p className="text-sm text-gray-500">{client.email}</p>
            )}
            {client?.phone && (
              <p className="text-sm text-gray-500">{client.phone}</p>
            )}
          </div>

          {/* Scope / Description */}
          {quote?.scope && (
            <div className="border-t pt-3 mb-4">
              <p className="text-sm font-medium text-gray-700 mb-1">Scope of Work</p>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{quote.scope}</p>
            </div>
          )}
        </Card>

        {/* Line Items */}
        <Card className="mb-4">
          <h3 className="font-semibold text-gray-900 mb-3">Items</h3>
          <div className="divide-y">
            {lineItems.map((item, idx) => {
              const itemTotal = item.amount || (item.quantity * item.unit_price) || 0
              return (
                <div key={idx} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 pr-4">
                      <p className="font-medium text-gray-900 text-sm">{item.description || item.name}</p>
                      {item.details && (
                        <p className="text-xs text-gray-500 mt-0.5">{item.details}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {item.quantity && item.unit_price ? (
                        <>
                          <p className="text-sm font-medium text-gray-900">{formatCurrency(itemTotal)}</p>
                          <p className="text-xs text-gray-400">
                            {item.quantity} x {formatCurrency(item.unit_price)}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-medium text-gray-900">{formatCurrency(itemTotal)}</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Totals */}
          <div className="border-t mt-3 pt-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="text-gray-900">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">GST (10%)</span>
              <span className="text-gray-900">{formatCurrency(gst)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span className="text-gray-900">Total</span>
              <span style={{ color: brandColor }}>{formatCurrency(total)}</span>
            </div>
          </div>
        </Card>

        {/* Terms */}
        {quote?.terms && (
          <Card className="mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Terms & Conditions</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{quote.terms}</p>
          </Card>
        )}

        {/* Accept / Decline Buttons */}
        {!alreadyResponded && !responded && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Button
              variant="danger"
              className="py-4 text-base font-semibold rounded-xl"
              onClick={() => handleResponse('declined')}
              loading={submitting}
              disabled={submitting}
            >
              Decline Quote
            </Button>
            <button
              className="py-4 text-base font-semibold rounded-xl text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#16a34a' }}
              onClick={() => handleResponse('accepted')}
              disabled={submitting}
              onMouseOver={e => (e.currentTarget.style.backgroundColor = '#15803d')}
              onMouseOut={e => (e.currentTarget.style.backgroundColor = '#16a34a')}
            >
              {submitting ? (
                <svg className="animate-spin h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                'Accept Quote'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="w-full border-t bg-white py-6 px-4 mt-auto">
        <div className="max-w-2xl mx-auto text-center text-sm text-gray-500 space-y-1">
          <p className="font-medium text-gray-700">{business?.name}</p>
          {business?.phone && <p>Phone: {business.phone}</p>}
          {business?.email && <p>Email: {business.email}</p>}
          {business?.address && <p>{business.address}</p>}
          {business?.abn && <p>ABN: {business.abn}</p>}
          <p className="pt-2 text-xs text-gray-400">
            Powered by PoolPro
          </p>
        </div>
      </footer>
    </div>
  )
}
