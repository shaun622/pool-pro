import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { ThemeToggleCompact } from './ThemeToggle'

export default function Header({ title, backTo, right, hideThemeToggle }) {
  const navigate = useNavigate()

  return (
    <header
      className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/60"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center justify-between min-h-[56px] px-4 md:px-8 max-w-lg md:max-w-6xl mx-auto gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {backTo && (
            <button
              onClick={() => typeof backTo === 'string' ? navigate(backTo) : navigate(-1)}
              className="min-h-tap min-w-tap flex items-center justify-center -ml-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400"
              aria-label="Back"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
            </button>
          )}
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {right}
          {!hideThemeToggle && <ThemeToggleCompact className="md:hidden" />}
        </div>
      </div>
    </header>
  )
}
