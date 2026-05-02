import Input from './Input'
import {
  RECURRENCE_OPTIONS,
  DAYS_OF_WEEK,
  expectedDayCount,
  isMultiDayWeekly,
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
 * The "first service date" is OWNED BY THE PARENT — most parents
 * already have a date input as a primary form field, and rendering
 * a second one inside the picker would create two sources of truth.
 * Parent passes `firstDate` (YYYY-MM-DD or empty) so the picker can
 * derive the locked weekday in bi/tri-weekly chip mode and the Nth
 * occurrence label in monthly mode.
 *
 * Value shape:
 *   { rule, extraDays, customDays }
 *     rule:       'weekly'|'fortnightly'|'bi_weekly'|'tri_weekly'|'monthly'|'custom'|...
 *     extraDays:  int[] of weekdays 0..6 — the operator's *additional*
 *                 picks beyond the anchor day (only used by bi/tri-weekly)
 *     customDays: number — interval for `custom`
 *
 * onChange receives the next full value object — the picker resets
 * extraDays whenever the rule flips so a stale 2-day pick from
 * bi-weekly doesn't leak into tri-weekly's expected count.
 */
export default function RecurrencePicker({ value, onChange, firstDate }) {
  const rule = value?.rule || 'weekly'
  const extraDays = value?.extraDays || []
  const customDays = value?.customDays ?? 7

  function changeRule(newRule) {
    onChange({ rule: newRule, extraDays: [], customDays })
  }

  function setCustomDays(n) {
    onChange({ rule, extraDays, customDays: n })
  }

  function toggleExtraDay(day) {
    const expected = expectedDayCount(rule)
    if (expected == null) return
    const cap = expected - 1
    let next
    if (extraDays.includes(day)) {
      next = extraDays.filter(d => d !== day)
    } else if (extraDays.length >= cap) {
      next = extraDays
    } else {
      next = [...extraDays, day].sort((a, b) => a - b)
    }
    onChange({ rule, extraDays: next, customDays })
  }

  const anchorWd = firstDate
    ? new Date(firstDate + 'T00:00:00').getDay()
    : null

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

      {/* Multi-day weekly chip grid. Anchor weekday is locked-on; the
          operator picks (expected - 1) extras. Chips disable when the
          cap is reached so deselecting is the only way past. */}
      {isMultiDayWeekly(rule) && firstDate && anchorWd != null && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            Plus pick {expectedDayCount(rule) - 1} more day{expectedDayCount(rule) - 1 === 1 ? '' : 's'}
            <span className="ml-2 text-gray-400 dark:text-gray-500">
              ({extraDays.length}/{expectedDayCount(rule) - 1})
            </span>
          </label>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS_OF_WEEK.map(d => {
              const isAnchor = d.value === anchorWd
              const active = isAnchor || extraDays.includes(d.value)
              const cap = expectedDayCount(rule) - 1
              const atCap = !active && extraDays.length >= cap
              return (
                <button key={d.value} type="button"
                  onClick={() => !isAnchor && toggleExtraDay(d.value)}
                  disabled={isAnchor || atCap}
                  className={cn(
                    'py-2 rounded-lg text-xs font-semibold transition-all min-h-[40px]',
                    active
                      ? 'bg-pool-500 text-white shadow-sm'
                      : atCap
                        ? 'bg-gray-50 dark:bg-gray-900 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100',
                    isAnchor && 'cursor-default ring-2 ring-pool-300 dark:ring-pool-700',
                  )}
                  title={isAnchor ? 'First service date — change the date to move' : undefined}>
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Preview line. Empty firstDate is fine — operator might be
          editing only the rule first. */}
      {firstDate ? (
        <p className="text-xs text-pool-700 dark:text-pool-300 bg-pool-50 dark:bg-pool-950/40 rounded-lg px-3 py-2">
          {derivedScheduleLabel(rule, firstDate, extraDays, customDays) || 'Pick a first service date to see the schedule.'}
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">
          Pick a first service date above to set the schedule.
        </p>
      )}
    </div>
  )
}
