import { cn } from '../../lib/utils'

export default function Card({ children, className, onClick, ...props }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        onClick ? 'card-interactive block w-full text-left' : 'card',
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
