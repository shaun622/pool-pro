import { useState, useRef, useEffect } from 'react'
import { cn } from '../../lib/utils'

/**
 * Fully styled dropdown that replaces native <select>.
 * Props mirror the Select component from Input.jsx:
 *   label, options=[{value,label}], value, onChange(e-like), error, className, disabled, placeholder
 */
export default function CustomSelect({
  label,
  options = [],
  value,
  onChange,
  error,
  className,
  disabled,
  placeholder,
  inline,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = options.find(o => String(o.value) === String(value))
  const displayLabel = selected?.label || placeholder || 'Select…'

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  function handleSelect(opt) {
    // Mimic native onChange event shape
    onChange?.({ target: { value: opt.value } })
    setOpen(false)
  }

  const triggerClasses = inline
    ? cn(
        'flex items-center justify-between gap-2 w-full rounded-lg border bg-white dark:bg-gray-900 px-3 py-1.5',
        'text-sm font-medium text-gray-700 dark:text-gray-200 transition-all duration-200 cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-pool-500/30 focus:border-pool-400',
        open ? 'border-pool-400 ring-2 ring-pool-500/30 shadow-sm' : 'border-gray-200 dark:border-gray-700 shadow-sm',
        error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400',
        disabled && 'bg-gray-50 dark:bg-gray-800 cursor-not-allowed opacity-60',
        className,
      )
    : cn(
        'flex items-center justify-between gap-2 w-full rounded-xl border bg-white dark:bg-gray-900 px-4 py-3',
        'min-h-tap shadow-inner-soft text-base font-normal text-gray-900 dark:text-gray-100 transition-all duration-200 cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-pool-500/30 focus:border-pool-400',
        open ? 'border-pool-400 ring-2 ring-pool-500/30' : 'border-gray-200 dark:border-gray-700',
        error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400',
        disabled && 'bg-gray-50 dark:bg-gray-800 cursor-not-allowed opacity-60',
        className,
      )

  return (
    <div className="space-y-1.5" ref={ref}>
      {label && (
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">{label}</label>
      )}
      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          onClick={() => !disabled && setOpen(v => !v)}
          className={triggerClasses}
        >
          <span className={cn('truncate', !selected && 'text-gray-400 dark:text-gray-500')}>
            {displayLabel}
          </span>
          <svg
            className={cn(
              'w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200',
              open && 'rotate-180',
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown list */}
        {open && (
          <div className="absolute z-50 mt-1.5 w-full min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-elevated py-1 animate-scale-in overflow-hidden max-h-60 overflow-y-auto">
            {options.map((opt) => {
              const isActive = String(opt.value) === String(value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm transition-colors duration-100',
                    'flex items-center justify-between gap-2',
                    isActive
                      ? 'bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 font-semibold'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {isActive && (
                    <svg className="w-4 h-4 shrink-0 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}
