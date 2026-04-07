import { useNavigate } from 'react-router-dom'

export default function Header({ title, backTo, right }) {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          {backTo && (
            <button
              onClick={() => typeof backTo === 'string' ? navigate(backTo) : navigate(-1)}
              className="min-h-tap min-w-tap flex items-center justify-center -ml-2 rounded-full hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h1 className="text-lg font-semibold truncate">{title}</h1>
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    </header>
  )
}
