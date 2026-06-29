import { Suspense } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Building2, Users, Beaker, Briefcase, Mail, Zap, Star,
  Plug, Upload, CreditCard, LogOut, ChevronRight, BarChart3,
  ClipboardList, Settings as SettingsIcon,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import Header from '../components/layout/Header'
import PageHero from '../components/layout/PageHero'
import { ThemeToggleFull } from '../components/layout/ThemeToggle'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/utils'

/**
 * Settings — sidebar + pane shell. Each sidebar item routes to a child path
 * but the layout (sidebar + chrome) stays mounted; only the right pane swaps.
 *
 * Routes (configured in App.jsx):
 *   /settings              → BusinessDetails (index)
 *   /settings/staff        → Staff
 *   /settings/chemicals    → ChemicalLibrary
 *   /settings/templates    → CommunicationTemplates
 *   /settings/job-types    → JobTypeTemplates
 *   /settings/automations  → Automations
 *   /settings/surveys      → SurveyResults
 *   /settings/integrations → Integrations
 *   /settings/import       → ImportData
 *   /settings/billing      → Subscription
 *
 * Sub-pages must NOT render their own PageWrapper or Header — they render
 * INSIDE the right-pane card here.
 */

const SIDEBAR = [
  { to: '/settings',                label: 'Business details', Icon: Building2,    end: true },
  { to: '/settings/analytics',      label: 'Analytics',        Icon: BarChart3 },
  { to: '/settings/reports',        label: 'Technician report', Icon: ClipboardList },
  { to: '/settings/staff',          label: 'Team & roles',     Icon: Users },
  { to: '/settings/chemicals',      label: 'Chemical library', Icon: Beaker },
  { to: '/settings/job-types',      label: 'Job types',        Icon: Briefcase },
  { to: '/settings/templates',      label: 'Templates',        Icon: Mail },
  { to: '/settings/automations',    label: 'Automations',      Icon: Zap },
  { to: '/settings/surveys',        label: 'Survey results',   Icon: Star },
  { to: '/settings/integrations',   label: 'Integrations',     Icon: Plug },
  { to: '/settings/import',         label: 'Import data',      Icon: Upload },
  { to: '/settings/billing',        label: 'Billing',          Icon: CreditCard },
]

// Mobile row-link card colors (icon-box tint per row)
const MOBILE_ROW_COLORS = {
  'Business details': 'pool',
  Analytics:          'violet',
  'Technician report': 'teal',
  'Team & roles':     'blue',
  'Chemical library': 'emerald',
  'Job types':        'cyan',
  Templates:          'blue',
  Automations:        'amber',
  'Survey results':   'pink',
  Integrations:       'teal',
  'Import data':      'indigo',
  Billing:            'amber',
}

const COLOR_CLASSES = {
  pool:    'bg-pool-50 text-pool-600 dark:bg-pool-950/40 dark:text-pool-400',
  blue:    'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400',
  amber:   'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
  cyan:    'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
  violet:  'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
  pink:    'bg-pink-50 text-pink-600 dark:bg-pink-950/40 dark:text-pink-400',
  teal:    'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400',
  indigo:  'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400',
  gray:    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
}

const PLAN_BADGE = { trial: 'warning', starter: 'primary', pro: 'success' }

