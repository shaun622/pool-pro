import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { cn } from '../../lib/utils'

/**
 * Compact toggle (header) — single-button light ↔ dark switch.
 */
export function ThemeToggleCompact({ className }) {
  const { mode, setMode, isDark } = useTheme()

  function next() {
    // Cycle: light → dark → system → light
    if (mode === 'light') setMode('dark')
    else if (mode === 'dark') setMode('system')
    else setMode('light')
  }

  // Icon shows current effective state
  const Icon = mode === 'system' ? Monitor : (isDark ? Moon : Sun)
  const label = mode === 'system' ? 'System theme' : isDark ? 'Dark theme' : 'Light theme'

  return (
    <button
      onClick={next}
      className={cn(
        'min-h-tap min-w-tap rounded-xl p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors',
        className
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="w-5 h-5" strokeWidth={2} />
    </button>
  )
}

/**
 * Full segmented control — Light / System / Dark (used in Settings → Appearance).
 */
export function ThemeToggleFull({ className }) {
  const { mode, setMode } = useTheme()
  const options = [
    { value: 'light',  Icon: Sun,     label: 'Light' },
    { value: 'system', Icon: Monitor, label: 'System' },
    { value: 'dark',   Icon: Moon,    label: 'Dark' },
  ]

  return (
    <div className={cn(
      'inline-flex rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-0.5',
      className
    )}>
      {options.map(({ value, Icon, label }) => (
        <button
          key={value}
          onClick={() => setMode(value)}
          aria-pressed={mode === value}
          className={cn(
            'min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all',
            mode === value
              ? 'bg-pool-500 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
          )}
        >
          <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
          {label}
        </button>
      ))}
    </div>
  )
}

export default ThemeToggleCompact
