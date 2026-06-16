// Single-writer guard for the scheduling cache.
//
// pools.next_due_at and recurring_job_profiles.next_generation_at are owned
// SOLELY by src/lib/recomputePoolNextDue.js (recomputePoolNextDue +
// setPoolNextDue). This script fails the build if ANY other file assigns
// either column as an object-literal key — whether that object goes straight
// into a .insert()/.update()/.upsert() or is built by a helper (e.g.
// buildPoolPayload) and SPREAD into a DB call elsewhere. Catching the key at
// its DEFINITION closes the spread-variable hole that an ".update/.insert-arg
// only" scan would miss (a real such hole shipped via buildPoolPayload before
// this was broadened).
//
// Wired as the npm `prebuild` script → runs on `npm run build` (exactly what
// Cloudflare runs to deploy), so a violation blocks the deploy. The same
// script drops into CI unchanged if a PR flow is adopted later.
//
// LEGITIMATE non-DB uses — React form state, setState, and the
// `{ ...pool, next_due_at }` projections Schedule.jsx feeds to poolToStop —
// are exempted with an inline `single-writer-ok` marker on the SAME line.
// That keeps every exemption explicit and auditable rather than silently
// pattern-excluded, and (per the design review) avoids the false-negative of
// a narrow call-site scan.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src')
const ALLOWLIST = new Set(['recomputePoolNextDue.js']) // the single writer
// An object-literal key assignment for either guarded column (optionally
// quoted). Matches the key wherever it's defined, so a payload builder that
// later gets spread into .insert()/.update()/.upsert() is still caught.
const GUARDED = /['"]?(next_due_at|next_generation_at)['"]?\s*:/
const MARKER = 'single-writer-ok'

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const violations = []
for (const file of walk(SRC)) {
  if (ALLOWLIST.has(basename(file))) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const hit = line.match(GUARDED)
    if (hit && !line.includes(MARKER)) {
      violations.push(`${file.replace(SRC, 'src')}:${i + 1}  ${hit[1]}:  ${line.trim().slice(0, 90)}`)
    }
  })
}

if (violations.length) {
  console.error('\n✖ Single-writer guard FAILED — next_due_at / next_generation_at')
  console.error('  may only be assigned inside src/lib/recomputePoolNextDue.js.')
  console.error('  Found assignment(s) elsewhere:\n')
  for (const v of violations) console.error('   ' + v)
  console.error('\n  • Genuine DB write? Route it through recomputePoolNextDue()')
  console.error('    or setPoolNextDue() (both live in the allowlisted module).')
  console.error('  • In-memory React state / projection (NOT a DB write)? Append')
  console.error('    an inline /* single-writer-ok */ marker on the same line.\n')
  process.exit(1)
}

console.log('✓ Single-writer guard passed (next_due_at / next_generation_at owned by recomputePoolNextDue.js)')
