import Button from './Button'
import { cn } from '../../lib/utils'

/**
 * Empty list / zero-data placeholder.
 *
 * Backwards compatible:
 *   - action="Add Client" + onAction={fn}  → renders styled Button
 *   - action={<Button .../>}                → renders the JSX directly (new pattern)
 *
 * Props:
 *   icon     — JSX node OR Lucide icon component (preferred)
 *   title, description
 *   action, onAction
 *   variant  — 'default' (large/glow, primary spot) | 'compact' (smaller, inline)
 */
export default function EmptyState({ icon, title, description, action, onAction, variant = 'default' }) {
  // Render icon — accept either JSX node or component
  let iconEl = null
  if (icon) {
    if (typeof icon === 'function') {
      const Icon = icon
      iconEl = <Icon className={variant === 'compact' ? 'w-5 h-5' : 'w-8 h-8'} strokeWidth={1.75} />
    } else {
      iconEl = icon
    }
  }

  // Render action — accept either a string (legacy) or JSX node
  let actionEl = null
  if (action) {
    if (typeof action === 'string') {
      actionEl = <Button onClick={onAction}>{action}</Button>
    } else {
      actionEl = action
    }
  }

  if (variant === 'compact') {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center animate-fade-in">
        {iconEl && (
          <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3 text-gray-400 dark:text-gray-500">
            {iconEl}
          </div>
        )}
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-0.5">{title}</h3>
        {description && <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 max-w-[240px] leading-relaxed">{description}</p>}
        {actionEl}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center text-center py-16 px-6 animate-fade-in">
      {iconEl && (
        <div className="w-16 h-16 rounded-2xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center mb-4 text-pool-500 dark:text-pool-400 shadow-glow">
          {iconEl}
        </div>
      )}
      <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-6">{description}</p>}
      {actionEl}
    </div>
  )
}
