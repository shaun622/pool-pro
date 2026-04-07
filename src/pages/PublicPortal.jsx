import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import StaffCard from '../components/ui/StaffCard'
import { supabase } from '../lib/supabase'
import {
  formatDate,
  getChemicalStatus,
  statusColor,
  statusDot,
  CHEMICAL_LABELS,
  FREQUENCY_LABELS,
  DEFAULT_TARGET_RANGES,
  cn,
} from '../lib/utils'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts'

const CHEMICAL_KEYS = ['ph', 'free_chlorine', 'total_chlorine', 'alkalinity', 'stabiliser', 'calcium_hardness', 'salt']
const RANGE_KEY_MAP = { ph: 'ph', free_chlorine: 'free_cl', total_chlorine: 'total_cl', alkalinity: 'alk', stabiliser: 'stabiliser', calcium_hardness: 'calcium', salt: 'salt' }

const trendColors = {
  ph: '#6366f1', free_chlorine: '#3b82f6', total_chlorine: '#06b6d4',
  alkalinity: '#10b981', stabiliser: '#f59e0b', calcium_hardness: '#8b5cf6', salt: '#0ea5e9',
}

// ── Health Score ──────────────────────────────────────────────────
function calcHealthScore(readings, ranges) {
  if (!readings || !ranges) return null
  let total = 0, count = 0
  for (const key of CHEMICAL_KEYS) {
    const val = readings[key]
    if (val == null) continue
    const range = ranges[RANGE_KEY_MAP[key]]
    if (!range) continue
    const [min, max] = range
    const mid = (min + max) / 2
    const span = (max - min) / 2
    const deviation = Math.abs(val - mid) / span
    total += Math.max(0, 1 - deviation * 0.5)
    count++
  }
  return count > 0 ? Math.round((total / count) * 100) : null
}

function HealthRing({ score, size = 100, brandColor }) {
  const radius = (size - 12) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#F59E0B' : '#EF4444'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#E5E7EB" strokeWidth="8" />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Health</span>
      </div>
    </div>
  )
}

// ── Chemical Gauge ───────────────────────────────────────────────
function ChemicalGauge({ label, value, range, color }) {
  if (value == null) return null
  const status = getChemicalStatus(value, range)
  const statusColors = { green: 'text-green-600', amber: 'text-amber-600', red: 'text-red-600', neutral: 'text-gray-400' }
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(status))} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-600">{label}</span>
          <span className={cn('text-sm font-bold', statusColors[status])}>{value}</span>
        </div>
        {range && (
          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                backgroundColor: status === 'green' ? '#22C55E' : status === 'amber' ? '#F59E0B' : '#EF4444',
                width: `${Math.min(100, Math.max(5, ((value - range[0] * 0.8) / (range[1] * 1.2 - range[0] * 0.8)) * 100))}%`,
              }}
            />
          </div>
        )}
        {range && <p className="text-[10px] text-gray-400 mt-0.5">Target: {range[0]} – {range[1]}</p>}
      </div>
    </div>
  )
}

