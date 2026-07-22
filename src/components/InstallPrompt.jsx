import { useState, useEffect } from 'react'
import { X, Download } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { getInstallState, subscribeInstall, promptInstall } from '../lib/pwaInstall'

// Dismissible "install this app" nudge for the field crew. Two shapes:
//   • Android/Chromium — a real one-tap Install button (uses the captured
//     beforeinstallprompt event via ../lib/pwaInstall).
//   • iOS — Apple allows no programmatic install, so it shows the manual
//     Share → "Add to Home Screen" steps instead.
// Self-hides when the app is already installed (standalone) or recently dismissed.

const DISMISS_KEY = 'poolpro:install-dismissed'
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000 // re-offer after two weeks if not installed

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true // iOS Safari installed
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
}

function recentlyDismissed() {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return ts > 0 && (Date.now() - ts) < DISMISS_MS
  } catch { return false }
}

// iOS-style Share glyph (box with an up-arrow) so the hint points at the real button.
function ShareGlyph(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 15V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6" />
    </svg>
  )
}

export default function InstallPrompt() {
  const { t } = useLanguage()
  const [state, setState] = useState(() => getInstallState())
  const [dismissed, setDismissed] = useState(() => recentlyDismissed())

  // Re-render when the install event arrives (it can fire after this mounts).
  useEffect(() => subscribeInstall(() => setState(getInstallState())), [])

  if (dismissed || isStandalone()) return null

  const canPromptAndroid = !!state.deferred && !state.installed
  const ios = isIos()

  // Nothing to offer yet (desktop browser with no install event, not iOS) — stay hidden.
  if (!canPromptAndroid && !ios) return null

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setDismissed(true)
  }

  async function install() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') setDismissed(true)
    else setState(getInstallState()) // prompt consumed — re-evaluate
  }

  return (
    <div className="relative mt-4 mb-3 rounded-2xl border border-pool-100 dark:border-pool-900 bg-pool-50 dark:bg-pool-950/30 p-3.5">
      <button
        onClick={dismiss}
        aria-label={t('common.close')}
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      >
        <X className="w-4 h-4" strokeWidth={2} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="w-10 h-10 rounded-xl bg-pool-500 text-white flex items-center justify-center shrink-0">
          <Download className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('install.title')}</p>
          {canPromptAndroid ? (
            <>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{t('install.blurb')}</p>
              <button
                onClick={install}
                className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-brand text-white text-sm font-semibold active:scale-[0.98] transition-all min-h-tap"
              >
                <Download className="w-4 h-4" strokeWidth={2} />
                {t('install.button')}
              </button>
            </>
          ) : (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <p>{t('install.iosLead')}</p>
              <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-200">
                <ShareGlyph className="w-4 h-4 text-pool-600 dark:text-pool-400 shrink-0" />
                {t('install.iosShare')}
              </p>
              <p className="font-medium text-gray-800 dark:text-gray-200">{t('install.iosAdd')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
