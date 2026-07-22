// Capture the Android/Chromium `beforeinstallprompt` event as early as possible.
//
// Two reasons this lives at module scope (imported in main.jsx) rather than inside a
// React component:
//   1. The event can fire BEFORE any component mounts (right after the SW registers), and
//      there is exactly ONE chance to use it — a listener attached late simply misses it.
//   2. The deferred event must be stashed so an install button can appear whenever/wherever
//      it eventually mounts (e.g. the tech reaches the run sheet a few seconds after load).
//
// iOS Safari never fires this event (Apple allows no programmatic install), so there is
// nothing to capture there — the UI falls back to an "Add to Home Screen" hint instead.

let _deferred = null       // the saved BeforeInstallPromptEvent (Android/Chromium)
let _installed = false
const _subs = new Set()

function notify() {
  for (const fn of _subs) { try { fn() } catch { /* ignore subscriber errors */ } }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()       // stop Chrome's default mini-infobar; we show our own button
    _deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    _installed = true
    _deferred = null
    notify()
  })
}

export function getInstallState() {
  return { deferred: _deferred, installed: _installed }
}

// Fire the native install dialog. A deferred prompt can only be used ONCE, so it's
// cleared immediately. Returns the outcome ('accepted' | 'dismissed') or null.
export async function promptInstall() {
  const evt = _deferred
  if (!evt) return null
  _deferred = null
  notify()
  try {
    evt.prompt()
    const choice = await evt.userChoice
    return choice?.outcome || null
  } catch {
    return null
  }
}

export function subscribeInstall(fn) {
  _subs.add(fn)
  return () => { _subs.delete(fn) }
}
