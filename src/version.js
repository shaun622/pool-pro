// App version shown in the footers. BUILD is AUTO-INCREMENTED by one on every
// commit via the pre-commit hook (.githooks/pre-commit -> scripts/bump-version.mjs).
// Don't edit BUILD by hand — bump happens automatically at commit time.
export const BUILD = 59
export const APP_VERSION = `v1.0.${String(BUILD).padStart(2, '0')}`
