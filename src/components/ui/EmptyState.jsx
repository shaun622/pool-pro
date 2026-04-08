import Button from './Button'

export default function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center animate-fade-in">
      {icon && (
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3 text-gray-400">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-600 mb-0.5">{title}</h3>
      {description && <p className="text-xs text-gray-400 mb-4 max-w-[240px] leading-relaxed">{description}</p>}
      {action && (
        <Button onClick={onAction} className="text-sm">{action}</Button>
      )}
    </div>
  )
}
