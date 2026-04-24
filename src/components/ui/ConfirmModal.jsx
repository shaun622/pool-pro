import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import { cn } from '../../lib/utils'

/**
 * Confirmation modal with optional async action.
 *
 * Props:
 *   open, onClose
 *   title, description
 *   onConfirm — async fn; modal closes on success
 *   confirmLabel — default "Delete" if destructive, else "Confirm"
 *   destructive — boolean, styles confirm button red and icon red
 *   icon — optional Lucide icon component (defaults to AlertTriangle)
 *   zLayer — for nesting above other modals (default 60)
 */
export default function ConfirmModal({
  open,
  onClose,
  title,
  description,
  onConfirm,
  confirmLabel,
  destructive = false,
  icon: Icon = AlertTriangle,
  zLayer = 60,
}) {
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      await onConfirm?.()
      onClose?.()
    } catch (err) {
      console.error('Confirm action failed:', err)
      alert(err?.message || 'Action failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} size="sm" zLayer={zLayer}>
      <div className="flex justify-center pt-2">
        <div className={cn(
          'w-14 h-14 rounded-2xl flex items-center justify-center',
          destructive
            ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
            : 'bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400',
        )}>
          <Icon className="w-7 h-7" strokeWidth={2} />
        </div>
      </div>
      <div className="text-center mt-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} disabled={running} className="flex-1">Cancel</Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          onClick={run}
          loading={running}
          className="flex-1"
        >
          {confirmLabel ?? (destructive ? 'Delete' : 'Confirm')}
        </Button>
      </div>
    </Modal>
  )
}
