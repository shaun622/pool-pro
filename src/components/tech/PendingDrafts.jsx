// "Unsent visits" strip. Sending is AUTOMATIC (see outboxProcessor) — this is a
// calm status indicator, not a chore. The visits are already saved safely on the
// phone; this just shows they're on their way. The "Send now" button is optional
// (it only skips the retry backoff); a tech never has to tap it, and must never
// feel they need to refresh or re-do the visit. Presentational: state comes from
// usePendingDrafts() (lifted to TechShell so the logout guard shares the count).
export default function PendingDrafts({ count, status, submitting, onSubmit }) {
  if (!count) return null

  const isAuth = status === 'auth'
  const isWrongOrg = status === 'wrong-org'
  const isFailed = status === 'failed'   // permanent — needs attention
  const isStuck = status === 'stuck'     // still retrying, but for a long time
  const busy = status === 'sending' || submitting
  const plural = count > 1 ? 's' : ''

  let message
  if (isFailed) message = `${count} saved visit${plural} couldn't send — needs attention`
  else if (isAuth) message = `Sign in again to send ${count} saved visit${plural}`
  else if (isWrongOrg) message = `${count} visit${plural} can't be sent from this account`
  else if (isStuck) message = `${count} visit${plural} still not sent — please check`
  else message = `${count} visit${plural} saved — sending automatically…`

  const tone = (isFailed || isAuth || isWrongOrg) ? 'bg-red-600' : isStuck ? 'bg-orange-500' : 'bg-amber-500'
  const showSpinner = busy && !isAuth && !isWrongOrg && !isFailed

  return (
    <div className={`sticky top-14 z-20 ${tone} text-white shadow-sm`}>
      <div className="max-w-lg mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {showSpinner ? (
            <span className="w-4 h-4 shrink-0 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
          ) : (
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span className="text-sm font-semibold truncate">{message}</span>
        </div>
        {!isWrongOrg && (
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="shrink-0 rounded-lg bg-white text-amber-700 px-4 py-1.5 text-sm font-bold disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {submitting ? 'Sending…' : (isFailed || isAuth) ? 'Retry' : 'Send now'}
          </button>
        )}
      </div>
    </div>
  )
}
