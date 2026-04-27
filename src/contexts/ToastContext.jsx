import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '../lib/utils'

const ToastContext = createContext(null)

let _id = 0
function nextId() { return ++_id }

const VARIANTS = {
  success: {
    Icon: CheckCircle2,
    bar: 'bg-emerald-500',
    icon: 'text-emerald-500 dark:text-emerald-400',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/40',
  },
  error: {
    Icon: XCircle,
    bar: 'bg-red-500',
    icon: 'text-red-500 dark:text-red-400',
    iconBg: 'bg-red-50 dark:bg-red-950/40',
  },
  warning: {
    Icon: AlertTriangle,
    bar: 'bg-amber-500',
    icon: 'text-amber-500 dark:text-amber-400',
    iconBg: 'bg-amber-50 dark:bg-amber-950/40',
  },
  info: {
    Icon: Info,
    bar: 'bg-pool-500',
    icon: 'text-pool-600 dark:text-pool-400',
    iconBg: 'bg-pool-50 dark:bg-pool-950/40',
  },
}

const DEFAULT_DURATION = 3500

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((variant, message, opts = {}) => {
    const id = nextId()
    const duration = opts.duration ?? DEFAULT_DURATION
    setToasts(prev => [...prev, { id, variant, message, title: opts.title }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }, [dismiss])

  const toast = {
    success: (message, opts) => push('success', message, opts),
    error:   (message, opts) => push('error',   message, opts),
    warning: (message, opts) => push('warning', message, opts),
    info:    (message, opts) => push('info',    message, opts),
    dismiss,
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div
          className="fixed z-[80] left-1/2 -translate-x-1/2 bottom-24 md:left-auto md:right-4 md:bottom-auto md:top-4 md:translate-x-0 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function ToastItem({ toast: t, onDismiss }) {
  const { Icon, bar, icon, iconBg } = VARIANTS[t.variant] || VARIANTS.info
  const [enter, setEnter] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setEnter(true)) }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 pl-4 pr-2 py-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-elevated',
        'transition-all duration-200 ease-out',
        enter ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      <span className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl', bar)} />
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
        <Icon className={cn('w-4 h-4', icon)} strokeWidth={2.25} />
      </div>
      <div className="flex-1 min-w-0 py-0.5">
        {t.title && <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.title}</p>}
        <p className={cn('text-sm', t.title ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200')}>
          {t.message}
        </p>
      </div>
      <button
        onClick={() => onDismiss(t.id)}
        className="shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
