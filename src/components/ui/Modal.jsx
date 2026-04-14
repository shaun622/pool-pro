import { useEffect, useRef } from 'react'

export default function Modal({ open, onClose, title, headerAction, children }) {
  const overlayRef = useRef(null)

  useEffect(() => {
    if (!open) return

    // Lock body scroll and position to prevent background movement
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

  // Prevent touchmove on the overlay (not the panel) to stop background scroll-through
  useEffect(() => {
    if (!open) return
    const overlay = overlayRef.current
    if (!overlay) return

    function preventScroll(e) {
      // Allow scrolling inside the modal panel, block everything else
      const panel = overlay.querySelector('[data-modal-panel]')
      if (panel && panel.contains(e.target)) return
      e.preventDefault()
    }

    overlay.addEventListener('touchmove', preventScroll, { passive: false })
    return () => overlay.removeEventListener('touchmove', preventScroll)
  }, [open])

  if (!open) return null

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div data-modal-panel className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain p-6 shadow-elevated animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
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

        {children}
      </div>
    </div>
  )
}
