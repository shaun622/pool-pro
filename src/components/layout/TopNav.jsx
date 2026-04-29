import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Calendar, ClipboardList, Users, Settings as SettingsIcon, FileText, Receipt, Repeat, BarChart3 } from 'lucide-react'
import { ThemeToggleCompact } from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import { cn } from '../../lib/utils'

const tabs = [
  { path: '/',                label: 'Home',        Icon: Home },
  { path: '/schedule',        label: 'Schedule',    Icon: Calendar },
  { path: '/work-orders',     label: 'Work Orders', Icon: ClipboardList },
  { path: '/clients',         label: 'Clients',     Icon: Users },
  { path: '/quotes',          label: 'Quotes',      Icon: FileText },
  { path: '/invoices',        label: 'Invoices',    Icon: Receipt },
  { path: '/recurring-jobs',  label: 'Recurring',   Icon: Repeat },
  { path: '/reports',         label: 'Analytics',   Icon: BarChart3 },
  { path: '/settings',        label: 'Settings',    Icon: SettingsIcon },
]

export default function TopNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <header
      className="hidden md:block sticky top-0 z-40 bg-transparent shadow-[0_4px_8px_-6px_rgba(15,17,24,0.08)]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* ── ROW 1: brand + search + theme ──────────────────── */}
      <div className="max-w-7xl mx-auto px-8 flex items-center gap-6 min-h-[60px]">
        {/* LEFT: brand wordmark with FieldSuite subscript */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 group shrink-0"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
            </svg>
          </div>
          <div className="leading-tight text-left">
            <div className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100 group-hover:text-pool-600 transition-colors">
              PoolMate
            </div>
            <div className="text-[9.5px] font-medium tracking-[0.14em] uppercase text-gray-500 dark:text-gray-400">
              by Fieldsuite
            </div>
          </div>
        </button>

        {/* CENTER: global search */}
        <GlobalSearch className="flex-1 max-w-2xl mx-auto" />

        {/* RIGHT: theme toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggleCompact />
        </div>
      </div>

      {/* ── ROW 2: underline tabs ──────────────────────────── */}
      <nav className="max-w-7xl mx-auto px-8 flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-gray-200/60 dark:border-gray-800/60">
        {tabs.map(({ path, label, Icon }) => {
          const active = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path)
          return (
            <button
              key={path}
              onClick={() => { navigate(path); window.scrollTo(0, 0) }}
              className={cn(
                'flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                active
                  ? 'border-pool-500 text-pool-700 dark:text-pool-300'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
              {label}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
