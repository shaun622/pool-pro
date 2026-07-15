import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useBusiness } from '../../hooks/useBusiness'
import { useBranches } from '../../hooks/useBranches'

/**
 * Settings → Notifications. Controls where the OFFICE copy of a service report
 * is emailed. Customers always receive their own report at their own email;
 * these are the internal copies. Head office always gets a copy; each branch is
 * an optional recipient for the clients assigned to it. Renders inside the
 * Settings pane <Outlet />.
 */
export default function Notifications() {
  const { business } = useBusiness()
  const { branches, loading, updateBranch } = useBranches()

  async function toggle(b) {
    try { await updateBranch(b.id, { notify_enabled: !b.notify_enabled }) } catch { /* surfaced via re-render */ }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Where the office copy of each service report is emailed. Customers always receive their own
          report at their own email — these are the internal copies.
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Service reports are emailed to</h4>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          {/* Head office — always on */}
          <li className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-xl bg-pool-50 dark:bg-pool-950/40 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-pool-600 dark:text-pool-400" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">Head office</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {business?.email || <>No email set — <Link to="/settings" className="text-pool-600 dark:text-pool-400 font-medium">add one in Business details</Link></>}
              </p>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">Always</span>
          </li>

          {/* Branches — each an optional recipient (for its own clients) */}
          {branches.map(b => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={!!b.notify_enabled}
                onChange={() => toggle(b)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500/30 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{b.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {b.email || <>No email set — <Link to="/settings/branches" className="text-pool-600 dark:text-pool-400 font-medium">add one under Branches</Link></>}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {!loading && branches.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic mt-3">
            No branches yet. Create one under <Link to="/settings/branches" className="text-pool-600 dark:text-pool-400 font-medium not-italic">Branches</Link> and it’ll appear here.
          </p>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          A report goes to head office plus the branch of the client it’s for — when that branch is ticked
          and has an email.
        </p>
      </div>
    </div>
  )
}
