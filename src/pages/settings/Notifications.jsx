import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useBusiness } from '../../hooks/useBusiness'
import { useBranches } from '../../hooks/useBranches'
import { useToast } from '../../contexts/ToastContext'
import Input, { TextArea } from '../../components/ui/Input'
import Button from '../../components/ui/Button'

/**
 * Settings → Notifications.
 *  1. Where the OFFICE copy of a service report is emailed (head office + branches).
 *  2. Customisable wording (subject / intro / sign-off) for the customer report
 *     and the admin summary — stored on business.report_email_config, read by the
 *     complete-service edge function. Blank fields fall back to the built-in copy.
 * Renders inside the Settings pane <Outlet />.
 */
const EMPTY = { subject: '', intro: '', signoff: '' }
const TOKENS = '{client_name} · {pool_address} · {business_name} · {technician_name} · {next_service_date}'

function EmailEditor({ title, description, value, onChange, subjectPlaceholder, introPlaceholder }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 space-y-3">
      <div>
        <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <Input
        label="Subject"
        value={value.subject}
        onChange={e => onChange({ ...value, subject: e.target.value })}
        placeholder={subjectPlaceholder}
      />
      <TextArea
        label="Intro message"
        rows={3}
        value={value.intro}
        onChange={e => onChange({ ...value, intro: e.target.value })}
        placeholder={introPlaceholder}
      />
      <TextArea
        label="Sign-off (optional)"
        rows={2}
        value={value.signoff}
        onChange={e => onChange({ ...value, signoff: e.target.value })}
        placeholder="e.g. Thanks for choosing {business_name}! Any questions, just reply."
      />
    </div>
  )
}

export default function Notifications() {
  const { business, updateBusiness } = useBusiness()
  const { branches, loading, updateBranch } = useBranches()
  const toast = useToast()

  const [cfg, setCfg] = useState({ customer: { ...EMPTY }, admin: { ...EMPTY } })
  const [saving, setSaving] = useState(false)

  // Hydrate the editors from the saved config whenever the business loads/changes.
  useEffect(() => {
    const c = business?.report_email_config || {}
    setCfg({
      customer: { ...EMPTY, ...(c.customer || {}) },
      admin: { ...EMPTY, ...(c.admin || {}) },
    })
  }, [business?.id, business?.report_email_config])

  async function toggle(b) {
    try { await updateBranch(b.id, { notify_enabled: !b.notify_enabled }) } catch { /* surfaced via re-render */ }
  }

  async function saveCopy() {
    setSaving(true)
    try {
      await updateBusiness({ report_email_config: cfg })
      toast.success('Email content saved')
    } catch (err) {
      toast.error(err?.message || 'Could not save email content')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Recipients ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Where the office copy of each service report is emailed. Customers always receive their own
          report at their own email — these are the internal copies.
        </p>

        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-5 mb-3">Service reports are emailed to</h4>
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

      {/* ── Email content ─────────────────────────────────────────── */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email content</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Customise the wording of the two service-report emails. Leave a field blank to use the default.
          The chemical readings, photos, tasks and next-service date are always added automatically.
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
          Placeholders (auto-filled per visit): <span className="font-mono">{TOKENS}</span>
        </p>

        <div className="space-y-4 mt-3">
          <EmailEditor
            title="Customer report"
            description="Sent to the customer after each completed service."
            value={cfg.customer}
            onChange={v => setCfg(c => ({ ...c, customer: v }))}
            subjectPlaceholder="Pool Service Complete — {pool_address}"
            introPlaceholder="Your pool at {pool_address} has been serviced. Here's a summary of everything we did today."
          />
          <EmailEditor
            title="Admin summary"
            description="The internal office copy sent to head office / the branch."
            value={cfg.admin}
            onChange={v => setCfg(c => ({ ...c, admin: v }))}
            subjectPlaceholder="✅ {technician_name} completed {pool_address}"
            introPlaceholder="{technician_name} just completed a service at {pool_address} for {client_name}."
          />
        </div>

        <div className="mt-4">
          <Button onClick={saveCopy} loading={saving}>Save email content</Button>
        </div>
      </div>
    </div>
  )
}
