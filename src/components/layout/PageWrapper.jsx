import { cn } from '../../lib/utils'

export default function PageWrapper({ children, noPadding, width = 'default', className }) {
  const maxW = width === 'wide' ? 'md:max-w-7xl' : 'md:max-w-5xl'
  const padding = noPadding ? '' : 'px-4 md:px-8 pt-4'
  return (
    <main
      className={cn(
        'max-w-lg mx-auto pb-28 md:pb-12 animate-fade-in',
        maxW,
        padding,
        className
      )}
    >
      {children}
    </main>
  )
}
