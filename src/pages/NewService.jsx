import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import { useService } from '../hooks/useService'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import Badge from '../components/ui/Badge'
import {
  getChemicalStatus,
  statusDot,
  formatDate,
  calculateNextDue,
  DEFAULT_TASKS,
  CHEMICAL_UNITS,
  CHEMICAL_LABELS,
  DEFAULT_TARGET_RANGES,
  FREQUENCY_LABELS,
  cn,
} from '../lib/utils'

const STEPS = ['Chemicals', 'Tasks', 'Added', 'Review']

const READING_FIELDS = [
  { key: 'ph', rangeKey: 'ph' },
  { key: 'free_chlorine', rangeKey: 'free_cl' },
  { key: 'total_chlorine', rangeKey: 'total_cl' },
  { key: 'alkalinity', rangeKey: 'alk' },
  { key: 'stabiliser', rangeKey: 'stabiliser' },
  { key: 'calcium_hardness', rangeKey: 'calcium' },
  { key: 'salt', rangeKey: 'salt', saltOnly: true },
]

const UNIT_OPTIONS = CHEMICAL_UNITS.map(u => ({ value: u, label: u }))

export default function NewService() {
  const { id: poolId } = useParams()
  const navigate = useNavigate()
  const { business } = useBusiness()
  const {
    loading: serviceLoading,
    createServiceRecord,
    saveChemicalLog,
    saveTasks,
    saveChemicalsAdded,
    completeService,
  } = useService()

  const [pool, setPool] = useState(null)
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)

  // Step 1: Chemical readings
  const [readings, setReadings] = useState({
    ph: '',
    free_chlorine: '',
    total_chlorine: '',
    alkalinity: '',
    stabiliser: '',
    calcium_hardness: '',
    salt: '',
  })

  // Step 2: Task checklist
  const [tasks, setTasks] = useState(
    DEFAULT_TASKS.map(name => ({ name, completed: false }))
  )

  // Step 3: Chemicals added
  const [chemicalsAdded, setChemicalsAdded] = useState([])

  // Step 4: Notes
  const [notes, setNotes] = useState('')

  useEffect(() => {
    loadPool()
  }, [poolId])

  async function loadPool() {
    try {
      const { data, error } = await supabase
        .from('pools')
        .select('*, clients(*)')
        .eq('id', poolId)
        .single()
      if (error) throw error
      setPool(data)
      setClient(data.clients)
    } catch (err) {
      console.error('Error loading pool:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleReadingChange(key, value) {
    setReadings(prev => ({ ...prev, [key]: value }))
  }

  function toggleTask(index) {
    setTasks(prev =>
      prev.map((t, i) => (i === index ? { ...t, completed: !t.completed } : t))
    )
  }

  function addChemical() {
    setChemicalsAdded(prev => [...prev, { product_name: '', quantity: '', unit: 'L' }])
  }

  function updateChemical(index, field, value) {
    setChemicalsAdded(prev =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    )
  }

  function removeChemical(index) {
    setChemicalsAdded(prev => prev.filter((_, i) => i !== index))
  }

  async function handleComplete() {
    setSubmitting(true)
    try {
      // Create service record
      const record = await createServiceRecord(poolId, business?.owner_name || 'Owner')

      // Save chemical readings (convert empty strings to null)
      const cleanReadings = {}
      for (const [k, v] of Object.entries(readings)) {
        cleanReadings[k] = v === '' ? null : parseFloat(v)
      }
      await saveChemicalLog(record.id, cleanReadings)

      // Save tasks
      await saveTasks(record.id, tasks)

      // Save chemicals added (filter out empty entries)
      const validChemicals = chemicalsAdded.filter(c => c.product_name && c.quantity)
      await saveChemicalsAdded(record.id, validChemicals.map(c => ({
        ...c,
        quantity: parseFloat(c.quantity) || 0,
      })))

      // Complete the service
      await completeService(record.id, poolId, notes)

      setCompleted(true)
    } catch (err) {
      console.error('Error completing service:', err)
      alert('Failed to complete service. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const targetRanges = pool?.target_ranges || DEFAULT_TARGET_RANGES
  const completedCount = tasks.filter(t => t.completed).length
  const isSaltPool = pool?.pool_type === 'salt'

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

  return (
    <>
      <Header title="New Service" backTo={`/pools/${poolId}`} />
      <PageWrapper>
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            {STEPS.map((label, i) => (
              <button
                key={label}
                onClick={() => setStep(i)}
                className={cn(
                  'text-xs font-medium min-h-[44px] px-1 flex items-center',
                  i === step ? 'text-pool-600' : i < step ? 'text-green-600' : 'text-gray-400'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-pool-500 rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: Chemical Readings */}
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Chemical Readings</h2>
            {READING_FIELDS.map(({ key, rangeKey, saltOnly }) => {
              if (saltOnly && !isSaltPool) return null
              const info = CHEMICAL_LABELS[key]
              const value = readings[key]
              const range = targetRanges[rangeKey]
              const status = value !== '' ? getChemicalStatus(parseFloat(value), range) : 'neutral'
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className={cn('w-3 h-3 rounded-full flex-shrink-0', statusDot(status))} />
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {info?.label || key}
                      {info?.unit && <span className="text-gray-400 ml-1">{info.unit}</span>}
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={value}
                      onChange={e => handleReadingChange(key, e.target.value)}
                      placeholder={range ? `${range[0]} - ${range[1]}` : ''}
                      className="input-lg w-full text-lg"
                    />
                  </div>
                </div>
              )
            })}
            <Button onClick={() => setStep(1)} className="w-full min-h-[48px] mt-4">
              Next: Tasks
            </Button>
          </div>
        )}

        {/* Step 2: Task Checklist */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Task Checklist</h2>
              <span className="text-sm text-gray-500">{completedCount}/{tasks.length}</span>
            </div>
            <div className="space-y-2">
              {tasks.map((task, i) => (
                <button
                  key={task.name}
                  onClick={() => toggleTask(i)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 rounded-xl border text-left transition-colors',
                    'min-h-[44px]',
                    task.completed
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  )}
                >
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
                  <span className="text-sm font-medium">{task.name}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(0)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button onClick={() => setStep(2)} className="flex-1 min-h-[48px]">
                Next: Chemicals
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Chemicals Added */}
        {step === 2 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Chemicals Added</h2>
            {chemicalsAdded.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">
                No chemicals added yet. Tap the button below to add one.
              </p>
            )}
            {chemicalsAdded.map((chem, i) => (
              <Card key={i} className="relative">
                <button
                  onClick={() => removeChemical(i)}
                  className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-red-400 hover:text-red-600"
                  aria-label="Remove"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="space-y-3 pr-8">
                  <Input
                    label="Product Name"
                    value={chem.product_name}
                    onChange={e => updateChemical(i, 'product_name', e.target.value)}
                    placeholder="e.g. Liquid Chlorine"
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        label="Quantity"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={chem.quantity}
                        onChange={e => updateChemical(i, 'quantity', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="w-24">
                      <Select
                        label="Unit"
                        options={UNIT_OPTIONS}
                        value={chem.unit}
                        onChange={e => updateChemical(i, 'unit', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
            <Button variant="secondary" onClick={addChemical} className="w-full min-h-[48px]">
              + Add Chemical
            </Button>
            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setStep(1)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1 min-h-[48px]">
                Next: Review
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Complete */}
        {step === 3 && !completed && (
          <div className="space-y-4">
            {/* Pool & Client header */}
            <Card className="bg-pool-50 border-pool-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-pool-600 font-medium">{client?.name}</p>
                  <p className="text-base font-semibold text-gray-900">{pool?.address}</p>
                </div>
                <Badge variant={pool?.type || 'default'}>{pool?.type}</Badge>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span>{formatDate(new Date())}</span>
                <span>{FREQUENCY_LABELS[pool?.schedule_frequency] || pool?.schedule_frequency}</span>
              </div>
            </Card>

            {/* Chemical readings summary */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Chemical Readings</h3>
              <div className="space-y-2">
                {READING_FIELDS.map(({ key, rangeKey, saltOnly }) => {
                  if (saltOnly && !isSaltPool) return null
                  const value = readings[key]
                  if (value === '') return null
                  const info = CHEMICAL_LABELS[key]
                  const range = targetRanges[rangeKey]
                  const status = getChemicalStatus(parseFloat(value), range)
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(status))} />
                        <span className="text-sm text-gray-700">{info?.label}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-900">{value}</span>
                        <span className="text-xs text-gray-400 ml-1">{info?.unit}</span>
                        {range && (
                          <span className="text-xs text-gray-400 ml-2">({range[0]}-{range[1]})</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {Object.values(readings).every(v => v === '') && (
                  <p className="text-sm text-gray-400 text-center py-2">No readings recorded</p>
                )}
              </div>
            </Card>

            {/* Tasks summary */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Tasks</h3>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  completedCount === tasks.length ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                )}>
                  {completedCount}/{tasks.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {tasks.map(task => (
                  <div key={task.name} className="flex items-center gap-2 text-sm">
                    {task.completed ? (
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span className={task.completed ? 'text-gray-900' : 'text-gray-400'}>
                      {task.name}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Chemicals added summary */}
            {chemicalsAdded.length > 0 && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Chemicals Added</h3>
                <div className="space-y-2">
                  {chemicalsAdded.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{c.product_name}</span>
                      <span className="font-medium text-gray-900">{c.quantity} {c.unit}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Next service */}
            <Card className="bg-gray-50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next service due</span>
                <span className="text-sm font-semibold text-gray-900">
                  {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                </span>
              </div>
            </Card>

            {/* Notes */}
            <TextArea
              label="Notes / Recommendations"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes for the client or for next visit..."
              rows={3}
            />

            {/* Email notice */}
            <p className="text-xs text-gray-400 text-center">
              {client?.email
                ? `A service report will be emailed to ${client.email}`
                : 'No client email set — report will be saved but not emailed'}
            </p>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(2)} className="flex-1 min-h-[48px]">
                Back
              </Button>
              <Button
                onClick={handleComplete}
                loading={submitting}
                className="flex-1 min-h-[52px] text-base font-semibold bg-green-600 hover:bg-green-700 active:bg-green-800"
              >
                Complete Service
              </Button>
            </div>
          </div>
        )}

        {/* Completion success screen */}
        {completed && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Service Complete</h2>
            <p className="text-sm text-gray-500 mb-1">{pool?.address}</p>
            {client?.email && (
              <p className="text-sm text-green-600 mb-4">
                Report sent to {client.email}
              </p>
            )}
            <Card className="w-full bg-gray-50 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next service</span>
                <span className="text-sm font-semibold text-pool-600">
                  {formatDate(calculateNextDue(new Date(), pool?.schedule_frequency || 'weekly'))}
                </span>
              </div>
            </Card>
            <div className="flex gap-3 w-full">
              <Button
                variant="secondary"
                className="flex-1 min-h-[48px]"
                onClick={() => navigate(`/pools/${poolId}`)}
              >
                View Pool
              </Button>
              <Button
                className="flex-1 min-h-[48px]"
                onClick={() => navigate('/route')}
              >
                Next Pool
              </Button>
            </div>
          </div>
        )}
      </PageWrapper>
    </>
  )
}
