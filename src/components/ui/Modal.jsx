import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
}

export default function Modal({ open, onClose, title, headerAction, size = 'md', zLayer = 50, children }) {
  const scrollYRef = useRef(0)

  useEffect(() => {
    if (!open) return

    // Save scroll position and lock <html> — iOS Safari safe
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
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center animate-fade-in"
      style={{ zIndex: zLayer }}
      role="dialog"
      aria-modal="true"
    >
      {/* Solid backdrop — no backdrop-blur (kills Safari perf in modals) */}
      <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className={cn(
        'relative bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full max-h-[92vh] flex flex-col shadow-elevated animate-slide-up sm:animate-scale-in',
        SIZES[size],
      )}>
        {/* Drag indicator (mobile only) */}
        <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />

        {title && (
          <div className="flex items-center justify-between p-6 pb-0 mb-5">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
            <div className="flex items-center gap-1">
              {headerAction}
              <button
                onClick={onClose}
                className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className={cn(
          'overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-6',
          !title && 'pt-6'
        )}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
