import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import EmptyState from '../components/ui/EmptyState'
import { useService } from '../hooks/useService'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import {
  formatDate,
  getChemicalStatus,
  statusDot,
  statusColor,
  DEFAULT_TARGET_RANGES,
  CHEMICAL_LABELS,
  cn,
} from '../lib/utils'

const RANGE_KEYS = ['ph', 'free_cl', 'total_cl', 'alk', 'stabiliser', 'calcium', 'salt']

const RANGE_LABELS = {
  ph: 'pH',
  free_cl: 'Free Chlorine',
  total_cl: 'Total Chlorine',
  alk: 'Alkalinity',
  stabiliser: 'Stabiliser',
  calcium: 'Calcium',
  salt: 'Salt',
}

export default function PoolDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getServiceHistory } = useService()
  const { business } = useBusiness()

  const [pool, setPool] = useState(null)
  const [client, setClient] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingRanges, setEditingRanges] = useState(false)
  const [targetRanges, setTargetRanges] = useState({})
  const [savingRanges, setSavingRanges] = useState(false)

  useEffect(() => {
    loadPool()
  }, [id])

  async function loadPool() {
    setLoading(true)
    try {
      const { data: poolData, error } = await supabase
        .from('pools')
        .select('*, clients(*)')
        .eq('id', id)
        .single()

      if (error) throw error
      setPool(poolData)
      setClient(poolData.clients)
      setTargetRanges(poolData.target_ranges || DEFAULT_TARGET_RANGES)

      const records = await getServiceHistory(id, 10)
      setHistory(records)
    } catch (err) {
      console.error('Error loading pool:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveTargetRanges() {
    setSavingRanges(true)
    try {
      const { error } = await supabase
        .from('pools')
        .update({ target_ranges: targetRanges })
        .eq('id', id)
      if (error) throw error
      setEditingRanges(false)
    } catch (err) {
      console.error('Error saving target ranges:', err)
    } finally {
      setSavingRanges(false)
    }
  }

  function handleRangeChange(key, index, value) {
    setTargetRanges(prev => ({
      ...prev,
      [key]: prev[key].map((v, i) => (i === index ? parseFloat(value) || 0 : v)),
    }))
  }

  // Build chart data from history (reversed so oldest first)
  const chartData = [...history].reverse().map(record => {
    const log = record.chemical_logs?.[0] || {}
    return {
      date: formatDate(record.serviced_at),
      pH: log.ph ?? null,
      'Free Cl': log.free_chlorine ?? null,
      Alkalinity: log.alkalinity ?? null,
    }
  })

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

  if (!pool) {
    return (
      <>
        <Header title="Pool Not Found" backTo="/pools" />
        <PageWrapper>
          <EmptyState title="Pool not found" description="This pool may have been removed." />
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title={pool.address || 'Pool Detail'} backTo={-1} />
      <PageWrapper>
        <div className="space-y-4">
          {/* Client Info */}
          {client && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Client</h2>
              <p className="font-medium text-gray-900">{client.name}</p>
              {client.phone && (
                <a href={`tel:${client.phone}`} className="block text-sm text-pool-600 mt-1 min-h-[44px] flex items-center">
                  {client.phone}
                </a>
              )}
              {client.email && (
                <a href={`mailto:${client.email}`} className="block text-sm text-pool-600 min-h-[44px] flex items-center">
                  {client.email}
                </a>
              )}
            </Card>
          )}

          {/* Pool Info */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Pool Info</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">Type</p>
                <Badge variant={pool.pool_type || 'default'} className="mt-1">
                  {pool.pool_type || 'Unknown'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500">Volume</p>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {pool.volume_litres ? `${pool.volume_litres.toLocaleString()} L` : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Shape</p>
                <p className="text-sm font-medium text-gray-900 mt-1 capitalize">{pool.shape || '--'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Schedule</p>
                <p className="text-sm font-medium text-gray-900 mt-1 capitalize">{pool.schedule_frequency || '--'}</p>
              </div>
            </div>
          </Card>

          {/* Equipment */}
          <Card>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Equipment</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Pump</span>
                <span className="text-sm font-medium text-gray-900">{pool.pump_model || '--'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Filter</span>
                <span className="text-sm font-medium text-gray-900">{pool.filter_type || '--'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Heater</span>
                <span className="text-sm font-medium text-gray-900">{pool.heater || '--'}</span>
              </div>
            </div>
          </Card>

          {/* Access Notes */}
          {pool.access_notes && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Access Notes</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{pool.access_notes}</p>
            </Card>
          )}

          {/* Target Chemical Ranges */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Target Ranges</h2>
              {!editingRanges ? (
                <button
                  onClick={() => setEditingRanges(true)}
                  className="text-xs text-pool-600 font-medium min-h-[44px] flex items-center px-2"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setTargetRanges(pool.target_ranges || DEFAULT_TARGET_RANGES)
                      setEditingRanges(false)
                    }}
                    className="text-xs text-gray-500 font-medium min-h-[44px] flex items-center px-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTargetRanges}
                    disabled={savingRanges}
                    className="text-xs text-pool-600 font-medium min-h-[44px] flex items-center px-2"
                  >
                    {savingRanges ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {RANGE_KEYS.map(key => {
                const range = targetRanges[key] || DEFAULT_TARGET_RANGES[key]
                if (!range) return null
                return (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700 w-28">{RANGE_LABELS[key]}</span>
                    {editingRanges ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={range[0]}
                          onChange={e => handleRangeChange(key, 0, e.target.value)}
                          className="input w-20 text-center text-sm"
                        />
                        <span className="text-gray-400">-</span>
                        <input
                          type="number"
                          step="any"
                          value={range[1]}
                          onChange={e => handleRangeChange(key, 1, e.target.value)}
                          className="input w-20 text-center text-sm"
                        />
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-gray-900">
                        {range[0]} - {range[1]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Start Service Button */}
          <Button
            onClick={() => navigate(`/pools/${id}/service`)}
            className="w-full min-h-[52px] text-base font-semibold"
          >
            Start Service
          </Button>

          {/* Chemical Trend Chart */}
          {chartData.length > 1 && (
            <Card>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Chemical Trends</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="pH" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="Free Cl" stroke="#22C55E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="Alkalinity" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2">
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-3 h-0.5 bg-[#0EA5E9] inline-block" /> pH
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-3 h-0.5 bg-[#22C55E] inline-block" /> Free Cl
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-3 h-0.5 bg-[#F59E0B] inline-block" /> Alkalinity
                </span>
              </div>
            </Card>
          )}

          {/* Service History */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Service History</h2>
            {history.length === 0 ? (
              <EmptyState
                title="No services yet"
                description="Tap Start Service to log your first visit."
              />
            ) : (
              <div className="space-y-2">
                {history.map(record => {
                  const log = record.chemical_logs?.[0] || {}
                  const ranges = pool.target_ranges || DEFAULT_TARGET_RANGES
                  return (
                    <Card
                      key={record.id}
                      onClick={() => navigate(`/services/${record.id}`)}
                      className="active:bg-gray-50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          {formatDate(record.serviced_at)}
                        </span>
                        <span className="text-xs text-gray-500">{record.technician_name}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {log.ph != null && (
                          <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', statusColor(getChemicalStatus(log.ph, ranges.ph)))}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(getChemicalStatus(log.ph, ranges.ph)))} />
                            pH {log.ph}
                          </span>
                        )}
                        {log.free_chlorine != null && (
                          <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', statusColor(getChemicalStatus(log.free_chlorine, ranges.free_cl)))}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(getChemicalStatus(log.free_chlorine, ranges.free_cl)))} />
                            Cl {log.free_chlorine}
                          </span>
                        )}
                        {log.alkalinity != null && (
                          <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', statusColor(getChemicalStatus(log.alkalinity, ranges.alk)))}>
                            <span className={cn('w-1.5 h-1.5 rounded-full', statusDot(getChemicalStatus(log.alkalinity, ranges.alk)))} />
                            Alk {log.alkalinity}
                          </span>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PageWrapper>
    </>
  )
}
