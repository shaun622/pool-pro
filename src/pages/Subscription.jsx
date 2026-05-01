import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, UserPlus } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useBusiness } from '../hooks/useBusiness'
import { usePlans } from '../hooks/usePlans'
import { cn } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'

// Plans now come from the DB-backed `plans` table, edited from
// FieldSuite HQ. The shape we render expects:
//   { slug, name, price_cents, period, max_staff, features (jsonb), sort_order, is_active }
// We adapt to the existing display props (priceLabel, period suffix)
// at render time so this page didn't need a wholesale rewrite.

// Format price_cents → "Free" / "$9" / "$19" — matches the prior
// hardcoded `priceLabel` field. Period 'month' renders as "/mo",
// '14 days' as "14 days", year as "/yr".
function formatPriceLabel(price_cents) {
  if (!price_cents || price_cents === 0) return 'Free'
  const dollars = price_cents / 100
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function formatPeriod(period) {
  if (!period) return ''
  if (period === 'month') return '/mo'
  if (period === 'year') return '/yr'
  if (period === 'once') return ''
  // '14 days' or any custom string passes through verbatim
  return period
}

const FEATURE_LABELS = {
  pools: 'Pools',
  staff: 'Staff Members',
  serviceHistory: 'Service History',
  chemistryLog: 'Chemistry Log',
  routeSheet: 'Route Sheet',
  clientPortal: 'Client Portal',
  quotesPdf: 'Quotes & PDF',
  photoAttachments: 'Photo Attachments',
  inventoryTracking: 'Inventory Tracking',
  customBranding: 'Custom Branding',
  prioritySupport: 'Priority Support',
}

function FeatureCheck({ enabled }) {
  if (typeof enabled === 'string') {
    return <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{enabled}</span>
  }
  return enabled ? (
    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export default function Subscription() {
  const toast = useToast()
  const { business, staffLimit, loading: bizLoading, refetch } = useBusiness()
  const { plans, plansBySlug, loading: plansLoading } = usePlans()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [subscribing, setSubscribing] = useState(null)
  const [addingSeat, setAddingSeat] = useState(false)

  const currentPlan = business?.plan || 'trial'

  // Handle the redirect-back from Stripe Checkout. Stripe doesn't fire
  // the webhook synchronously with the success redirect, so the seat
  // count may take a moment to update — toast and refetch a few times
  // to catch it without forcing a hard reload.
  useEffect(() => {
    const seatAdded = searchParams.get('seat_added')
    if (!seatAdded) return
    if (seatAdded === '1') {
      toast.success('Seat purchased', { description: 'Stripe is processing payment. Your new seat will be available in a moment.' })
      // Webhook lands within a few seconds. Refetch a couple of times.
      refetch?.()
      const t1 = setTimeout(() => refetch?.(), 3000)
      const t2 = setTimeout(() => refetch?.(), 8000)
      // Clean the query string so a refresh doesn't re-toast
      const next = new URLSearchParams(searchParams)
      next.delete('seat_added')
      setSearchParams(next, { replace: true })
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    if (seatAdded === '0') {
      toast.info('Checkout cancelled')
      const next = new URLSearchParams(searchParams)
      next.delete('seat_added')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('seat_added')])

  // "Add technician seat ($3/mo)" — bills immediately via Stripe.
  // First click: redirect to Stripe Checkout to collect card.
  // Subsequent clicks: bumps subscription quantity, prorated.
  async function handleAddSeat() {
    setAddingSeat(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error('Not signed in')
        return
      }
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not start checkout')
        return
      }
      if (body.mode === 'checkout' && body.url) {
        // First-time: hand off to Stripe Checkout
        window.location.href = body.url
        return
      }
      if (body.mode === 'increment') {
        // Subsequent: subscription updated server-side, webhook will
        // bump purchased_seats. Toast + refetch to pick it up.
        toast.success('Seat added', { description: 'Stripe is processing the prorated charge. Your new seat will be available shortly.' })
        refetch?.()
        setTimeout(() => refetch?.(), 3000)
        return
      }
      toast.info('Checkout returned an unexpected response')
    } catch (err) {
      toast.error('Could not add seat', { description: err?.message || String(err) })
    } finally {
      setAddingSeat(false)
    }
  }

  // Effective seat count breakdown for display: how many came from the
  // plan vs how many extra the customer has purchased.
  const planMax = plansBySlug?.[currentPlan]?.max_staff ?? 0
  const purchasedSeats = business?.purchased_seats || 0
  const overrideActive = business?.staff_seat_override != null

  // Customer only sees active plans, ordered by sort_order.
  const activePlans = (plans || []).filter(p => p.is_active)

  // Calculate trial days remaining
  const trialDaysLeft = (() => {
    if (currentPlan !== 'trial' || !business?.created_at) return null
    const created = new Date(business.created_at)
    const trialEnd = new Date(created)
    trialEnd.setDate(trialEnd.getDate() + 14)
    const now = new Date()
    const diff = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)))
    return diff
  })()

  async function handleSubscribe(planId) {
    setSubscribing(planId)
    // Placeholder for Stripe integration
    setTimeout(() => {
      setSubscribing(null)
      toast.info(`Stripe integration required. Would subscribe to ${planId} plan.`)
    }, 1000)
  }

  if (bizLoading || plansLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-5">
          {/* Trial countdown */}
          {trialDaysLeft !== null && (
            <Card className={cn('p-4 text-center', trialDaysLeft <= 3 ? 'border-red-200 bg-red-50 dark:bg-red-950/40' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/40')}>
              <p className={cn('text-sm font-medium', trialDaysLeft <= 3 ? 'text-red-700' : 'text-amber-700')}>
                {trialDaysLeft === 0
                  ? 'Your trial has expired'
                  : `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in your trial`}
              </p>
            </Card>
          )}

          {/* Plan cards */}
          {activePlans.map((plan) => {
            const isCurrent = currentPlan === plan.slug
            const priceLabel = formatPriceLabel(plan.price_cents)
            const periodLabel = formatPeriod(plan.period)
            return (
              <Card
                key={plan.slug}
                className={cn(
                  'p-4',
                  isCurrent && 'border-pool-500 border-2 ring-1 ring-pool-200'
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{plan.name}</h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                      <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{priceLabel}</span>
                      {periodLabel && <span className="text-gray-400 dark:text-gray-500">{periodLabel}</span>}
                    </p>
                  </div>
                  {isCurrent && (
                    <Badge variant="primary">Current</Badge>
                  )}
                </div>

                {/* Feature list — features is a JSONB blob with the same shape as before */}
                <div className="space-y-2.5 mb-4">
                  {Object.entries(plan.features || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{FEATURE_LABELS[key] || key}</span>
                      <FeatureCheck enabled={value} />
                    </div>
                  ))}
                </div>

                {/* Action */}
                {isCurrent ? (
                  <div className="text-center py-2">
                    <p className="text-sm text-pool-600 dark:text-pool-400 font-medium">Your current plan</p>
                  </div>
                ) : plan.slug === 'trial' ? null : (
                  <Button
                    variant="primary"
                    className="w-full min-h-tap"
                    onClick={() => handleSubscribe(plan.slug)}
                    loading={subscribing === plan.slug}
                  >
                    Subscribe to {plan.name}
                  </Button>
                )}
              </Card>
            )
          })}

          {/* ── ADD TECHNICIAN SEAT ── */}
          {/* Hidden on trial (need a paid plan first to bolt seats on)
              and when an operator override is active (the per-business
              override wins, so buying extras would be dead money). */}
          {currentPlan !== 'trial' && !overrideActive && (
            <Card className="p-4 border-dashed">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
                  <UserPlus className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Need an extra technician?</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Add a seat for <span className="font-semibold text-gray-700 dark:text-gray-300">$3 / month</span> (billed immediately, prorated to the rest of your billing period).
                  </p>
                </div>
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 px-1 tabular-nums">
                Currently using <span className="font-semibold text-gray-900 dark:text-gray-100">{staffLimit}</span> {staffLimit === 1 ? 'seat' : 'seats'}
                {purchasedSeats > 0 && (
                  <> — <span className="text-pool-600 dark:text-pool-400 font-semibold">{purchasedSeats}</span> purchased on top of your {currentPlan} plan ({planMax}).</>
                )}
                {purchasedSeats === 0 && planMax > 0 && (
                  <> from your {currentPlan} plan.</>
                )}
              </div>

              <Button
                variant="secondary"
                className="w-full min-h-tap"
                leftIcon={Plus}
                onClick={handleAddSeat}
                loading={addingSeat}
              >
                Add technician seat — $3/mo
              </Button>
            </Card>
          )}
      </div>
    </div>
  )
}
