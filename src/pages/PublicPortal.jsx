import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { supabase } from '../lib/supabase'
import { formatDate, getChemicalStatus, statusColor, CHEMICAL_LABELS } from '../lib/utils'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'

const CHEMICAL_KEYS = ['ph', 'free_chlorine', 'total_chlorine', 'alkalinity', 'stabiliser', 'calcium_hardness', 'salt']

function ChemicalCell({ value, chemKey, ranges }) {
  if (value == null) return <td className="px-2 py-1.5 text-center text-gray-300 text-sm">--</td>
  const range = ranges?.[chemKey]
  const status = getChemicalStatus(value, range)
  const colors = statusColor(status)
  return (
    <td className={`px-2 py-1.5 text-center text-sm font-medium border ${colors}`}>
      {value}
    </td>
  )
}

function MiniChart({ data, dataKey, color }) {
  if (!data || data.length < 2) return null
  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function PoolSection({ pool, serviceRecords, brandColor }) {
  const readings = serviceRecords
    .filter(r => r.chemical_readings)
    .map(r => ({
      date: formatDate(r.serviced_at),
      ...r.chemical_readings,
    }))
    .reverse()

  const poolTypeBadge = {
    chlorine: 'chlorine',
    salt: 'salt',
    mineral: 'mineral',
    freshwater: 'freshwater',
  }

  const trendColors = {
    ph: '#6366f1',
    free_chlorine: '#3b82f6',
    total_chlorine: '#06b6d4',
    alkalinity: '#10b981',
    stabiliser: '#f59e0b',
    calcium_hardness: '#8b5cf6',
    salt: '#0ea5e9',
  }

  return (
    <div className="mb-8">
      <Card className="mb-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">{pool.address_line}</h3>
            {pool.address_line_2 && (
              <p className="text-sm text-gray-500">{pool.address_line_2}</p>
            )}
            <p className="text-sm text-gray-500">
              {[pool.suburb, pool.state, pool.postcode].filter(Boolean).join(', ')}
            </p>
          </div>
          <Badge variant={poolTypeBadge[pool.pool_type] || 'default'}>
            {pool.pool_type}
          </Badge>
        </div>

        {(pool.volume_litres || pool.surface_type || pool.filter_type || pool.pump_model) && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {pool.volume_litres && (
              <div>
                <span className="text-gray-500">Volume:</span>{' '}
                <span className="font-medium">{pool.volume_litres.toLocaleString()}L</span>
              </div>
            )}
            {pool.surface_type && (
              <div>
                <span className="text-gray-500">Surface:</span>{' '}
                <span className="font-medium capitalize">{pool.surface_type}</span>
              </div>
            )}
            {pool.filter_type && (
              <div>
                <span className="text-gray-500">Filter:</span>{' '}
                <span className="font-medium capitalize">{pool.filter_type}</span>
              </div>
            )}
            {pool.pump_model && (
              <div>
                <span className="text-gray-500">Pump:</span>{' '}
                <span className="font-medium">{pool.pump_model}</span>
              </div>
            )}
            {pool.chlorinator_model && (
              <div>
                <span className="text-gray-500">Chlorinator:</span>{' '}
                <span className="font-medium">{pool.chlorinator_model}</span>
              </div>
            )}
            {pool.pool_shape && (
              <div>
                <span className="text-gray-500">Shape:</span>{' '}
                <span className="font-medium capitalize">{pool.pool_shape}</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Chemical Readings Table */}
      {readings.length > 0 && (
        <Card className="mb-4 overflow-x-auto">
          <h4 className="font-semibold text-gray-900 mb-3">Chemical Readings</h4>
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b">
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Date</th>
                {CHEMICAL_KEYS.map(key => (
                  <th key={key} className="text-center px-2 py-1.5 text-gray-500 font-medium whitespace-nowrap">
                    {CHEMICAL_LABELS[key]?.label || key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {serviceRecords
                .filter(r => r.chemical_readings)
                .map(record => (
                  <tr key={record.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                      {formatDate(record.serviced_at)}
                    </td>
                    {CHEMICAL_KEYS.map(key => (
                      <ChemicalCell
                        key={key}
                        value={record.chemical_readings?.[key]}
                        chemKey={key}
                        ranges={pool.target_ranges}
                      />
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Chemical Trends */}
      {readings.length >= 2 && (
        <Card className="mb-4">
          <h4 className="font-semibold text-gray-900 mb-3">Chemical Trends</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {CHEMICAL_KEYS.map(key => {
              const hasData = readings.some(r => r[key] != null)
              if (!hasData) return null
              return (
                <div key={key}>
                  <p className="text-xs text-gray-500 mb-1 font-medium">
                    {CHEMICAL_LABELS[key]?.label || key}
                  </p>
                  <MiniChart
                    data={readings.filter(r => r[key] != null)}
                    dataKey={key}
                    color={trendColors[key] || brandColor || '#3b82f6'}
                  />
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Service Records */}
      {serviceRecords.length > 0 && (
        <Card>
          <h4 className="font-semibold text-gray-900 mb-3">Recent Service History</h4>
          <div className="space-y-3">
            {serviceRecords.map(record => (
              <div key={record.id} className="border-b last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900 text-sm">
                    {formatDate(record.serviced_at)}
                  </span>
                  {record.status && (
                    <Badge variant={record.status === 'completed' ? 'success' : 'warning'}>
                      {record.status}
                    </Badge>
                  )}
                </div>
                {record.tasks_completed && record.tasks_completed.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {record.tasks_completed.map((task, i) => (
                      <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {task}
                      </span>
                    ))}
                  </div>
                )}
                {record.notes && (
                  <p className="text-sm text-gray-500 mt-1">{record.notes}</p>
                )}
                {record.chemicals_added && record.chemicals_added.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {record.chemicals_added.map((chem, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        {chem.chemical}: {chem.amount}{chem.unit}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

export default function PublicPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [business, setBusiness] = useState(null)
  const [client, setClient] = useState(null)
  const [pools, setPools] = useState([])
  const [serviceRecords, setServiceRecords] = useState({})

  useEffect(() => {
    if (!token) return
    fetchPortalData()
  }, [token])

  async function fetchPortalData() {
    try {
      setLoading(true)
      setError(null)

      // Fetch the pool with this portal token to find the client
      const { data: portalPool, error: poolError } = await supabase
        .from('pools')
        .select('*, client:clients(*)')
        .eq('portal_token', token)
        .single()

      if (poolError || !portalPool) {
        setError('This portal link is invalid or has expired.')
        setLoading(false)
        return
      }

      const clientData = portalPool.client
      setClient(clientData)

      // Fetch business
      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', clientData.business_id)
        .single()

      setBusiness(bizData)

      // Fetch all pools for this client
      const { data: allPools } = await supabase
        .from('pools')
        .select('*')
        .eq('client_id', clientData.id)
        .order('address_line')

      setPools(allPools || [])

      // Fetch last 10 service records per pool
      const poolIds = (allPools || []).map(p => p.id)
      if (poolIds.length > 0) {
        const { data: records } = await supabase
          .from('service_records')
          .select('*')
          .in('pool_id', poolIds)
          .order('serviced_at', { ascending: false })
          .limit(poolIds.length * 10)

        // Group by pool_id, max 10 each
        const grouped = {}
        for (const record of (records || [])) {
          if (!grouped[record.pool_id]) grouped[record.pool_id] = []
          if (grouped[record.pool_id].length < 10) {
            grouped[record.pool_id].push(record)
          }
        }
        setServiceRecords(grouped)
      }
    } catch (err) {
      setError('Something went wrong loading the portal.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Loading your pool portal...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center py-12">
          <div className="text-4xl mb-4">:(</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Portal Not Found</h2>
          <p className="text-gray-500">{error}</p>
        </Card>
      </div>
    )
  }

  const brandColor = business?.brand_colour || '#2563eb'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Branded Header */}
      <header
        className="w-full py-6 px-4"
        style={{ backgroundColor: brandColor }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          {business?.logo_url && (
            <img
              src={business.logo_url}
              alt={business.name}
              className="h-12 w-12 rounded-lg object-cover bg-white/20"
            />
          )}
          <div className="text-white">
            <h1 className="text-xl font-bold">{business?.name || 'Pool Service'}</h1>
            <p className="text-sm opacity-80">Client Portal</p>
          </div>
        </div>
      </header>

      {/* Client Info */}
      <div className="max-w-3xl mx-auto w-full px-4 py-6 flex-1">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Welcome, {client?.first_name} {client?.last_name}
          </h2>
          <p className="text-sm text-gray-500">
            View your pool service history and chemical readings below.
          </p>
        </div>

        {pools.length === 0 ? (
          <Card className="text-center py-8">
            <p className="text-gray-500">No pools found for your account.</p>
          </Card>
        ) : (
          pools.map(pool => (
            <PoolSection
              key={pool.id}
              pool={pool}
              serviceRecords={serviceRecords[pool.id] || []}
              brandColor={brandColor}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="w-full border-t bg-white py-6 px-4 mt-auto">
        <div className="max-w-3xl mx-auto text-center text-sm text-gray-500 space-y-1">
          <p className="font-medium text-gray-700">{business?.name}</p>
          {business?.phone && <p>Phone: {business.phone}</p>}
          {business?.email && <p>Email: {business.email}</p>}
          {business?.address && <p>{business.address}</p>}
          {business?.abn && <p>ABN: {business.abn}</p>}
          <p className="pt-2 text-xs text-gray-400">
            Powered by PoolPro
          </p>
        </div>
      </footer>
    </div>
  )
}
