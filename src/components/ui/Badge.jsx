import { cn } from '../../lib/utils'

const variants = {
  default: 'bg-gray-100 text-gray-600 ring-gray-200/50',
  primary: 'bg-pool-50 text-pool-700 ring-pool-200/50',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200/50',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200/50',
  danger: 'bg-red-50 text-red-700 ring-red-200/50',
  chlorine: 'bg-blue-50 text-blue-700 ring-blue-200/50',
  salt: 'bg-cyan-50 text-cyan-700 ring-cyan-200/50',
  mineral: 'bg-violet-50 text-violet-700 ring-violet-200/50',
  freshwater: 'bg-teal-50 text-teal-700 ring-teal-200/50',
}

export default function Badge({ children, variant = 'default', className }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold ring-1 ring-inset',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}
