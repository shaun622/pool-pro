import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Calendar, ClipboardList, Users, Settings as SettingsIcon, Search } from 'lucide-react'
import { ThemeToggleCompact } from './ThemeToggle'
import { cn } from '../../lib/utils'

const tabs = [
  { path: '/',            label: 'Home',        Icon: Home },
  { path: '/route',       label: 'Schedule',    Icon: Calendar },
  { path: '/work-orders', label: 'Work Orders', Icon: ClipboardList },
  { path: '/clients',     label: 'Clients',     Icon: Users },
  { path: '/settings',    label: 'Settings',    Icon: SettingsIcon },
]

export default function TopNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <header
      className="hidden md:block sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/60"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="max-w-7xl mx-auto px-8 flex items-center gap-4 min-h-[60px]">
        {/* LEFT: brand */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 group shrink-0"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
            </svg>
          </div>
          <span className="text-base font-bold text-gray-900 dark:text-gray-100 group-hover:text-pool-600 transition-colors">PoolPro</span>
        </button>

        {/* CENTRE: underline tabs */}
        <nav className="flex-1 flex items-center justify-center gap-1 overflow-x-auto scrollbar-none">
          {tabs.map(({ path, label, Icon }) => {
            const active = path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(path)
            return (
              <button
                key={path}
                onClick={() => { navigate(path); window.scrollTo(0, 0) }}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
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

        {/* RIGHT: search + theme toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="min-h-tap min-w-tap rounded-xl p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
            aria-label="Search"
            title="Search"
          >
            <Search className="w-5 h-5" strokeWidth={2} />
          </button>
          <ThemeToggleCompact />
        </div>
      </div>
    </header>
  )
}
