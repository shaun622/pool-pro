import { cn } from '../../lib/utils'

/**
 * Badge — FieldSuite/AWC spec.
 *
 * Soft-tonal background + ring-1 inset + Inter caps tracking-wider tabular-nums.
 * Pool-chemistry domain variants (chlorine/salt/mineral/freshwater) are kept on
 * the same shape — they remain part of PoolPro's identity.
 *
 * Variants:
 *   primary | success | warning | danger | info | neutral
 *   success-solid | brand-solid          — high-emphasis (Paid / Accepted)
 *   chlorine | salt | mineral | freshwater — pool chemistry domain
 *   default — alias of neutral, kept for back-compat
 */
const VARIANTS = {
  primary:    'bg-pool-50 text-pool-700 ring-pool-200/50 dark:bg-pool-950/40 dark:text-pool-300 dark:ring-pool-800/40',
  success:    'bg-emerald-50 text-emerald-700 ring-emerald-200/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/40',
  warning:    'bg-amber-50 text-amber-700 ring-amber-200/50 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/40',
  danger:     'bg-red-50 text-red-700 ring-red-200/50 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/40',
  info:       'bg-sky-50 text-sky-700 ring-sky-200/50 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800/40',
  neutral:    'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700/50',
  // High-emphasis solid variants
  'success-solid': 'bg-emerald-500 text-white ring-emerald-500/40',
  'brand-solid':   'bg-pool-500 text-white ring-pool-500/40',
  // Pool chemistry domain variants
  chlorine:   'bg-blue-50 text-blue-700 ring-blue-200/50 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/40',
  salt:       'bg-cyan-50 text-cyan-700 ring-cyan-200/50 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-800/40',
  mineral:    'bg-violet-50 text-violet-700 ring-violet-200/50 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/40',
  freshwater: 'bg-teal-50 text-teal-700 ring-teal-200/50 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800/40',
}
// Back-compat alias — older call sites use variant="default"
VARIANTS.default = VARIANTS.neutral

const DOT_COLORS = {
  primary: 'bg-pool-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
  neutral: 'bg-gray-400',
  default: 'bg-gray-400',
  'success-solid': 'bg-white/80',
  'brand-solid': 'bg-white/80',
  chlorine: 'bg-blue-500',
  salt: 'bg-cyan-500',
  mineral: 'bg-violet-500',
  freshwater: 'bg-teal-500',
}

export default function Badge({ children, variant = 'neutral', dot, className }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full',
      'text-[10.5px] font-semibold uppercase tracking-wider tabular-nums ring-1 ring-inset',
      VARIANTS[variant] || VARIANTS.neutral,
      className,
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', DOT_COLORS[variant] || DOT_COLORS.neutral)} />}
      {children}
    </span>
  )
}
