import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Calendar, ClipboardList, Users, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

const tabs = [
  { path: '/',            label: 'Home',        Icon: Home },
  { path: '/route',       label: 'Schedule',    Icon: Calendar },
  { path: '/work-orders', label: 'Work Orders', Icon: ClipboardList },
  { path: '/clients',     label: 'Clients',     Icon: Users },
  { path: '/settings',    label: 'Settings',    Icon: SettingsIcon },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/60 dark:border-gray-800/60 z-40 shadow-nav"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-cols-5 max-w-lg mx-auto">
        {tabs.map(({ path, label, Icon }) => {
          const active = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path)
          return (
            <button
              key={path}
              onClick={() => { navigate(path); window.scrollTo(0, 0) }}
              className={cn(
                'min-h-tap min-w-tap py-2 px-3 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 relative',
                active ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-pool-500 rounded-full" />
              )}
              <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
              <span className={cn('mt-0.5 text-[10px] font-medium', active && 'font-semibold')}>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
