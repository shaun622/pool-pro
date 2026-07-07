// Increment the BUILD number in src/version.js by 1.
// Invoked by the pre-commit hook so the displayed app version bumps by .01 on
// every commit (v1.0.00 -> v1.0.01 -> v1.0.02 ...). Best-effort: prints nothing
// and exits 0 on any problem so it can never block a commit.
import { readFileSync, writeFileSync } from 'node:fs'

try {
  const path = new URL('../src/version.js', import.meta.url)
  const src = readFileSync(path, 'utf8')
  const next = src.replace(/export const BUILD = (\d+)/, (_, n) => `export const BUILD = ${Number(n) + 1}`)
  if (next !== src) writeFileSync(path, next)
} catch {
  // never block the commit
}
