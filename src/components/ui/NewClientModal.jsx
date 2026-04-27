import { useState, useEffect } from 'react'
import { UserPlus } from 'lucide-react'
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

  useEffect(() => {
    if (open) setForm({ ...EMPTY, ...(prefill || {}) })
  }, [open, prefill])

  async function handleCreate() {
    if (!form.name.trim() || !business?.id) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('clients').insert({
        business_id: business.id,
        name: form.name.trim(),
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
          <Button onClick={handleCreate} loading={saving} disabled={!form.name.trim()} className="flex-1">
            Create Client
          </Button>
        </div>
      </div>
    </Modal>
  )
}
