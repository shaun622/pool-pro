import { cn } from '../../lib/utils'

/**
 * PageHero — FieldSuite/AWC spec.
 * Optional eyebrow + bold gray-900 title + optional subtitle + optional right-side action.
 *
 * Props:
 *   eyebrow   — JSX (optional, renders above title via .eyebrow utility)
 *               Always pass with a lucide icon for tone consistency, e.g.:
 *                 <span className="inline-flex items-center gap-2">
 *                   <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} /> Good morning
 *                 </span>
 *   title     — string or JSX (required)
 *   subtitle  — string or JSX (optional, dynamic context like counts/dates)
 *   action    — JSX (optional, typically a primary <Button>)
 *   className
 */
export default function PageHero({ eyebrow, title, subtitle, action, className }) {
  return (
    <section className={cn('mb-5 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-[1.05] text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-1 max-w-prose">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  )
}
