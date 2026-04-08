import { cn } from '../../lib/utils'

export default function Card({ children, className, onClick, ...props }) {
  return (
    <div
      className={cn(
        onClick ? 'card-interactive' : 'card',
        className
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  )
}
