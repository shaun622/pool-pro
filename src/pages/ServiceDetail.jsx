import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import ConfirmModal from '../components/ui/ConfirmModal'
import EmptyState from '../components/ui/EmptyState'
import { supabase } from '../lib/supabase'
import { useService } from '../hooks/useService'
import { useToast } from '../contexts/ToastContext'
import {
  formatDate,
  getChemicalStatus,
  statusDot,
  statusColor,
  CHEMICAL_LABELS,
  DEFAULT_TARGET_RANGES,
  cn,
} from '../lib/utils'

// Pool condition on arrival — the tech's required selection on the arrival step.
// Colours mirror the ADMIN report email exactly (complete-service/index.ts):
// Good=green, Cloudy/Dirty=orange, Green=red. Admin record only, never customer-facing.
const CONDITION_STYLES = {
  Good: {
    card: 'border-green-200 dark:border-green-900 bg-green-50/60 dark:bg-green-950/20',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
  },
  Cloudy: {
    card: 'border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/20',
    dot: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
  },
  Dirty: {
    card: 'border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/20',
    dot: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
  },
  Green: {
    card: 'border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
  },
}

export default function ServiceDetail() {
  const { id: serviceId } = useParams()
  const [record, setRecord] = useState(null)
  const [pool, setPool] = useState(null)
  const [loading, setLoading] = useState(true)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { revertUnableToService, loading: reverting } = useService()

  useEffect(() => {
    loadService()
  }, [serviceId])

  async function loadService() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('service_records')
        .select(`
          *,
          chemical_logs(*),
          service_tasks(*),
          chemicals_added(*),
          service_photos(*)
        `)
        .eq('id', serviceId)
        .single()

      if (error) throw error
      setRecord(data)

      // Fetch pool for target ranges
      if (data.pool_id) {
        const { data: poolData } = await supabase
          .from('pools')
          .select('target_ranges, type, name, address, clients(name, email, phone, address)')
          .eq('id', data.pool_id)
          .single()
        setPool(poolData)
      }
    } catch (err) {
      console.error('Error loading service record:', err)
    } finally {
      setLoading(false)
    }
  }

  // Undo an unable-to-service: revert it back to a due visit on its original
  // occurrence day. Use the stored occurrence_date (identity); fall back to the
  // serviced_at day for legacy rows that predate occurrence identity.
  async function handleReopen() {
    if (!record) return
    let occYmd = record.occurrence_date ? String(record.occurrence_date).split('T')[0] : null
    if (!occYmd) {
      const d = new Date(record.serviced_at)
      occYmd = isNaN(d.getTime())
        ? null
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    try {
      await revertUnableToService(record.id, record.pool_id, occYmd)
      toast.success('Service reopened — back on the schedule')
      navigate(-1)
    } catch (err) {
      toast.error(err?.message || 'Failed to reopen service')
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Loading..." backTo={-1} />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-pool-500 border-t-transparent rounded-full" />
          </div>
        </PageWrapper>
      </>
    )
  }

  if (!record) {
    return (
      <>
        <Header title="Not Found" backTo={-1} />
        <PageWrapper>
          <EmptyState title="Service not found" description="This service record may have been removed." />
        </PageWrapper>
      </>
    )
  }

  const log = record.chemical_logs?.[0] || {}
  const tasks = record.service_tasks || []
  const chemicals = record.chemicals_added || []
  const photos = record.service_photos || []
  const targetRanges = pool?.target_ranges || DEFAULT_TARGET_RANGES

  const READING_KEYS = [
    { key: 'ph', rangeKey: 'ph' },
    { key: 'free_chlorine', rangeKey: 'free_cl' },
    { key: 'total_chlorine', rangeKey: 'total_cl' },
    { key: 'alkalinity', rangeKey: 'alk' },
    { key: 'stabiliser', rangeKey: 'stabiliser' },
    { key: 'calcium_hardness', rangeKey: 'calcium' },
    { key: 'salt', rangeKey: 'salt' },
    { key: 'water_temp', rangeKey: null },
  ]

  const completedTasks = tasks.filter(t => t.completed).length

  // Surface "serviced early/late" when the actual service day differs from the
  // scheduled occurrence day (occurrence_date is the identity).
  const occDay = record.occurrence_date ? String(record.occurrence_date).split('T')[0] : null
  const servDay = (() => {
    if (!record.serviced_at) return null
    const d = new Date(record.serviced_at)
    return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const servedOffSchedule = occDay && servDay && occDay !== servDay

  // Unable-to-service records have no readings/tasks/chemicals — they're a
  // failed-access report. Show the reason, note, photos and (importantly)
  // the customer's contact so the admin can follow up.
  if (record.status === 'unable_to_service') {
    const contact = pool?.clients || {}
    return (
      <>
        <Header title="Service Details" backTo={-1} />
        <PageWrapper>
          <div className="space-y-4">
            <Card className="border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/20">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold text-orange-700 dark:text-orange-300">Unable to service</p>
                  {record.unable_reason && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-0.5">{record.unable_reason}</p>}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDate(record.serviced_at)} · {record.technician_name || '--'}</p>
                  {servedOffSchedule && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Scheduled visit: {formatDate(occDay)}</p>
                  )}
                </div>
              </div>
            </Card>

            <Button
              variant="secondary"
              leftIcon={RotateCcw}
              onClick={() => setConfirmReopen(true)}
              loading={reverting}
              className="w-full"
            >
              Reopen — mark serviceable again
            </Button>

            {record.notes && (
              <Card>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Note from technician</h2>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{record.notes}</p>
              </Card>
            )}

            {photos.length > 0 && (
              <Card>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Photos</h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Kept for 60 days after the service, then removed to save storage.</p>
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((photo, i) => (
                    <div key={i} className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 self-start">
                      <img
                        src={photo.signed_url || supabase.storage.from('service-photos').getPublicUrl(photo.storage_path).data?.publicUrl}
                        alt={photo.tag || 'Photo'}
                        className="w-full h-auto"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Customer — follow up</h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Name</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-right">{contact.name || '--'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Phone</span>
                  {contact.phone
                    ? <a href={`tel:${contact.phone}`} className="font-medium text-pool-600 dark:text-pool-400">{contact.phone}</a>
                    : <span className="text-gray-400 dark:text-gray-500">--</span>}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400">Email</span>
                  {contact.email
                    ? <a href={`mailto:${contact.email}`} className="font-medium text-pool-600 dark:text-pool-400 truncate max-w-[65%] text-right">{contact.email}</a>
                    : <span className="text-gray-400 dark:text-gray-500">--</span>}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">Address</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-right">{pool?.address || contact.address || '--'}</span>
                </div>
              </div>
            </Card>
          </div>
        </PageWrapper>

        <ConfirmModal
          open={confirmReopen}
          onClose={() => !reverting && setConfirmReopen(false)}
          title="Reopen this service?"
          description="Undoes the “unable to service” report and puts the visit back on the schedule as due on its original day — as if it was never marked. Use this when the client has reopened access."
          confirmLabel={reverting ? 'Reopening…' : 'Reopen service'}
          onConfirm={handleReopen}
        />
      </>
    )
  }

  return (
    <>
      <Header title="Service Details" backTo={-1} />
      <PageWrapper>
        <div className="space-y-4">
          {/* Date & Technician */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{servedOffSchedule ? 'Serviced' : 'Date'}</p>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">{formatDate(record.serviced_at)}</p>
                {servedOffSchedule && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Scheduled visit: {formatDate(occDay)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500 dark:text-gray-400">Technician</p>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">{record.technician_name || '--'}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={record.status === 'completed' ? 'success' : 'warning'}>
                {record.status}
              </Badge>
              {record.is_one_off && (
                <Badge variant="default">Extra visit (one-off)</Badge>
              )}
            </div>
          </Card>

          {/* Pool condition on arrival — mirrors the admin report banner. Only
              renders for records that captured it (pre-feature rows are null). */}
          {CONDITION_STYLES[record.pool_condition] && (
            <Card className={CONDITION_STYLES[record.pool_condition].card}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Pool condition on arrival
                  </h2>
                  <p className={cn('text-base font-bold mt-0.5', CONDITION_STYLES[record.pool_condition].text)}>
                    {record.pool_condition}
                  </p>
                </div>
                <span className={cn('w-3 h-3 rounded-full shrink-0', CONDITION_STYLES[record.pool_condition].dot)} />
              </div>
            </Card>
          )}

          {/* Chemical Readings */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Chemical Readings</h2>
            <div className="space-y-2">
              {READING_KEYS.map(({ key, rangeKey }) => {
                const value = log[key]
                if (value == null) return null
                const info = CHEMICAL_LABELS[key]
                const range = rangeKey ? targetRanges[rangeKey] : null
                const status = range ? getChemicalStatus(value, range) : 'neutral'
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex items-center justify-between py-2 px-3 rounded-lg border',
                      statusColor(status)
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2.5 h-2.5 rounded-full', statusDot(status))} />
                      <span className="text-sm font-medium">{info?.label || key}</span>
                    </div>
                    <span className="text-sm font-semibold">
                      {value} {info?.unit || ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Tasks — admin view shows the full ticked / unticked list.
              The customer report (email + portal) shows completed only. */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              Tasks ({completedTasks}/{tasks.length})
            </h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Admin view — the customer only sees completed tasks.</p>
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No tasks recorded</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((task, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      task.completed ? 'border-green-500 bg-green-500' : 'border-gray-300 dark:border-gray-600'
                    )}>
                      {task.completed && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className={cn(
                      'text-sm',
                      task.completed ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 line-through'
                    )}>
                      {task.task_name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Chemicals Added */}
          {chemicals.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Chemicals Added</h2>
              <div className="space-y-2">
                {chemicals.map((chem, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{chem.product_name}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {/* dose_text is the freeform user input on
                          new rows; legacy rows fall back to structured
                          quantity+unit. stock_remaining (if logged)
                          renders after the dose as "· 3kg left". */}
                      {chem.dose_text || `${chem.quantity ?? ''} ${chem.unit ?? ''}`.trim() || '—'}
                      {chem.stock_remaining && (
                        <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                          · {chem.stock_remaining} left
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Photos</h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Kept for 60 days after the service, then removed to save storage.</p>
              <div className="grid grid-cols-2 gap-2">
                {photos.map((photo, i) => (
                  <div key={i} className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 self-start">
                    <img
                      src={photo.signed_url || supabase.storage.from('service-photos').getPublicUrl(photo.storage_path).data?.publicUrl}
                      alt={photo.tag || 'Service photo'}
                      className="w-full h-auto"
                    />
                    {photo.tag && (
                      <Badge className="absolute top-1 left-1 text-[10px]" variant="default">
                        {photo.tag}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Notes */}
          {record.notes && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{record.notes}</p>
            </Card>
          )}
        </div>
      </PageWrapper>
    </>
  )
}
