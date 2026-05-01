import { useState, useEffect } from 'react'
import { UserPlus, AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import Input from './Input'
import AddressAutocomplete from './AddressAutocomplete'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import { useToast } from '../../contexts/ToastContext'

const EMPTY = { name: '', email: '', phone: '', address: '' }

/**
 * Quick "Add new client" modal — used as a nested modal from other create flows.
 *
 * Props:
 *   open, onClose
 *   onCreated(newClient) — called with the inserted row { id, name, email, phone, address }
 *   zLayer — defaults to 60 for nesting above a parent modal
 *   prefill — optional partial client to pre-populate
 */
export default function NewClientModal({ open, onClose, onCreated, zLayer = 60, prefill }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  // Holds an existing client whose name matches what's being typed.
  // We surface it as a warning so the operator picks the existing
  // record instead of accidentally creating a duplicate.
  const [duplicate, setDuplicate] = useState(null)

  useEffect(() => {
    if (open) setForm({ ...EMPTY, ...(prefill || {}) })
    if (!open) setDuplicate(null)
  }, [open, prefill])

  // Live duplicate check — debounced via the natural cadence of typing.
  // If a client with the same name (case-insensitive, trimmed) already
  // exists for this business, capture it so we can surface a warning
  // and offer "Use existing" instead of inserting a duplicate.
  useEffect(() => {
    if (!open || !business?.id) { setDuplicate(null); return }
    const name = form.name.trim()
    if (name.length < 2) { setDuplicate(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, email, phone, address')
        .eq('business_id', business.id)
        .ilike('name', name)
        .limit(1)
      if (cancelled) return
      const match = (data || []).find(c => c.name.trim().toLowerCase() === name.toLowerCase())
      setDuplicate(match || null)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, business?.id, form.name])

  function useExisting() {
    if (!duplicate) return
    onCreated?.(duplicate)
    onClose?.()
  }

  async function handleCreate() {
    if (!form.name.trim() || !business?.id) return
    // Belt-and-braces: even if the operator dismisses the warning by
    // continuing to type past it, do one last check on submit. If a
    // duplicate exists, refuse to insert.
    const trimmed = form.name.trim()
    setSaving(true)
    try {
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name, email, phone, address')
        .eq('business_id', business.id)
        .ilike('name', trimmed)
        .limit(5)
      const match = (existing || []).find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase())
      if (match) {
        // Show the warning so the operator can decide — never silently
        // create the dup.
        setDuplicate(match)
        setSaving(false)
        return
      }

      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: trimmed,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
      }).select('id, name, email, phone, address').single()
      if (error) throw error
      onCreated?.(data)
      onClose?.()
    } catch (err) {
      console.error('Create client error:', err)
      toast.error(err?.message || 'Failed to create client')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Client" size="md" zLayer={zLayer}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center">
            <UserPlus className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Quick-add a new client</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">You can edit full details later</p>
          </div>
        </div>

        <Input label="Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Sarah Chen" autoFocus required />

        {/* Duplicate warning — shown live as the operator types. The
            operator can either pick the existing client or change the
            name to something distinct. */}
        {duplicate && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" strokeWidth={2.25} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  A client named "{duplicate.name}" already exists
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5 truncate">
                  {duplicate.email || duplicate.phone || duplicate.address || 'No contact info'}
                </p>
                <button
                  type="button"
                  onClick={useExisting}
                  className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                >
                  Use existing client
                </button>
              </div>
            </div>
          </div>
        )}

        <Input label="Email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
        <Input label="Phone" type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="04XX XXX XXX" />
        <AddressAutocomplete
          label="Address"
          value={form.address}
          onChange={v => setForm(p => ({ ...p, address: v }))}
          onSelect={({ address }) => setForm(p => ({ ...p, address }))}
          placeholder="Start typing a street address..."
        />

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button
            onClick={handleCreate}
            loading={saving}
            disabled={!form.name.trim() || !!duplicate}
            className="flex-1"
          >
            {duplicate ? 'Name already taken' : 'Create Client'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
