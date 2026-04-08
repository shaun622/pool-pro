export default function PageWrapper({ children, noPadding }) {
  return (
    <main className={`max-w-lg mx-auto pb-24 min-h-screen ${noPadding ? '' : 'px-4 pt-4'}`}>
      {children}
    </main>
  )
}
