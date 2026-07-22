import { useMemo } from 'react'
import Card from './ui/Card'
import { Phone, MessageCircle, UploadCloud, CheckCircle2 } from 'lucide-react'
import { useCrewSync } from '../hooks/useCrewSync'
import { cn } from '../lib/utils'

// Operator "Field sync" card: which technicians still have completed visits waiting to
// upload from their phone's offline outbox. Fed by useCrewSync (per-device heartbeat,
// aggregated per staff). Shows nothing until at least one device has reported.

const STALE_MS = 3 * 60 * 1000

function minutesAgo(iso) {
  if (!iso) return null
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

function statusLabel(s) {
  switch (s) {
    case 'failed': return { text: 'needs attention', tone: 'red' }
    case 'auth': return { text: 'sign-in needed', tone: 'red' }
    case 'wrong-org': return { text: 'wrong account', tone: 'red' }
    case 'stuck': return { text: 'stuck — retrying', tone: 'orange' }
    default: return { text: 'uploading', tone: 'amber' }
  }
}

// wa.me needs bare international digits; the crew's local 08xx numbers can't be
// normalised (no country column), so only offer WhatsApp for a +-prefixed number.
function waLink(phone) {
  const trimmed = String(phone || '').trim()
  if (!trimmed.startsWith('+')) return null
  const digits = trimmed.replace(/[^0-9]/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

export default function CrewSyncCard() {
  const crew = useCrewSync()
  const pending = useMemo(
    () => crew
      .filter(c => (c.pending_count || 0) > 0)
      .sort((a, b) => (a.oldest_pending_at || '').localeCompare(b.oldest_pending_at || '')),
    [crew],
  )

  // No devices reporting at all (e.g. solo operator, no field techs) → show nothing.
  if (!crew.length) return null

  if (!pending.length) {
    return (
      <Card className="!p-4 mb-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" strokeWidth={2.5} />
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-gray-100">Field sync</span> — all field visits uploaded
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="!p-5 mb-6 border-pool-200 dark:border-pool-900 bg-pool-50/40 dark:bg-pool-950/10">
      <div className="flex items-center gap-2 mb-4">
        <UploadCloud className="w-3.5 h-3.5 text-pool-500" strokeWidth={2.5} />
        <p className="text-xs font-semibold uppercase tracking-wider text-pool-600 dark:text-pool-400">Field sync — still uploading</p>
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pool-500 text-white text-[10px] font-bold tabular-nums">
          {pending.length}
        </span>
      </div>
      <ul className="space-y-1 -mx-2">
        {pending.map(c => {
          const queuedMin = minutesAgo(c.oldest_pending_at)
          const seenMin = minutesAgo(c.updated_at)
          const stale = c.updated_at && (Date.now() - new Date(c.updated_at).getTime()) > STALE_MS
          const st = statusLabel(c.outbox_status)
          const wa = waLink(c.staff_phone)
          return (
            <li key={c.staff_id} className="flex items-center gap-1 px-2 py-2 rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{c.staff_name || 'Technician'}</p>
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-pool-500 text-white text-[10px] font-bold tabular-nums">
                    {c.pending_count}
                  </span>
                  <span className={cn(
                    'text-[11px] font-medium',
                    st.tone === 'red' ? 'text-red-600 dark:text-red-400'
                      : st.tone === 'orange' ? 'text-orange-600 dark:text-orange-400'
                        : 'text-amber-600 dark:text-amber-400',
                  )}>
                    {st.text}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {c.pending_count === 1 ? '1 visit' : `${c.pending_count} visits`} queued{queuedMin != null ? ` · ${queuedMin}m` : ''}
                  {stale && (
                    <span className="text-orange-600 dark:text-orange-400"> · no signal from device for {seenMin}m</span>
                  )}
                </p>
                {stale && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Have them reopen the app on wifi to finish uploading.</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pr-1">
                {c.staff_phone && (
                  <a href={`tel:${c.staff_phone}`} aria-label="Call technician" className="w-8 h-8 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-pool-600 dark:text-pool-400 hover:border-pool-300">
                    <Phone className="w-4 h-4" strokeWidth={2} />
                  </a>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp technician" className="w-8 h-8 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-green-600 dark:text-green-400 hover:border-green-300">
                    <MessageCircle className="w-4 h-4" strokeWidth={2} />
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
