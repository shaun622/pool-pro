import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Bottom-sheet shown on mobile when the user taps the "More" tab in BottomNav.
 *
 * Props:
 *   open, onClose
 *   items: [{ path, label, Icon, color }, ...]
 *     where color matches a key in COLOR_CLASSES below
 */
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
  gray:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
}

export default function MoreSheet({ open, onClose, items = [] }) {
  const navigate = useNavigate()
  const scrollYRef = useRef(0)

  useEffect(() => {
    if (!open) return
    scrollYRef.current = window.scrollY
    document.documentElement.style.position = 'fixed'
    document.documentElement.style.top = `-${scrollYRef.current}px`
    document.documentElement.style.width = '100%'
    return () => {
      document.documentElement.style.position = ''
      document.documentElement.style.top = ''
      document.documentElement.style.width = ''
      window.scrollTo(0, scrollYRef.current)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center animate-fade-in md:hidden">
      <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60" onClick={onClose} />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-t-3xl w-full max-h-[85vh] flex flex-col shadow-elevated animate-slide-up"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Drag indicator */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">More</h2>
          <button
            onClick={onClose}
            className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-400" strokeWidth={2} />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto px-4 pb-6">
          <div className="space-y-1">
            {items.map(({ path, label, Icon, color = 'gray' }) => (
              <button
                key={path}
                onClick={() => { onClose(); navigate(path); window.scrollTo(0, 0) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES[color])}>
                  <Icon className="w-5 h-5" strokeWidth={2} />
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
