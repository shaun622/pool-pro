import { useState, useEffect } from 'react'
import { UserPlus, AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import Input, { TextArea } from './Input'
import AddressAutocomplete from './AddressAutocomplete'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import { useToast } from '../../contexts/ToastContext'

// lat/lng are transient — they drive the inline map preview only. The
// clients table has no coordinate columns, so they're not persisted.
const EMPTY = { name: '', email: '', phone: '', address: '', notes: '', lat: null, lng: null }

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

  // Live duplicate check — keyed on email + phone, NOT name. A pool
  // company can legitimately have two clients named the same ("John
  // Smith"), but two clients sharing an email or phone is the strong
  // signal that they're the same person and someone fat-fingered a
  // new record. Email match is case-insensitive trimmed; phone match
  // strips all non-digits so "0400 123 456" and "0400123456" collide.
  useEffect(() => {
    if (!open || !business?.id) { setDuplicate(null); return }
    const email = form.email.trim().toLowerCase()
    const phone = (form.phone || '').replace(/\D/g, '')
    if (!email && phone.length < 6) { setDuplicate(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      // Build an OR query — match on email if provided, on phone if
      // provided, on either when both are.
      const filters = []
      if (email) filters.push(`email.ilike.${email}`)
      if (phone.length >= 6) filters.push(`phone.ilike.%${phone.slice(-8)}%`)
      if (filters.length === 0) return
      const { data } = await supabase
        .from('clients')
        .select('id, name, email, phone, address')
        .eq('business_id', business.id)
        .or(filters.join(','))
        .limit(10)
      if (cancelled) return
      // Tighten match in JS — DB filter is loose (ilike on phone uses
      // a substring; could match shorter dial-out prefixes). Compare
      // strictly here.
      const match = (data || []).find(c => {
        if (email && (c.email || '').trim().toLowerCase() === email) return true
        if (phone.length >= 6) {
          const cp = (c.phone || '').replace(/\D/g, '')
          if (cp && (cp === phone || cp.endsWith(phone) || phone.endsWith(cp))) return true
        }
        return false
      })
      setDuplicate(match || null)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, business?.id, form.email, form.phone])

  function useExisting() {
    if (!duplicate) return
    onCreated?.(duplicate)
    onClose?.()
  }

  async function handleCreate() {
    if (!form.name.trim() || !business?.id) return
    const trimmedName  = form.name.trim()
    const trimmedEmail = form.email.trim().toLowerCase()
    const trimmedPhone = (form.phone || '').replace(/\D/g, '')
    setSaving(true)
    try {
      // Belt-and-braces dup check on submit — by email or phone, NOT
      // name. If we find one, surface it as the warning and don't insert.
      if (trimmedEmail || trimmedPhone.length >= 6) {
        const filters = []
        if (trimmedEmail) filters.push(`email.ilike.${trimmedEmail}`)
        if (trimmedPhone.length >= 6) filters.push(`phone.ilike.%${trimmedPhone.slice(-8)}%`)
        const { data: existing } = await supabase
          .from('clients')
          .select('id, name, email, phone, address')
          .eq('business_id', business.id)
          .or(filters.join(','))
          .limit(10)
        const match = (existing || []).find(c => {
          if (trimmedEmail && (c.email || '').trim().toLowerCase() === trimmedEmail) return true
          if (trimmedPhone.length >= 6) {
            const cp = (c.phone || '').replace(/\D/g, '')
            if (cp && (cp === trimmedPhone || cp.endsWith(trimmedPhone) || trimmedPhone.endsWith(cp))) return true
          }
          return false
        })
        if (match) {
          setDuplicate(match)
          setSaving(false)
          return
        }
      }

      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: trimmedName,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        notes: (form.notes || '').trim() || null,
      }).select('id, name, email, phone, address, notes').single()
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

        {/* Duplicate warning — shown live as the operator types email
            or phone. Email and phone are treated as the unique keys —
            two clients sharing either is the strong signal that they're
            the same person. The operator can pick the existing record
            or change contact info to something distinct. */}
        {duplicate && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" strokeWidth={2.25} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  A client with this email or phone already exists: "{duplicate.name}"
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-0.5 truncate">
                  {[duplicate.email, duplicate.phone].filter(Boolean).join(' · ') || duplicate.address || 'No contact info'}
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
          // Free typing clears the pin so a stale location isn't shown;
          // picking a suggestion sets the coords and reveals the map.
          onChange={v => setForm(p => ({ ...p, address: v, lat: null, lng: null }))}
          onSelect={({ address, lat, lng }) => setForm(p => ({ ...p, address, lat, lng }))}
          placeholder="Start typing a street address..."
          mapPreview
          lat={form.lat}
          lng={form.lng}
        />
        <TextArea
          label="Notes"
          value={form.notes}
          onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
          placeholder="Any additional notes..."
        />

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button
            onClick={handleCreate}
            loading={saving}
            disabled={!form.name.trim() || !!duplicate}
            className="flex-1"
          >
            {duplicate ? 'Email or phone already used' : 'Create Client'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
