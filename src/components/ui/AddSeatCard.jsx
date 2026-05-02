import { useState } from 'react'
import { Plus, UserPlus } from 'lucide-react'
import Card from './Card'
import Button from './Button'
import { useBusiness } from '../../hooks/useBusiness'
import { usePlans } from '../../hooks/usePlans'
import { useToast } from '../../contexts/ToastContext'
import { supabase } from '../../lib/supabase'

/**
 * Inline "Add technician seat — $3/mo" card.
 *
 * Hits the same Stripe Pages Function as the Subscription page:
 *   POST /api/stripe/checkout
 *     - First time → redirect to Stripe Checkout to collect a card.
 *     - Subsequent calls → bumps the existing subscription quantity
 *       and the webhook flips `businesses.purchased_seats` to match.
 *
 * Hidden when the operator is on the trial plan (need a paid plan to
 * bolt seats on) or when an HQ admin staff_seat_override is active —
 * the override wins, so buying extras would be dead money.
 *
 * Used by the Subscription page and the Staff (Team & roles) page so
 * the operator can upgrade their seat count from the same place they
 * notice they're maxed out.
 */
export default function AddSeatCard() {
  const toast = useToast()
  const { business, staffLimit, refetch } = useBusiness()
  const { plansBySlug } = usePlans()
  const [addingSeat, setAddingSeat] = useState(false)

  const currentPlan = business?.plan || 'trial'
  const planMax = plansBySlug?.[currentPlan]?.max_staff ?? 0
  const purchasedSeats = business?.purchased_seats || 0
  const overrideActive = business?.staff_seat_override != null

  // Trial accounts and override-enforced businesses can't buy extra seats.
  if (currentPlan === 'trial' || overrideActive) return null

  async function handleAddSeat() {
    setAddingSeat(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error('Not signed in')
        return
      }
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Could not start checkout')
        return
      }
      if (body.mode === 'checkout' && body.url) {
        // First-time: hand off to Stripe Checkout.
        window.location.href = body.url
        return
      }
      if (body.mode === 'increment') {
        // Subsequent: subscription updated server-side; webhook will bump
        // purchased_seats. Toast + refetch to pick it up.
        toast.success('Seat added', { description: 'Stripe is processing the prorated charge. Your new seat will be available shortly.' })
        refetch?.()
        setTimeout(() => refetch?.(), 3000)
        return
      }
      toast.info('Checkout returned an unexpected response')
    } catch (err) {
      toast.error('Could not add seat', { description: err?.message || String(err) })
    } finally {
      setAddingSeat(false)
    }
  }

  return (
    <Card className="p-4 border-dashed">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center shrink-0">
          <UserPlus className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Need an extra technician?</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Add a seat for <span className="font-semibold text-gray-700 dark:text-gray-300">$3 / month</span> (billed immediately, prorated to the rest of your billing period).
          </p>
        </div>
      </div>

      <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 px-1 tabular-nums">
        Currently using <span className="font-semibold text-gray-900 dark:text-gray-100">{staffLimit}</span> {staffLimit === 1 ? 'seat' : 'seats'}
        {purchasedSeats > 0 && (
          <> — <span className="text-pool-600 dark:text-pool-400 font-semibold">{purchasedSeats}</span> purchased on top of your {currentPlan} plan ({planMax}).</>
        )}
        {purchasedSeats === 0 && planMax > 0 && (
          <> from your {currentPlan} plan.</>
        )}
      </div>

      <Button
        variant="secondary"
        className="w-full min-h-tap"
        leftIcon={Plus}
        onClick={handleAddSeat}
        loading={addingSeat}
      >
        Add technician seat — $3/mo
      </Button>
    </Card>
  )
}