export default function Settings() {
  const { business, loading: bizLoading } = useBusiness()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
      <PageWrapper width="wide">
        <PageHero title="Settings" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  const plan = business?.plan || 'trial'

  // Find the active sidebar item — match longest prefix so nested routes work.
  const activeItem = [...SIDEBAR].reverse().find(s =>
    s.end ? location.pathname === s.to : location.pathname.startsWith(s.to)
  ) || SIDEBAR[0]

  const onSettingsRoot = location.pathname === '/settings'

  return (
    <PageWrapper width="wide">
      {/* MOBILE ── per-page header (back-button when on a sub-route) */}
      <div className="md:hidden">
        <Header
          title={onSettingsRoot ? 'Settings' : activeItem.label}
          backTo={onSettingsRoot ? undefined : '/settings'}
        />
      </div>

      {/* DESKTOP ── eyebrow PageHero */}
      <div className="hidden md:block mb-5">
        <PageHero
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <SettingsIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
              Settings
            </span>
          }
          title={activeItem.label}
          subtitle={user?.email ? `Signed in as ${user.email}` : undefined}
        />
      </div>

      {/* MOBILE: when on a sub-route, render the Outlet directly. */}
      {!onSettingsRoot && (
        <div className="md:hidden">
          <Suspense fallback={<div className="text-sm text-gray-500 dark:text-gray-400 italic">Loading…</div>}>
            <Outlet />
          </Suspense>
        </div>
      )}

      {/* MOBILE: row-link card list — only on /settings root */}
      <div className={cn('md:hidden space-y-4', !onSettingsRoot && 'hidden')}>
        {/* Business identity card */}
        <Card className="!p-5 flex items-center gap-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-brand-soft opacity-50 dark:opacity-20" />
          <div className="relative shrink-0">
            {business?.logo_url ? (
              <img src={business.logo_url} alt="" className="w-14 h-14 rounded-2xl object-cover ring-2 ring-white dark:ring-gray-800 shadow-sm" />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-gradient-brand flex items-center justify-center text-white text-xl font-bold shadow-card">
                {business?.name?.charAt(0)}
              </div>
            )}
          </div>
          <div className="relative min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base truncate">{business?.name}</h2>
            {business?.email && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{business.email}</p>}
            {plan && (
              <div className="mt-1.5">
                <Badge variant={PLAN_BADGE[plan] || 'neutral'}>
                  {plan.charAt(0).toUpperCase() + plan.slice(1)}
                </Badge>
              </div>
            )}
          </div>
        </Card>

        {/* All settings rows */}
        <Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
          {SIDEBAR.map(s => {
            const { Icon } = s
            const colorKey = MOBILE_ROW_COLORS[s.label] || 'pool'
            return (
              <NavLink
                key={s.to}
                to={s.to}
                end={s.end}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-gray-100 dark:active:bg-gray-800 transition-colors text-left group"
              >
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES[colorKey])}>
                  <Icon className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 text-[13.5px]">{s.label}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:translate-x-0.5 transition-transform shrink-0" strokeWidth={2} />
              </NavLink>
            )
          })}
        </Card>

        {/* Appearance */}
        <div className="space-y-2">
          <h3 className="section-title px-1">Appearance</h3>
          <Card className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-[13.5px]">Theme</p>
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400">Choose light, dark, or match your system</p>
            </div>
            <ThemeToggleFull />
          </Card>
        </div>

        {/* Sign out */}
        <div className="pt-2">
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card hover:bg-gray-50 dark:hover:bg-gray-800/50 min-h-tap transition-colors"
          >
            <LogOut className="w-4 h-4" strokeWidth={2} />
            Sign out
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 pb-2">PoolPro v1.0.0</p>
      </div>

      {/* DESKTOP: sidebar + pane */}
      <div className="hidden md:grid md:grid-cols-12 gap-4">
        <aside className="md:col-span-3 card !p-2 self-start">
          <nav className="space-y-0.5">
            {SIDEBAR.map(s => {
              const { Icon } = s
              return (
                <NavLink
                  key={s.to}
                  to={s.to}
                  end={s.end}
                  className={({ isActive }) => cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-[13px] transition-colors',
                    isActive
                      ? 'bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 font-semibold'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                  <span className="truncate">{s.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </aside>

        <div className="md:col-span-9 card !p-6 space-y-6">
          <Suspense fallback={<div className="text-sm text-gray-500 dark:text-gray-400 italic">Loading…</div>}>
            <Outlet />
          </Suspense>

          {/* Sign out — sits at the bottom of every pane */}
          <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
              Sign out
            </button>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3">PoolPro v1.0.0 · Signed in as {user?.email}</p>
          </div>
        </div>
      </div>
    </PageWrapper>
  )
}
