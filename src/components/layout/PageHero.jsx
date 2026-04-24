import { cn } from '../../lib/utils'

/**
 * Page hero — H1 title + optional subtitle + optional action button on the right.
 * Used at the top of every list/dashboard page (replaces the sticky page Header pattern).
 *
 * Props:
 *   title     — string or JSX (required)
 *   subtitle  — string or JSX (optional, dynamic context like counts/dates)
 *   action    — JSX (optional, typically a primary <Button>)
 *   className
 */
export default function PageHero({ title, subtitle, action, className }) {
  return (
    <section className={cn('mb-6 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  )
}
