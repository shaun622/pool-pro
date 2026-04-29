import { cn } from '../../lib/utils'

/**
 * Card — AWC spec. rounded-2xl (16px), border-gray-100 hairline, shadow-card.
 *
 * Props:
 *   onClick — if provided, renders as a <button> with hover-lift
 *   hover   — opt-in to interactive hover styles without an onClick
 *   tinted  — pool-tinted background for hero cards / brand-soft KPI tiles
 *   className — passthrough; pass "!p-0" to drop default p-4 (for divided lists)
 */
export default function Card({ children, className = '', onClick, hover = false, tinted = false, ...props }) {
  const Comp = onClick ? 'button' : 'div'
  const interactive = !!onClick || hover

  return (
    <Comp
      onClick={onClick}
      className={cn(
        'block w-full text-left bg-white rounded-2xl border border-gray-100 p-4 shadow-card transition-all duration-200',
        'dark:bg-gray-900 dark:border-gray-800',
        tinted && 'bg-pool-50/50 border-pool-200/40 dark:bg-pool-950/30 dark:border-pool-800/40',
        interactive && 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 active:translate-y-0 hover:border-gray-200 dark:hover:border-gray-700',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
