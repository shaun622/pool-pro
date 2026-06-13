import { useState, useEffect } from 'react'
import { Droplet } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import PoolFormFields, { emptyPool, buildPoolUpdatePayload } from '../PoolFormFields'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'

/**
 * Edit an existing pool's attributes (name, address, type, shape, volume,
 * equipment, access notes). Mirrors NewPoolModal but UPDATEs instead of
 * inserts, and renders PoolFormFields with showSchedule={false} so it
 * never touches the pool's live schedule (next_due_at / schedule_frequency
 * stay owned by the recurring flow + the ClientDetail Schedule modal).
 *
 * Props:
 *   open, onClose
 *   pool — the pool row to edit (must include id + current fields)
 *   onSaved(updatedPool) — called with the refreshed row after a successful update
 *   zLayer — defaults to 60 for nesting above a parent modal
 */
export default function EditPoolModal({ open, onClose, pool, onSaved, zLayer = 60 }) {
  const toast = useToast()
  const [poolForm, setPoolForm] = useState(emptyPool)
  const [saving, setSaving] = useState(false)

  // Hydrate the form from the pool whenever the modal opens (or the target
  // pool changes). equipment is jsonb → flatten back to the form's
  // pump_model / filter_type / heater fields.
  useEffect(() => {
    if (!open || !pool) return
    const eq = pool.equipment || {}
    setPoolForm({
      ...emptyPool,
      name: pool.name || '',
      address: pool.address || '',
      latitude: pool.latitude ?? null,
      longitude: pool.longitude ?? null,
      sameAsClient: false,
      type: pool.type || 'chlorine',
      volume_litres: pool.volume_litres ?? '',
      shape: pool.shape || 'rectangular',
      access_notes: pool.access_notes || '',
      pump_model: eq.pump_model || '',
      filter_type: eq.filter_type || '',
      heater: eq.heater || '',
    })
  }, [open, pool?.id])

  async function handleSave() {
    if (!poolForm.address.trim() || !pool?.id) return
    setSaving(true)
    try {
      const payload = await buildPoolUpdatePayload(poolForm)
      const { data, error } = await supabase
        .from('pools')
        .update(payload)
        .eq('id', pool.id)
        .select('*, clients(name, email)')
        .single()
      if (error) throw error
      onSaved?.(data)
      onClose?.()
    } catch (err) {
      console.error('Update pool error:', err)
      toast.error(err?.message || 'Failed to update pool')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Pool" size="md" zLayer={zLayer}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center">
            <Droplet className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Update this pool's details</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Schedule is managed from the recurring service</p>
          </div>
        </div>

        <PoolFormFields poolForm={poolForm} setPoolForm={setPoolForm} clientAddress="" showSchedule={false} />

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={!poolForm.address.trim()} className="flex-1">
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
