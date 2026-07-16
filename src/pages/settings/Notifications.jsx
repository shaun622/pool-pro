import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { useBusiness } from '../../hooks/useBusiness'
import { useBranches } from '../../hooks/useBranches'
import { useToast } from '../../contexts/ToastContext'
import Button from '../../components/ui/Button'
import {
  buildCustomerReport, buildAdminReport, SAMPLE_VISIT, DEFAULTS,
  CUSTOMER_SECTIONS, ADMIN_SECTIONS, PLACEHOLDERS,
} from '../../lib/serviceReportEmail'

/**
 * Settings → Notifications:
 *  1. Recipients — where the office copy goes (head office + branches).
 *  2. Email content — a live preview of the REAL customer + admin report emails,
 *     with editable wording (prefilled from the actual defaults), clickable
 *     placeholder chips, and per-section show/hide toggles. Saved to
 *     business.report_email_config and honored by the complete-service edge fn.
 */

// Prefill an editor side from saved config: wording = saved-or-default, toggles
// default to ON (a stored `false` hides that section).
function initSide(which, sections, saved = {}) {
  const d = DEFAULTS[which]
  const s = saved[which] || {}
  const out = {}
  for (const key of Object.keys(d)) out[key] = (s[key] != null && s[key] !== '') ? s[key] : d[key]
  const show = {}
  for (const sec of sections) show[sec.key] = s.show?.[sec.key] !== false
  out.show = show
  return out
}
function initForm(saved) {
  return {
    customer: initSide('customer', CUSTOMER_SECTIONS, saved),
    admin: initSide('admin', ADMIN_SECTIONS, saved),
  }
}

