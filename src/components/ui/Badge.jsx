import { cn } from '../../lib/utils'

const variants = {
  default:    'bg-gray-100 text-gray-600 ring-gray-200/50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700/50',
  primary:    'bg-pool-50 text-pool-700 ring-pool-200/50 dark:bg-pool-950/40 dark:text-pool-300 dark:ring-pool-800/40',
  success:    'bg-emerald-50 text-emerald-700 ring-emerald-200/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/40',
  warning:    'bg-amber-50 text-amber-700 ring-amber-200/50 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/40',
  danger:     'bg-red-50 text-red-700 ring-red-200/50 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/40',
  // PoolPro-specific pool type variants
  chlorine:   'bg-blue-50 text-blue-700 ring-blue-200/50 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800/40',
  salt:       'bg-cyan-50 text-cyan-700 ring-cyan-200/50 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-800/40',
  mineral:    'bg-violet-50 text-violet-700 ring-violet-200/50 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/40',
  freshwater: 'bg-teal-50 text-teal-700 ring-teal-200/50 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800/40',
}

const dotColors = {
  default: 'bg-gray-400',
  primary: 'bg-pool-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  chlorine: 'bg-blue-500',
  salt: 'bg-cyan-500',
  mineral: 'bg-violet-500',
  freshwater: 'bg-teal-500',
}

export default function Badge({ children, variant = 'default', dot, className }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-semibold ring-1 ring-inset',
      variants[variant],
      className
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  )
}
