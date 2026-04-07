import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { supabase } from '../lib/supabase'
import {
  formatDate,
  getChemicalStatus,
  statusDot,
  statusColor,
  CHEMICAL_LABELS,
  DEFAULT_TARGET_RANGES,
  cn,
} from '../lib/utils'

export default function ServiceDetail() {
  const { id: serviceId } = useParams()
  const [record, setRecord] = useState(null)
  const [pool, setPool] = useState(null)
  const [loading, setLoading] = useState(true)

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
          .select('target_ranges, pool_type')
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

  return (
    <>
      <Header title="Service Details" backTo={-1} />
      <PageWrapper>
        <div className="space-y-4">
          {/* Date & Technician */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Date</p>
                <p className="text-base font-medium text-gray-900">{formatDate(record.serviced_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Technician</p>
                <p className="text-base font-medium text-gray-900">{record.technician_name || '--'}</p>
              </div>
            </div>
            <div className="mt-2">
              <Badge variant={record.status === 'completed' ? 'success' : 'warning'}>
                {record.status}
              </Badge>
            </div>
          </Card>

          {/* Chemical Readings */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Chemical Readings</h2>
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

          {/* Tasks */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Tasks ({completedTasks}/{tasks.length})
            </h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-400">No tasks recorded</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((task, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      task.completed ? 'border-green-500 bg-green-500' : 'border-gray-300'
                    )}>
                      {task.completed && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className={cn(
                      'text-sm',
                      task.completed ? 'text-gray-900' : 'text-gray-400 line-through'
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
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Chemicals Added</h2>
              <div className="space-y-2">
                {chemicals.map((chem, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-700">{chem.product_name}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {chem.quantity} {chem.unit}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Photos</h2>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                    <img
                      src={photo.url}
                      alt={photo.tag || 'Service photo'}
                      className="w-full h-full object-cover"
                    />
                    {photo.tag && (
                      <Badge className="absolute bottom-1 left-1 text-[10px]" variant="default">
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
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{record.notes}</p>
            </Card>
          )}
        </div>
      </PageWrapper>
    </>
  )
}
