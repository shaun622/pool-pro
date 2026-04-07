import { cn } from '../../lib/utils'

const variants = {
  default: 'bg-gray-100 text-gray-700',
  primary: 'bg-pool-100 text-pool-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  chlorine: 'bg-blue-100 text-blue-700',
  salt: 'bg-cyan-100 text-cyan-700',
  mineral: 'bg-purple-100 text-purple-700',
  freshwater: 'bg-teal-100 text-teal-700',
}

export default function Badge({ children, variant = 'default', className }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}
