import { useEffect, useRef } from 'react'

export default function Modal({ open, onClose, title, headerAction, children }) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      {/* Backdrop — no backdrop-blur, solid overlay for Safari perf */}
      <div className="fixed inset-0 bg-gray-900/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-elevated animate-slide-up">
        {/* Header — solid bg, no blur */}
        <div className="flex items-center justify-between p-6 pb-0 mb-5">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <div className="flex items-center gap-1">
            {headerAction}
            <button
              onClick={onClose}
              className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drag indicator for mobile */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 rounded-full sm:hidden" />

        {/* Scrollable content — overscroll-contain prevents scroll chaining, overflow-x-hidden kills horizontal scroll */}
        <div className="overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  )
}
