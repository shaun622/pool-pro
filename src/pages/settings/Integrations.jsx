import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'

const INTEGRATIONS = [
  {
    name: 'Xero',
    description: 'Sync invoices and contacts with Xero accounting',
    logo: 'https://logo.clearbit.com/xero.com',
    status: 'coming_soon',
  },
  {
    name: 'QuickBooks',
    description: 'Export invoices and expenses to QuickBooks',
    logo: 'https://logo.clearbit.com/quickbooks.intuit.com',
    status: 'coming_soon',
  },
  {
    name: 'MYOB',
    description: 'Connect with MYOB for Australian accounting',
    logo: 'https://logo.clearbit.com/myob.com',
    status: 'coming_soon',
  },
  {
    name: 'Stripe',
    description: 'Accept online payments from customers',
    logo: 'https://logo.clearbit.com/stripe.com',
    status: 'coming_soon',
  },
  {
    name: 'Twilio',
    description: 'Send SMS reminders and notifications',
    logo: 'https://logo.clearbit.com/twilio.com',
    status: 'coming_soon',
  },
  {
    name: 'Google Maps',
    description: 'Route optimization and address geocoding',
    logo: 'https://logo.clearbit.com/maps.google.com',
    status: 'coming_soon',
  },
  {
    name: 'Zapier',
    description: 'Connect PoolPro with 5000+ other apps',
    logo: 'https://logo.clearbit.com/zapier.com',
    status: 'coming_soon',
  },
]

export default function Integrations() {
  return (
    <>
      <Header title="Integrations" backTo="/settings" />
      <PageWrapper>
        <div className="mb-5">
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            Connect PoolPro with your favourite tools to streamline your workflow.
          </p>
        </div>

        <div className="space-y-2.5">
          {INTEGRATIONS.map(integration => (
            <Card key={integration.name}>
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={integration.logo}
                    alt={integration.name}
                    className="w-6 h-6 object-contain"
                    onError={e => { e.target.style.display = 'none' }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{integration.name}</h3>
                    <Badge variant="default">Coming Soon</Badge>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{integration.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Want an integration we don't have? Let us know at{' '}
            <a href="mailto:info@poolmateapp.online" className="text-pool-600 dark:text-pool-400">info@poolmateapp.online</a>
          </p>
        </div>
      </PageWrapper>
    </>
  )
}