export default function Notifications() {
  const { business, updateBusiness } = useBusiness()
  const { branches, loading, updateBranch } = useBranches()
  const toast = useToast()

  const [form, setForm] = useState(() => initForm(business?.report_email_config))
  const [saving, setSaving] = useState(false)
  const fieldRefs = useRef({})            // `${side}.${key}` -> input/textarea el
  const focusedKey = useRef({ customer: 'intro', admin: 'intro' })

  useEffect(() => { setForm(initForm(business?.report_email_config)) }, [business?.id, business?.report_email_config])

  function setField(side, key, value) {
    setForm(f => ({ ...f, [side]: { ...f[side], [key]: value } }))
  }
  function toggleSection(side, key) {
    setForm(f => ({ ...f, [side]: { ...f[side], show: { ...f[side].show, [key]: !f[side].show[key] } } }))
  }
  function resetSide(side, sections) {
    setForm(f => ({ ...f, [side]: initSide(side, sections, {}) }))
  }
  function insertToken(side, token) {
    const key = focusedKey.current[side] || 'intro'
    const el = fieldRefs.current[`${side}.${key}`]
    const cur = form[side][key] ?? ''
    let next, caret
    if (el && typeof el.selectionStart === 'number') {
      const a = el.selectionStart, b = el.selectionEnd
      next = cur.slice(0, a) + token + cur.slice(b); caret = a + token.length
    } else { next = cur + token; caret = next.length }
    setField(side, key, next)
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }

  async function toggleBranch(b) {
    try { await updateBranch(b.id, { notify_enabled: !b.notify_enabled }) } catch { /* re-render */ }
  }
  async function save() {
    setSaving(true)
    try {
      await updateBusiness({ report_email_config: form })
      toast.success('Email content saved')
    } catch (err) {
      toast.error(err?.message || 'Could not save — has the report_email_config migration been applied?')
    } finally { setSaving(false) }
  }

  const previewData = { ...SAMPLE_VISIT, business: business || SAMPLE_VISIT.business }
  const customerPreview = buildCustomerReport(previewData, form)
  const adminPreview = buildAdminReport(previewData, form)

  // ── Small building blocks ──────────────────────────────────────────────────
  const labelCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1'
  function Field({ side, name, label, textarea, rows = 3, caption }) {
    const common = {
      ref: el => { fieldRefs.current[`${side}.${name}`] = el },
      value: form[side][name] ?? '',
      onFocus: () => { focusedKey.current[side] = name },
      onChange: e => setField(side, name, e.target.value),
      className: 'input w-full' + (textarea ? ' resize-y' : ''),
    }
    return (
      <div className="mb-3">
        <label className={labelCls}>{label}</label>
        {textarea ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
        {caption && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{caption}</p>}
      </div>
    )
  }
  function Chips({ side }) {
    return (
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PLACEHOLDERS.map(p => (
          <button
            key={p.token}
            type="button"
            title={p.label}
            onMouseDown={e => e.preventDefault()}   // keep the field focused
            onClick={() => insertToken(side, p.token)}
            className="px-2 py-1 rounded-md text-[11px] font-mono bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 hover:bg-pool-100 dark:hover:bg-pool-900/60 transition-colors"
          >
            {p.token}
          </button>
        ))}
      </div>
    )
  }
  function Toggles({ side, sections }) {
    return (
      <div className="mb-3">
        <p className={labelCls}>Sections</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {sections.map(sec => (
            <label key={sec.key} className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form[side].show[sec.key] !== false}
                onChange={() => toggleSection(side, sec.key)}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500/30"
              />
              {sec.label}
            </label>
          ))}
        </div>
      </div>
    )
  }
  function Preview({ subject, html }) {
    return (
      <div className="mt-3">
        <p className={labelCls}>Live preview <span className="font-normal normal-case text-gray-400">(your branding · sample visit)</span></p>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 truncate">
            <span className="font-semibold text-gray-400 dark:text-gray-500">Subject:</span> {subject}
          </div>
          <iframe title="Email preview" srcDoc={html} className="w-full block bg-white" style={{ height: 460, border: 0 }} />
        </div>
      </div>
    )
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
          {branches.map(b => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" checked={!!b.notify_enabled} onChange={() => toggleBranch(b)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500/30 shrink-0" />
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
      </div>

      {/* ── Email content ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email content</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Edit the wording and turn sections on/off. Data (readings, photos, tasks, dates) is filled in
              automatically per visit. The preview uses your real branding with a sample visit.
            </p>
          </div>
          <Button onClick={save} loading={saving}>Save email content</Button>
        </div>

        {/* Customer */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">Customer report</p>
            <button onClick={() => resetSide('customer', CUSTOMER_SECTIONS)} className="text-xs font-medium text-gray-500 hover:text-pool-600 dark:hover:text-pool-400">Reset to default</button>
          </div>
          {Chips({ side: 'customer' })}
          {Field({ side: 'customer', name: 'subject', label: 'Subject' })}
          {Field({ side: 'customer', name: 'intro', label: 'Intro message', textarea: true, caption: 'A custom intro replaces the wording for ALL completed visits — including the built-in one-off-visit variant.' })}
          {Field({ side: 'customer', name: 'signoff', label: 'Sign-off (optional)', textarea: true, rows: 2 })}
          <div className="grid grid-cols-2 gap-3">
            {Field({ side: 'customer', name: 'portalButtonLabel', label: 'Portal button label' })}
            {Field({ side: 'customer', name: 'historyButtonLabel', label: 'History button label' })}
          </div>
          {Toggles({ side: 'customer', sections: CUSTOMER_SECTIONS })}
          {Preview({ subject: customerPreview.subject, html: customerPreview.html })}
        </div>

        {/* Admin */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">Admin summary <span className="font-normal text-xs text-gray-400">(internal office copy)</span></p>
            <button onClick={() => resetSide('admin', ADMIN_SECTIONS)} className="text-xs font-medium text-gray-500 hover:text-pool-600 dark:hover:text-pool-400">Reset to default</button>
          </div>
          {Chips({ side: 'admin' })}
          {Field({ side: 'admin', name: 'subject', label: 'Subject' })}
          {Field({ side: 'admin', name: 'intro', label: 'Intro message', textarea: true })}
          {Field({ side: 'admin', name: 'signoff', label: 'Sign-off (optional)', textarea: true, rows: 2 })}
          {Toggles({ side: 'admin', sections: ADMIN_SECTIONS })}
          {Preview({ subject: adminPreview.subject, html: adminPreview.html })}
        </div>

        <div className="mt-4">
          <Button onClick={save} loading={saving}>Save email content</Button>
        </div>
      </div>
    </div>
  )
}
