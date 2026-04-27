import { useState, useEffect } from 'react'
import { Droplet } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import PoolFormFields, { emptyPool, buildPoolPayload } from '../PoolFormFields'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import { useToast } from '../../contexts/ToastContext'

/**
 * Quick "Add new pool" modal — used as a nested modal from other create flows.
 *
 * Props:
 *   open, onClose
 *   clientId — required to associate the pool to a client
 *   clientAddress — optional, used as default for "same as client" toggle
 *   onCreated(newPool) — called with { id, address, ... }
 *   zLayer — defaults to 60 for nesting above a parent modal
 */
export default function NewPoolModal({ open, onClose, clientId, clientAddress, onCreated, zLayer = 60 }) {
  const { business } = useBusiness()
  const toast = useToast()
  const [poolForm, setPoolForm] = useState(emptyPool)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setPoolForm(emptyPool)
  }, [open])

  async function handleCreate() {
    if (!poolForm.address.trim() || !business?.id || !clientId) return
    setSaving(true)
    try {
      const payload = await buildPoolPayload(poolForm)
      const { data, error } = await supabase.from('pools').insert({
        ...payload,
        client_id: clientId,
        business_id: business.id,
      }).select('id, address').single()
      if (error) throw error
      onCreated?.(data)
      onClose?.()
    } catch (err) {
      console.error('Create pool error:', err)
      toast.error(err?.message || 'Failed to create pool')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Pool" size="md" zLayer={zLayer}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center">
            <Droplet className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Add a pool for this client</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Equipment & schedule details are optional</p>
          </div>
        </div>

        <PoolFormFields poolForm={poolForm} setPoolForm={setPoolForm} clientAddress={clientAddress || ''} />

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!poolForm.address.trim()} className="flex-1">
            Add Pool
          </Button>
        </div>
      </div>
    </Modal>
  )
}
