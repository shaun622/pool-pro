import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'

const tabs = [
  { path: '/', label: 'Home' },
  { path: '/route', label: 'Schedule' },
  { path: '/work-orders', label: 'Work Orders' },
  { path: '/clients', label: 'Clients' },
  { path: '/settings', label: 'Settings' },
]

export default function TopNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="hidden md:block sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-gray-200/60 shadow-nav">
      <div className="max-w-7xl mx-auto px-8 h-14 flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
            </svg>
          </div>
          <span className="text-base font-bold text-gray-900 group-hover:text-pool-600 transition-colors">PoolPro</span>
        </button>

        <div className="flex items-center gap-1">
          {tabs.map(tab => {
            const active = tab.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(tab.path)
            return (
              <button
                key={tab.path}
                onClick={() => {
                  navigate(tab.path)
                  window.scrollTo(0, 0)
                }}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                  active
                    ? 'bg-pool-50 text-pool-600 font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
