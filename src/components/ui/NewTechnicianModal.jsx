import { useState, useEffect } from 'react'
import { Users } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import Input, { Select } from './Input'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import { useToast } from '../../contexts/ToastContext'

const ROLE_OPTIONS = [
  { value: 'tech', label: 'Technician' },
  { value: 'admin', label: 'Admin' },
]

const EMPTY = { name: '', email: '', phone: '', role: 'tech' }

/**
 * Quick "Add new technician" modal — used as a nested modal from other create flows.
 *
 * Props:
 *   open, onClose
 *   onCreated(newTech) — called with { id, name, role, ... }
 *   zLayer — defaults to 60 for nesting above a parent modal
 */
export default function NewTechnicianModal({ open, onClose, onCreated, zLayer = 60 }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(EMPTY)
  }, [open])

  async function handleCreate() {
    if (!form.name.trim() || !business?.id) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('staff_members').insert({
        business_id: business.id,
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role,
        is_active: true,
      }).select('id, name, role, email, phone').single()
      if (error) throw error
      onCreated?.(data)
      onClose?.()
    } catch (err) {
      console.error('Create technician error:', err)
      toast.error(err?.message || 'Failed to create technician')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Technician" size="md" zLayer={zLayer}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 flex items-center justify-center">
            <Users className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Quick-add a team member</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Set their login details later in Staff settings</p>
          </div>
        </div>

        <Input label="Name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" autoFocus required />
        <Select label="Role" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} options={ROLE_OPTIONS} />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
        <Input label="Phone" type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="04XX XXX XXX" />

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!form.name.trim()} className="flex-1">
            Add Technician
          </Button>
        </div>
      </div>
    </Modal>
  )
}
