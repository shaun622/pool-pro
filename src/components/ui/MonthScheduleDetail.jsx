import { fmtDay, ymd } from '../../lib/fulfilment'

// Presentational drill-down body for a pool's month: the dated "Scheduled this
// month" list (each occurrence's status) + the "Extra visits" one-offs. Shared
// by the technician report and the client profile so they stay identical.
// Data comes from poolMonthDetail() in lib/fulfilment.
export default function MonthScheduleDetail({ occurrences = [], extras = [] }) {
  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">Scheduled this month</p>
      {occurrences.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">No scheduled visits.</p>
      ) : (
        <ul className="space-y-1">
          {occurrences.map(o => (
            <li key={o.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700 dark:text-gray-300 tabular-nums shrink-0">{fmtDay(o.date)}</span>
              <span className="text-right min-w-0 truncate">
                {o.status === 'done' && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ Done{o.rec && ymd(o.rec.serviced_at) !== o.date ? ` · ${fmtDay(o.rec.serviced_at)}` : ''}{o.rec?.technician_name ? ` · ${o.rec.technician_name}` : ''}
                  </span>
                )}
                {o.status === 'unable' && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    ⚠ Unable{o.rec?.unable_reason ? ` · ${o.rec.unable_reason}` : ''}{o.rec?.technician_name ? ` · ${o.rec.technician_name}` : ''}
                  </span>
                )}
                {o.status === 'skipped' && <span className="text-gray-400 dark:text-gray-500">Skipped</span>}
                {o.status === 'missed' && <span className="text-red-600 dark:text-red-400 font-medium">Missed</span>}
                {o.status === 'due' && <span className="text-amber-600 dark:text-amber-400 font-medium">Due today</span>}
                {o.status === 'upcoming' && <span className="text-gray-400 dark:text-gray-500">Upcoming</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {extras.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-3 mb-1.5">Extra visits</p>
          <ul className="space-y-1">
            {extras.map(e => (
              <li key={e.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700 dark:text-gray-300 tabular-nums shrink-0">{fmtDay(e.servicedAt)}</span>
                <span className="text-violet-600 dark:text-violet-400 font-medium">One-off{e.tech ? ` · ${e.tech}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
