import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Home, Calendar, ClipboardList, Users, Settings as SettingsIcon,
  FileText, Receipt, Repeat, BarChart3, MoreHorizontal,
} from 'lucide-react'
import MoreSheet from './MoreSheet'
import { cn } from '../../lib/utils'

// Primary tabs shown in the bottom bar
const primaryTabs = [
  { path: '/',            label: 'Home',       Icon: Home },
  { path: '/route',       label: 'Schedule',   Icon: Calendar },
  { path: '/work-orders', label: 'Jobs',       Icon: ClipboardList },
  { path: '/clients',     label: 'Clients',    Icon: Users },
]

// Items shown in the "More" sheet
const moreItems = [
  { path: '/quotes',         label: 'Quotes',     Icon: FileText,   color: 'amber'  },
  { path: '/invoices',       label: 'Invoices',   Icon: Receipt,    color: 'blue'   },
  { path: '/recurring-jobs', label: 'Recurring',  Icon: Repeat,     color: 'cyan'   },
  { path: '/reports',        label: 'Analytics',  Icon: BarChart3,  color: 'violet' },
  { path: '/settings',       label: 'Settings',   Icon: SettingsIcon, color: 'gray' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  // "More" is active when current path matches any item inside it
  const moreActive = moreItems.some(item => location.pathname.startsWith(item.path))

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/60 dark:border-gray-800/60 z-40 shadow-nav"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="grid grid-cols-5 max-w-lg mx-auto">
          {primaryTabs.map(({ path, label, Icon }) => {
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

          {/* More */}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'min-h-tap min-w-tap py-2 px-3 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 relative',
              moreActive ? 'text-pool-600 dark:text-pool-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
            )}
          >
            {moreActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-pool-500 rounded-full" />
            )}
            <MoreHorizontal className="w-5 h-5" strokeWidth={moreActive ? 2.5 : 2} />
            <span className={cn('mt-0.5 text-[10px] font-medium', moreActive && 'font-semibold')}>More</span>
          </button>
        </div>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
    </>
  )
}
