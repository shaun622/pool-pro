import { useState, useEffect, useCallback } from 'react'
import { HardDrive } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'

const RETENTION_DAYS = 60

// Photo-storage readout + a manual "clean up now" — the heavy service photos are
// the only real storage cost. Removing files older than 60 days reclaims it while
// keeping every service record. The nightly cron does this automatically; this
// button runs it on demand for THIS business.
export default function StorageCard() {
  const { business } = useBusiness()
  const toast = useToast()
  const [stats, setStats] = useState(null) // { total, pending }
  const [loading, setLoading] = useState(true)
  const [cleaning, setCleaning] = useState(false)

  const load = useCallback(async () => {
    if (!business?.id) return
    setLoading(true)
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()
    const [totalRes, pendingRes] = await Promise.all([
      supabase.from('service_photos').select('id', { count: 'exact', head: true }),
      supabase.from('service_photos').select('id', { count: 'exact', head: true }).lt('created_at', cutoff),
    ])
    setStats({ total: totalRes.count ?? 0, pending: pendingRes.count ?? 0 })
    setLoading(false)
  }, [business?.id])

  useEffect(() => { load() }, [load])

  async function handleCleanup() {
    setCleaning(true)
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-service-photos')
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const n = data?.removedFiles ?? 0
      toast.success(n > 0 ? `Removed ${n} old photo${n === 1 ? '' : 's'}.` : 'Nothing older than 60 days to remove.')
      await load()
    } catch (e) {
      toast.error(e?.message || 'Cleanup failed — is the cleanup-service-photos function deployed?')
    } finally {
      setCleaning(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <HardDrive className="w-4 h-4 text-gray-400 dark:text-gray-500" strokeWidth={2} />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Photo storage</h2>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Service photos are kept for {RETENTION_DAYS} days, then removed to save space. Readings,
        chemicals, tasks and notes are always kept.
      </p>

      {loading ? (
        <div className="w-5 h-5 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold tabular-nums">{stats?.total ?? 0}</span> photo{stats?.total === 1 ? '' : 's'}
            {' · '}
            <span className={stats?.pending > 0 ? 'font-semibold text-amber-600 dark:text-amber-400 tabular-nums' : 'text-gray-400 dark:text-gray-500 tabular-nums'}>
              {stats?.pending ?? 0}
            </span>{' '}older than {RETENTION_DAYS} days
          </p>
          <Button
            variant="secondary"
            onClick={handleCleanup}
            loading={cleaning}
            disabled={!stats || stats.pending === 0}
            className="text-sm"
          >
            {stats?.pending > 0 ? `Clean up ${stats.pending} now` : 'Nothing to clean up'}
          </Button>
        </div>
      )}
    </Card>
  )
}
