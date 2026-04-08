import Button from './Button'

export default function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-in">
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-gradient-brand-light flex items-center justify-center mb-5 text-pool-500">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-bold text-gray-900 mb-1.5">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-8 max-w-xs leading-relaxed">{description}</p>}
      {action && (
        <Button onClick={onAction}>{action}</Button>
      )}
    </div>
  )
}
