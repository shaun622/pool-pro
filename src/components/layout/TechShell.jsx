import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useBusiness } from '../../hooks/useBusiness'

export default function TechShell() {
  const { signOut } = useAuth()
  const { business, staffRecord } = useBusiness()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const techName = staffRecord?.name || 'Tech'
  const initials = techName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-100 dark:border-gray-800 shadow-nav">
        <div className="flex items-center justify-between px-4 h-14 max-w-lg mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-brand rounded-lg flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <span className="text-base font-bold bg-gradient-brand bg-clip-text text-transparent">PoolPro</span>
          </div>

          {/* Business name */}
          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium truncate max-w-[40%] text-center">
            {business?.name || ''}
          </p>

          {/* Profile menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="w-9 h-9 rounded-full flex items-center justify-center min-h-tap"
            >
              {staffRecord?.photo_url ? (
                <img src={staffRecord.photo_url} alt={techName} className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-pool-100 text-pool-700 flex items-center justify-center text-xs font-bold border border-pool-200">
                  {initials}
                </div>
              )}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-50 bg-white dark:bg-gray-900 rounded-xl shadow-elevated border border-gray-100 dark:border-gray-800 py-1 w-44 animate-scale-in">
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/tech/profile') }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    My Profile
                  </button>
                  <button
                    onClick={async () => { setMenuOpen(false); await signOut(); navigate('/login') }}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Log Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Page content */}
      <Outlet />
    </>
  )
}
