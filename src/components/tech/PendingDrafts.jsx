// Loud, persistent "unsent visits" strip + the deliberate Submit action.
// Shown whenever drafts exist — never gated on navigator.onLine. Presentational:
// state comes from usePendingDrafts() (lifted to TechShell so the logout guard
// shares the same count).
export default function PendingDrafts({ count, submitting, onSubmit }) {
  if (!count) return null
  return (
    <div className="sticky top-14 z-20 bg-amber-500 text-white shadow-sm">
      <div className="max-w-lg mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-semibold truncate">
            {count} visit{count > 1 ? 's' : ''} waiting to send
          </span>
        </div>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="shrink-0 rounded-lg bg-white text-amber-700 px-4 py-1.5 text-sm font-bold disabled:opacity-60 active:scale-[0.98] transition-transform"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
