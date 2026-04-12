import { cn } from '../../lib/utils'

export default function Input({ label, error, className, large, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-600">{label}</label>
      )}
      <input
        className={cn(large ? 'input-lg' : 'input', error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

export function TextArea({ label, error, className, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-600">{label}</label>
      )}
      <textarea
        className={cn('input min-h-[100px] resize-none', error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

export { default as Select } from './CustomSelect'
