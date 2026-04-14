import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActivity } from '../../hooks/useActivity'
import { cn } from '../../lib/utils'

const TYPE_CONFIG = {
  quote_sent: { icon: '📤', color: 'bg-blue-50 text-blue-600' },
  quote_accepted: { icon: '✅', color: 'bg-green-50 text-green-600' },
  quote_declined: { icon: '❌', color: 'bg-red-50 text-red-600' },
  quote_viewed: { icon: '👁', color: 'bg-cyan-50 text-cyan-600' },
  job_created: { icon: '🔧', color: 'bg-pool-50 text-pool-600' },
  job_completed: { icon: '✔️', color: 'bg-green-50 text-green-600' },
  service_completed: { icon: '🏊', color: 'bg-pool-50 text-pool-600' },
  client_created: { icon: '👤', color: 'bg-purple-50 text-purple-600' },
  payment_received: { icon: '💰', color: 'bg-emerald-50 text-emerald-600' },
  recurring_generated: { icon: '🔄', color: 'bg-amber-50 text-amber-600' },
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function ActivityPanel({ open, onClose }) {
  const navigate = useNavigate()
  const { activities, unreadCount, loading, markAllRead, markRead } = useActivity()

  useEffect(() => {
    if (!open) return
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Activity</h2>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="text-xs text-pool-600 font-semibold hover:text-pool-700">
                Mark all read
              </button>
            )}
            <button onClick={onClose}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">No activity yet</p>
              <p className="text-xs text-gray-400 mt-1">Actions will appear here as they happen</p>
            </div>
          ) : (
            <div>
              {activities.map(activity => {
                const config = TYPE_CONFIG[activity.type] || { icon: '📌', color: 'bg-gray-50 text-gray-600' }
                return (
                  <button
                    key={activity.id}
                    onClick={() => {
                      markRead(activity.id)
                      if (activity.link_to) {
                        navigate(activity.link_to)
                        onClose()
                      }
                    }}
                    className={cn('w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50',
                      !activity.is_read && 'bg-pool-50/30')}
                  >
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm', config.color)}>
                      {config.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm truncate', !activity.is_read ? 'font-semibold text-gray-900' : 'text-gray-700')}>
                        {activity.title}
                      </p>
                      {activity.description && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{activity.description}</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(activity.created_at)}</p>
                    </div>
                    {!activity.is_read && (
                      <div className="w-2 h-2 rounded-full bg-pool-500 shrink-0 mt-2" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// Bell icon button for the header
export function ActivityBell({ onClick }) {
  const { unreadCount } = useActivity()

  return (
    <button
      onClick={onClick}
      className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100/80 transition-colors relative"
    >
      <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}
