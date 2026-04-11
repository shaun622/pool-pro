export default function PageWrapper({ children, noPadding, width = 'default' }) {
  const maxW = width === 'wide' ? 'md:max-w-7xl' : 'md:max-w-5xl'
  const padding = noPadding ? '' : 'px-4 md:px-8 pt-4'
  return (
    <main className={`max-w-lg ${maxW} mx-auto pb-24 md:pb-8 ${padding}`}>
      {children}
    </main>
  )
}
