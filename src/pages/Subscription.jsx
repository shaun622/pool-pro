import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { useBusiness } from '../hooks/useBusiness'
import { cn } from '../lib/utils'

const PLANS = [
  {
    id: 'trial',
    name: 'Trial',
    price: null,
    priceLabel: 'Free',
    period: '14 days',
    features: {
      pools: '5 pools',
      staff: '1 staff member',
      serviceHistory: '30 days',
      chemistryLog: true,
      routeSheet: true,
      clientPortal: true,
      quotesPdf: false,
      photoAttachments: false,
      inventoryTracking: false,
      customBranding: false,
      prioritySupport: false,
    },
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 9,
    priceLabel: '$9',
    period: '/mo',
    features: {
      pools: 'Unlimited',
      staff: '2 staff members',
      serviceHistory: 'Unlimited',
      chemistryLog: true,
      routeSheet: true,
      clientPortal: true,
      quotesPdf: true,
      photoAttachments: true,
      inventoryTracking: false,
      customBranding: false,
      prioritySupport: false,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19,
    priceLabel: '$19',
    period: '/mo',
    features: {
      pools: 'Unlimited',
      staff: '10 staff members',
      serviceHistory: 'Unlimited',
      chemistryLog: true,
      routeSheet: true,
      clientPortal: true,
      quotesPdf: true,
      photoAttachments: true,
      inventoryTracking: true,
      customBranding: true,
      prioritySupport: true,
    },
  },
]

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
    return <span className="text-sm text-gray-700 font-medium">{enabled}</span>
  }
  return enabled ? (
    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export default function Subscription() {
  const { business, loading: bizLoading } = useBusiness()
  const navigate = useNavigate()
  const [subscribing, setSubscribing] = useState(null)

  const currentPlan = business?.plan || 'trial'

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
      alert(`Stripe integration required. Would subscribe to ${planId} plan.`)
    }, 1000)
  }

  if (bizLoading) {
    return (
      <>
        <Header title="Subscription" backTo="/settings" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title="Subscription" backTo="/settings" />
      <PageWrapper>
        <div className="space-y-5">
          {/* Trial countdown */}
          {trialDaysLeft !== null && (
            <Card className={cn('p-4 text-center', trialDaysLeft <= 3 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
              <p className={cn('text-sm font-medium', trialDaysLeft <= 3 ? 'text-red-700' : 'text-amber-700')}>
                {trialDaysLeft === 0
                  ? 'Your trial has expired'
                  : `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} left in your trial`}
              </p>
            </Card>
          )}

          {/* Plan cards */}
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id
            return (
              <Card
                key={plan.id}
                className={cn(
                  'p-4',
                  isCurrent && 'border-pool-500 border-2 ring-1 ring-pool-200'
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                    <p className="text-gray-500 text-sm">
                      <span className="text-2xl font-bold text-gray-900">{plan.priceLabel}</span>
                      {plan.period && <span className="text-gray-400">{plan.period}</span>}
                    </p>
                  </div>
                  {isCurrent && (
                    <Badge variant="primary">Current</Badge>
                  )}
                </div>

                {/* Feature list */}
                <div className="space-y-2.5 mb-4">
                  {Object.entries(plan.features).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{FEATURE_LABELS[key]}</span>
                      <FeatureCheck enabled={value} />
                    </div>
                  ))}
                </div>

                {/* Action */}
                {isCurrent ? (
                  <div className="text-center py-2">
                    <p className="text-sm text-pool-600 font-medium">Your current plan</p>
                  </div>
                ) : plan.id === 'trial' ? null : (
                  <Button
                    variant="primary"
                    className="w-full min-h-tap"
                    onClick={() => handleSubscribe(plan.id)}
                    loading={subscribing === plan.id}
                  >
                    Subscribe to {plan.name}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      </PageWrapper>
    </>
  )
}
