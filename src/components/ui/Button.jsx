import { cn } from '../../lib/utils'

const VARIANTS = {
  primary:   'bg-gradient-brand text-white shadow-md shadow-pool-500/20 hover:shadow-lg hover:shadow-pool-500/30 hover:brightness-110 active:shadow-sm',
  secondary: 'bg-white text-gray-700 border border-gray-200 shadow-card hover:bg-gray-50 hover:border-gray-300 hover:shadow-card-hover active:bg-gray-100 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800 dark:hover:border-gray-600',
  danger:    'bg-gradient-danger text-white shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30 hover:brightness-110',
  ghost:     'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100',
}

const SIZES = {
  sm: 'px-3 py-2 text-xs min-h-[36px]',
  md: 'px-5 py-3 text-sm min-h-tap min-w-tap',
  lg: 'px-6 py-4 text-base min-h-tap',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  className,
  loading,
  ...props
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-wide transition-all duration-200 active:scale-[0.98]',
        'focus:outline-none focus:ring-2 focus:ring-pool-500/40 focus:ring-offset-2 dark:focus:ring-offset-gray-950',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : LeftIcon && <LeftIcon className="w-4 h-4" />}
      {children}
      {!loading && RightIcon && <RightIcon className="w-4 h-4" />}
    </button>
  )
}
