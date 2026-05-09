import Input from './Input'
import {
  RECURRENCE_OPTIONS,
  derivedScheduleLabel,
} from '../../lib/recurringScheduling'
import { cn } from '../../lib/utils'

/**
 * Date-first recurring picker, shared by every place in the app
 * where the operator picks a recurrence:
 *   - AddRecurringModal (new recurring service)
 *   - RecurringJobs edit modal
 *   - StopDetailModal job + pool edit forms
 *
 * Recurring services are SINGLE-DAY-PER-OCCURRENCE only. Multi-day
 * weekly rules (bi_weekly = 2/week, tri_weekly = 3/week) and the
 * companion chip-grid picker were removed — they caused recurring
 * "ghost day" projection bugs and the global meaning of "bi-weekly"
 * (every 2 weeks) clashed with the in-app meaning (twice a week).
 * Two services per week = two recurring profiles anchored on
 * different weekdays.
 *
 * The "first service date" is OWNED BY THE PARENT — most parents
 * already have a date input as a primary form field, and rendering
 * a second one inside the picker would create two sources of truth.
 * Parent passes `firstDate` (YYYY-MM-DD or empty) so the picker can
 * derive the Nth-occurrence label in monthly mode and the preview
 * line below the picker.
 *
 * Value shape:
 *   { rule, customDays }
 *     rule:       'weekly'|'fortnightly'|'monthly'|'6_weekly'|'quarterly'|'custom'
 *     customDays: number — interval for `custom`
 */
export default function RecurrencePicker({ value, onChange, firstDate }) {
  const rule = value?.rule || 'weekly'
  const customDays = value?.customDays ?? 7

  function changeRule(newRule) {
    onChange({ rule: newRule, customDays })
  }

  function setCustomDays(n) {
    onChange({ rule, customDays: n })
  }

  return (
    <div className="space-y-3">
      {/* Frequency pills */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Frequency</label>
        <div className="flex flex-wrap gap-1.5">
          {RECURRENCE_OPTIONS.map(opt => (
            <button key={opt.value} type="button" onClick={() => changeRule(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[36px]',
                rule === opt.value
                  ? 'bg-pool-500 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
              )}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {rule === 'custom' && (
        <Input
          label="Repeat every (days)"
          type="number"
          min="1"
          value={customDays}
          onChange={e => setCustomDays(e.target.value)}
          placeholder="e.g. 10"
        />
      )}

      {/* Preview line. Empty firstDate is fine — operator might be
          editing only the rule first. */}
      {firstDate ? (
        <p className="text-xs text-pool-700 dark:text-pool-300 bg-pool-50 dark:bg-pool-950/40 rounded-lg px-3 py-2">
          {derivedScheduleLabel(rule, firstDate, customDays) || 'Pick a first service date to see the schedule.'}
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">
          Pick a first service date above to set the schedule.
        </p>
      )}
    </div>
  )
}
