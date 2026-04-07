import { cn } from '../../lib/utils'

export default function Card({ children, className, onClick, ...props }) {
  return (
    <div
      className={cn(
        'card',
        onClick && 'cursor-pointer hover:border-pool-300 active:bg-gray-50 transition-colors',
        className
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  )
}
