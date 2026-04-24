import { useNavigate } from 'react-router-dom'
import {
  Building2, Mail, Zap, ClipboardList, Beaker, Users as UsersIcon,
  Star, Upload, Plug, CreditCard, ChevronRight, LogOut,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { ThemeToggleFull } from '../components/layout/ThemeToggle'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/utils'

const PLAN_BADGE = {
  trial: 'warning',
  starter: 'primary',
  pro: 'success',
}

// Main grouped sections — single divided card
const SECTIONS = [
  { to: '/settings/business',    label: 'Business details',  description: 'Name, ABN, contact, logo, brand colour',  Icon: Building2,     color: 'pool'    },
  { to: '/settings/staff',       label: 'Staff',             description: 'Team members and roles',                  Icon: UsersIcon,     color: 'violet'  },
  { to: '/settings/job-types',   label: 'Job types',         description: 'Service templates with default tasks',    Icon: ClipboardList, color: 'cyan'    },
  { to: '/settings/chemicals',   label: 'Chemical library',  description: 'Manage your products and dosages',        Icon: Beaker,        color: 'emerald' },
  { to: '/settings/templates',   label: 'Message templates', description: 'Email & SMS templates for automations',   Icon: Mail,          color: 'blue'    },
  { to: '/settings/automations', label: 'Automations',       description: 'Auto-send reminders & follow-ups',        Icon: Zap,           color: 'amber'   },
  { to: '/settings/surveys',     label: 'Survey results',    description: 'Customer feedback & ratings',             Icon: Star,          color: 'pink'    },
  { to: '/settings/import',      label: 'Import data',       description: 'Bulk import clients & pools from CSV',    Icon: Upload,        color: 'indigo'  },
  { to: '/settings/integrations', label: 'Integrations',      description: 'Xero, QuickBooks, Stripe & more',          Icon: Plug,          color: 'teal',   badge: 'Coming Soon' },
]

const COLOR_CLASSES = {
  pool:    'bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400',
  blue:    'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
  amber:   'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  cyan:    'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
  violet:  'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400',
  pink:    'bg-pink-50 dark:bg-pink-950/40 text-pink-600 dark:text-pink-400',
  indigo:  'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400',
  teal:    'bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400',
  red:     'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
}

export default function Settings() {
  const { business, loading: bizLoading } = useBusiness()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login')
    } catch (err) {
      console.error('Error signing out:', err)
    }
  }

  if (bizLoading) {
    return (
      <PageWrapper>
        <PageHero title="Settings" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  const plan = business?.plan || 'trial'

  return (
    <PageWrapper>
      <PageHero
        title="Settings"
        subtitle={user?.email ? `Signed in as ${user.email}` : undefined}
      />

      <div className="space-y-6">
        {/* ── Main grouped sections — single divided card ── */}
        <Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800">
          {SECTIONS.map(s => (
            <button
              key={s.to}
              onClick={() => navigate(s.to)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
            >
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES[s.color])}>
                <s.Icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-100">{s.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.description}</p>
              </div>
              {s.badge ? (
                <Badge variant="default">{s.badge}</Badge>
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
              )}
            </button>
          ))}

          {/* Subscription — non-navigable, shows current plan */}
          <div className="w-full flex items-center gap-3 px-4 py-4 last:rounded-b-2xl">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES.amber)}>
              <CreditCard className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 dark:text-gray-100">Subscription</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Manage your plan</p>
            </div>
            <Badge variant={PLAN_BADGE[plan] || 'default'}>
              {plan.charAt(0).toUpperCase() + plan.slice(1)}
            </Badge>
          </div>
        </Card>

        {/* ── Appearance ─────────────────────────────────────── */}
        <div className="space-y-2">
          <h2 className="section-title">Appearance</h2>
          <Card className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 dark:text-gray-100">Theme</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose light, dark, or match your system
              </p>
            </div>
            <ThemeToggleFull />
          </Card>
        </div>

        {/* ── Sign out — clean secondary button ─────────────── */}
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-card hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-h-tap"
        >
          <LogOut className="w-4 h-4" strokeWidth={2} />
          Sign out
        </button>
      </div>
    </PageWrapper>
  )
}