// ── Trend Chart ──────────────────────────────────────────────────
function TrendChart({ readings, chemKey, color, range }) {
  const data = readings.filter(r => r[chemKey] != null).map(r => ({
    date: r.date,
    value: r[chemKey],
  }))
  if (data.length < 2) return null

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={`grad-${chemKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
            domain={range ? [Math.min(range[0] * 0.8, Math.min(...data.map(d => d.value))), Math.max(range[1] * 1.2, Math.max(...data.map(d => d.value)))] : ['auto', 'auto']}
          />
          {range && (
            <>
              <Area type="monotone" dataKey={() => range[1]} stroke="none" fill="#22C55E" fillOpacity={0.05} />
              <Area type="monotone" dataKey={() => range[0]} stroke="none" fill="white" fillOpacity={1} />
            </>
          )}
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
            formatter={(val) => [val, CHEMICAL_LABELS[chemKey]?.label]}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#grad-${chemKey})`} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: 'white' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Service Detail Card ──────────────────────────────────────────
function ServiceCard({ record, chemLog, tasks, chemicalsAdded, ranges, prevLog, brandColor }) {
  const [expanded, setExpanded] = useState(false)
  const score = calcHealthScore(chemLog, ranges)

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden transition-all duration-200',
      expanded ? 'bg-white shadow-md border-gray-200' : 'bg-white border-gray-100 hover:border-gray-200'
    )}>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left min-h-[56px]"
      >
        {/* Health dot */}
        <div className={cn(
          'w-3 h-3 rounded-full flex-shrink-0',
          score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-amber-500' : score != null ? 'bg-red-500' : 'bg-gray-300'
        )} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{formatDate(record.serviced_at)}</span>
            {record.technician_name && (
              <span className="text-xs text-gray-400">by {record.technician_name}</span>
            )}
          </div>
          {record.notes && !expanded && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{record.notes}</p>
          )}
        </div>

        {score != null && (
          <span className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full',
            score >= 80 ? 'bg-green-50 text-green-700' : score >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
          )}>
            {score}%
          </span>
        )}

        <svg className={cn('w-4 h-4 text-gray-400 transition-transform', expanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {/* Chemical readings with comparison */}
          {chemLog && (
            <div>
              <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Chemical Readings</h5>
              <div className="space-y-1">
                {CHEMICAL_KEYS.map(key => {
                  const val = chemLog[key]
                  if (val == null) return null
                  const range = ranges?.[RANGE_KEY_MAP[key]]
                  const status = getChemicalStatus(val, range)
                  const prevVal = prevLog?.[key]
                  const diff = prevVal != null ? val - prevVal : null
                  return (
                    <div key={key} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2 h-2 rounded-full', statusDot(status))} />
                        <span className="text-sm text-gray-600">{CHEMICAL_LABELS[key]?.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{val}</span>
                        {CHEMICAL_LABELS[key]?.unit && <span className="text-xs text-gray-400">{CHEMICAL_LABELS[key].unit}</span>}
                        {diff != null && diff !== 0 && (
                          <span className={cn(
                            'text-[10px] font-bold px-1 py-0.5 rounded',
                            diff > 0 ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'
                          )}>
                            {diff > 0 ? '↑' : '↓'}{Math.abs(diff).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tasks */}
          {tasks?.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Tasks ({tasks.filter(t => t.completed).length}/{tasks.length})
              </h5>
              <div className="flex flex-wrap gap-1.5">
                {tasks.map((t, i) => (
                  <span key={i} className={cn(
                    'text-xs px-2 py-1 rounded-full',
                    t.completed ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
                  )}>
                    {t.completed && '✓ '}{t.task_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Chemicals added */}
          {chemicalsAdded?.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Chemicals Added</h5>
              <div className="space-y-1">
                {chemicalsAdded.map((c, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-600">{c.product_name}</span>
                    <span className="font-medium text-gray-900">{c.quantity} {c.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {record.notes && (
            <div className="bg-gray-50 rounded-lg p-3">
              <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</h5>
              <p className="text-sm text-gray-700">{record.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pool Section ─────────────────────────────────────────────────
function PoolSection({ pool, serviceRecords, chemicalLogs, tasksByRecord, chemAddedByRecord, brandColor }) {
  const [activeChart, setActiveChart] = useState(null)
  const ranges = pool.target_ranges || DEFAULT_TARGET_RANGES

  const readings = serviceRecords
    .map(r => {
      const log = chemicalLogs[r.id]
      if (!log) return null
      return { date: formatDate(r.serviced_at), ...log }
    })
    .filter(Boolean)
    .reverse()

  const latestLog = serviceRecords.length > 0 ? chemicalLogs[serviceRecords[0].id] : null
  const healthScore = calcHealthScore(latestLog, ranges)
  const isOverdue = pool.next_due_at && new Date(pool.next_due_at) < new Date()

  // Available chart keys
  const chartKeys = CHEMICAL_KEYS.filter(key => readings.some(r => r[key] != null))

  return (
    <div className="mb-10">
      {/* Pool Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-1">
          <h3 className="font-bold text-gray-900 text-xl">{pool.address}</h3>
          <div className="flex items-center gap-2 mt-1">
            {pool.type && <Badge variant={pool.type}>{pool.type}</Badge>}
            {pool.volume_litres && (
              <span className="text-xs text-gray-400">{Number(pool.volume_litres).toLocaleString()}L</span>
            )}
          </div>
        </div>
        {healthScore != null && <HealthRing score={healthScore} brandColor={brandColor} />}
      </div>

      {/* Upcoming Service */}
      {pool.next_due_at && (
        <Card className={cn(
          'mb-4 border-l-4',
          isOverdue ? 'border-l-red-500 bg-red-50' : 'border-l-green-500 bg-green-50'
        )}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">
                {isOverdue ? 'Overdue' : 'Next Service'}
              </p>
              <p className={cn('text-lg font-bold mt-0.5', isOverdue ? 'text-red-600' : 'text-green-700')}>
                {formatDate(pool.next_due_at)}
              </p>
            </div>
            {pool.schedule_frequency && (
              <div className="text-right">
                <Badge variant={isOverdue ? 'danger' : 'success'}>
                  {FREQUENCY_LABELS[pool.schedule_frequency] || pool.schedule_frequency}
                </Badge>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Latest Readings Gauges */}
      {latestLog && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-gray-900">Latest Readings</h4>
            <span className="text-xs text-gray-400">{serviceRecords.length > 0 && formatDate(serviceRecords[0].serviced_at)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {CHEMICAL_KEYS.map(key => (
              <ChemicalGauge
                key={key}
                label={CHEMICAL_LABELS[key]?.label || key}
                value={latestLog[key]}
                range={ranges[RANGE_KEY_MAP[key]]}
                color={trendColors[key]}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Trend Charts */}
      {chartKeys.length > 0 && readings.length >= 2 && (
        <Card className="mb-4">
          <h4 className="font-semibold text-gray-900 mb-3">Chemical Trends</h4>
          {/* Chart selector tabs */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {chartKeys.map(key => (
              <button
                key={key}
                onClick={() => setActiveChart(activeChart === key ? null : key)}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full font-medium transition-colors min-h-[32px]',
                  activeChart === key
                    ? 'text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
                style={activeChart === key ? { backgroundColor: trendColors[key] } : undefined}
              >
                {CHEMICAL_LABELS[key]?.label || key}
              </button>
            ))}
          </div>

          {/* Active chart or all mini charts */}
          {activeChart ? (
            <div>
              <TrendChart
                readings={readings}
                chemKey={activeChart}
                color={trendColors[activeChart]}
                range={ranges[RANGE_KEY_MAP[activeChart]]}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {chartKeys.map(key => (
                <button key={key} onClick={() => setActiveChart(key)} className="text-left group">
                  <p className="text-[11px] text-gray-500 mb-1 font-medium group-hover:text-gray-700 transition-colors">
                    {CHEMICAL_LABELS[key]?.label}
                    {latestLog?.[key] != null && (
                      <span className="ml-1 font-bold text-gray-700">{latestLog[key]}</span>
                    )}
                  </p>
                  <div className="h-14">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={readings.filter(r => r[key] != null)} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                        <Line type="monotone" dataKey={key} stroke={trendColors[key]} strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Readings Comparison Table */}
      {readings.length > 0 && (
        <Card className="mb-4 overflow-x-auto">
          <h4 className="font-semibold text-gray-900 mb-3">Reading History</h4>
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-2 py-2 text-gray-500 font-medium">Date</th>
                {CHEMICAL_KEYS.map(key => {
                  if (!readings.some(r => r[key] != null)) return null
                  return (
                    <th key={key} className="text-center px-2 py-2 text-gray-500 font-medium whitespace-nowrap text-xs">
                      {CHEMICAL_LABELS[key]?.label}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {serviceRecords
                .filter(r => chemicalLogs[r.id])
                .map((record, idx) => {
                  const log = chemicalLogs[record.id]
                  return (
                    <tr key={record.id} className={cn('border-b last:border-0', idx === 0 && 'bg-blue-50/30')}>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap text-xs font-medium">
                        {formatDate(record.serviced_at)}
                        {idx === 0 && <span className="ml-1 text-blue-500 text-[10px]">latest</span>}
                      </td>
                      {CHEMICAL_KEYS.map(key => {
                        if (!readings.some(r => r[key] != null)) return null
                        const val = log[key]
                        if (val == null) return <td key={key} className="px-2 py-2 text-center text-gray-300 text-sm">--</td>
                        const range = ranges[RANGE_KEY_MAP[key]]
                        const status = getChemicalStatus(val, range)
                        const colors = statusColor(status)
                        return (
                          <td key={key} className={cn('px-2 py-2 text-center text-sm font-medium border-x', colors)}>
                            {val}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Service History */}
      {serviceRecords.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">
            Service History
            <span className="text-sm font-normal text-gray-400 ml-2">{serviceRecords.length} services</span>
          </h4>
          <div className="space-y-2">
            {serviceRecords.map((record, idx) => {
              const prevRecord = serviceRecords[idx + 1]
              const prevLog = prevRecord ? chemicalLogs[prevRecord.id] : null
              return (
                <ServiceCard
                  key={record.id}
                  record={record}
                  chemLog={chemicalLogs[record.id]}
                  tasks={tasksByRecord[record.id]}
                  chemicalsAdded={chemAddedByRecord[record.id]}
                  ranges={ranges}
                  prevLog={prevLog}
                  brandColor={brandColor}
                />
              )
            })}
          </div>
        </div>
      )}

      {serviceRecords.length === 0 && (
        <Card className="text-center py-8">
          <p className="text-gray-400 text-sm">No services recorded yet for this pool.</p>
        </Card>
      )}
    </div>
  )
}

// ── Main Portal ──────────────────────────────────────────────────
export default function PublicPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [business, setBusiness] = useState(null)
  const [client, setClient] = useState(null)
  const [pools, setPools] = useState([])
  const [serviceRecords, setServiceRecords] = useState({})
  const [chemicalLogs, setChemicalLogs] = useState({})
  const [tasksByRecord, setTasksByRecord] = useState({})
  const [chemAddedByRecord, setChemAddedByRecord] = useState({})
  const [staffMembers, setStaffMembers] = useState([])
  const [activePool, setActivePool] = useState(null)

  useEffect(() => {
    if (!token) return
    fetchPortalData()
  }, [token])

  async function fetchPortalData() {
    try {
      setLoading(true)
      setError(null)

      const { data: portalPool, error: poolError } = await supabase
        .from('pools')
        .select('*, clients(*)')
        .eq('portal_token', token)
        .single()

      if (poolError || !portalPool) {
        setError('This portal link is invalid or has expired.')
        setLoading(false)
        return
      }

      const clientData = portalPool.clients
      setClient(clientData)

      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', clientData.business_id)
        .single()
      setBusiness(bizData)

      const { data: allPools } = await supabase
        .from('pools')
        .select('*')
        .eq('client_id', clientData.id)
        .order('address')
      setPools(allPools || [])
      if (allPools?.length > 0) setActivePool(allPools[0].id)

      // Fetch service records with tasks and chemicals added
      const poolIds = (allPools || []).map(p => p.id)
      if (poolIds.length > 0) {
        const { data: records } = await supabase
          .from('service_records')
          .select('*, service_tasks(*), chemicals_added(*)')
          .in('pool_id', poolIds)
          .eq('status', 'completed')
          .order('serviced_at', { ascending: false })
          .limit(poolIds.length * 20)

        const grouped = {}
        const tasksMap = {}
        const chemsMap = {}
        for (const record of (records || [])) {
          if (!grouped[record.pool_id]) grouped[record.pool_id] = []
          if (grouped[record.pool_id].length < 20) {
            grouped[record.pool_id].push(record)
          }
          tasksMap[record.id] = record.service_tasks || []
          chemsMap[record.id] = record.chemicals_added || []
        }
        setServiceRecords(grouped)
        setTasksByRecord(tasksMap)
        setChemAddedByRecord(chemsMap)

        const recordIds = (records || []).map(r => r.id)
        if (recordIds.length > 0) {
          const { data: logs } = await supabase
            .from('chemical_logs')
            .select('*')
            .in('service_record_id', recordIds)

          const logMap = {}
          for (const log of (logs || [])) {
            logMap[log.service_record_id] = log
          }
          setChemicalLogs(logMap)
        }
      }

      if (bizData?.id) {
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('*')
          .eq('business_id', bizData.id)
          .eq('is_active', true)
          .order('name')
        setStaffMembers(staffData || [])
      }
    } catch (err) {
      setError('Something went wrong loading the portal.')
    } finally {
      setLoading(false)
    }
  }

  // Stats
  const totalServices = Object.values(serviceRecords).flat().length
  const allLogs = Object.values(serviceRecords).flat().map(r => chemicalLogs[r.id]).filter(Boolean)
  const avgHealth = allLogs.length > 0
    ? Math.round(allLogs.reduce((sum, log) => {
        const s = calcHealthScore(log, pools.find(p => {
          const records = serviceRecords[p.id] || []
          return records.some(r => chemicalLogs[r.id] === log)
        })?.target_ranges || DEFAULT_TARGET_RANGES)
        return sum + (s || 0)
      }, 0) / allLogs.length)
    : null

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading your pool portal...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center py-12">
          <div className="text-5xl mb-4">🏊</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Portal Not Found</h2>
          <p className="text-gray-500">{error}</p>
        </Card>
      </div>
    )
  }

  const brandColor = business?.brand_colour || '#0EA5E9'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Branded Header */}
      <header className="w-full py-8 px-4 relative overflow-hidden" style={{ backgroundColor: brandColor }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 0%, transparent 50%), radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }} />
        <div className="max-w-3xl mx-auto relative">
          <div className="flex items-center gap-4 mb-4">
            {business?.logo_url && (
              <img src={business.logo_url} alt={business.name} className="h-14 w-14 rounded-xl object-cover bg-white/20 shadow-lg" />
            )}
            <div className="text-white">
              <h1 className="text-2xl font-bold">{business?.name || 'Pool Service'}</h1>
              <p className="text-sm opacity-75">Client Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-white/90 text-sm mt-2">
            {totalServices > 0 && (
              <div>
                <span className="text-2xl font-bold text-white">{totalServices}</span>
                <span className="ml-1 opacity-75">services</span>
              </div>
            )}
            {pools.length > 0 && (
              <div>
                <span className="text-2xl font-bold text-white">{pools.length}</span>
                <span className="ml-1 opacity-75">{pools.length === 1 ? 'pool' : 'pools'}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto w-full px-4 py-6 flex-1">
        {/* Welcome */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Welcome back, {client?.name}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Here's everything about your pool{pools.length > 1 ? 's' : ''} — service history, chemical trends, and upcoming schedule.
          </p>
        </div>

        {/* Pool Tabs (if multiple) */}
        {pools.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {pools.map(pool => (
              <button
                key={pool.id}
                onClick={() => setActivePool(pool.id)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[40px]',
                  activePool === pool.id
                    ? 'text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
                style={activePool === pool.id ? { backgroundColor: brandColor } : undefined}
              >
                {pool.address}
              </button>
            ))}
          </div>
        )}

        {/* Your Team */}
        {staffMembers.length > 0 && (
          <section className="mb-8">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Service Team</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {staffMembers.map(member => (
                <StaffCard key={member.id} staff={member} brandColor={brandColor} />
              ))}
            </div>
          </section>
        )}

        {/* Active Pool */}
        {pools.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-4xl mb-3">🏊</div>
            <p className="text-gray-500">No pools found for your account.</p>
          </Card>
        ) : (
          pools
            .filter(p => pools.length === 1 || p.id === activePool)
            .map(pool => (
              <PoolSection
                key={pool.id}
                pool={pool}
                serviceRecords={serviceRecords[pool.id] || []}
                chemicalLogs={chemicalLogs}
                tasksByRecord={tasksByRecord}
                chemAddedByRecord={chemAddedByRecord}
                brandColor={brandColor}
              />
            ))
        )}
      </div>

      {/* Footer */}
      <footer className="w-full border-t bg-white py-8 px-4 mt-auto">
        <div className="max-w-3xl mx-auto text-center text-sm text-gray-500 space-y-1">
          <p className="font-semibold text-gray-700">{business?.name}</p>
          <div className="flex items-center justify-center gap-4">
            {business?.phone && <p>{business.phone}</p>}
            {business?.email && <p>{business.email}</p>}
          </div>
          {business?.abn && <p className="text-xs text-gray-400">ABN: {business.abn}</p>}
          <p className="pt-3 text-xs text-gray-300">Powered by PoolPro</p>
        </div>
      </footer>
    </div>
  )
}
