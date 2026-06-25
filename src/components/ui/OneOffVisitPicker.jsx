import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'

// "Service a one-off visit" — a SEPARATE flow for an off-route / extra visit
// (e.g. a daily green-pool revisit on top of a twice-weekly schedule). The tech
// or admin picks any existing pool in the business; selecting it opens the
// normal service flow with state { oneOff: true }, which forces a null-identity
// ad-hoc record that never fulfils, advances, suppresses or relabels any
// recurring occurrence (see resolveOccurrence in NewService.jsx).
const MAX_RESULTS = 50

export default function OneOffVisitPicker({ open, onClose }) {
  const { business } = useBusiness()
  const navigate = useNavigate()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || !business?.id) return
    let cancelled = false
    setLoading(true)
    setSearch('')
    // RLS scopes this to the caller's business (business_id = current_business_id()),
    // so a tech can read every pool in their business without an extra grant.
    supabase
      .from('pools')
      .select('id, name, address, type, clients(name)')
      .eq('business_id', business.id)
      .order('name')
      .limit(500)
      .then(({ data }) => {
        if (!cancelled) {
          setPools(data || [])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [open, business?.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return pools
    return pools.filter((p) =>
      `${p.clients?.name || ''} ${p.name || ''} ${p.address || ''}`.toLowerCase().includes(q)
    )
  }, [pools, search])

  const shown = filtered.slice(0, MAX_RESULTS)
  const truncated = filtered.length - shown.length

  function pick(poolId) {
    onClose?.()
    navigate(`/pools/${poolId}/service`, { state: { oneOff: true } })
  }

  return (
    <Modal open={open} onClose={onClose} title="Service a one-off visit" size="md">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        An extra visit, separate from the schedule — pick any pool. This won't change its recurring services or next due date.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by client, pool, or address..."
        autoFocus
        className="w-full px-3 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-pool-500/30 mb-3"
      />

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">Loading pools…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">No pools found.</p>
      ) : (
        <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {shown.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              className="text-left w-full rounded-xl px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                {p.clients?.name || 'Unknown client'}
                <span className="text-gray-400 dark:text-gray-500 font-normal"> · {p.name || 'Pool'}</span>
              </div>
              {p.address && (
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.address}</div>
              )}
            </button>
          ))}
          {truncated > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">
              +{truncated} more — refine your search to narrow the list.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
