import Input, { Select, TextArea } from './ui/Input'
import LocationField from './ui/LocationField'
import { POOL_TYPES, POOL_SHAPES, SCHEDULE_FREQUENCIES, FREQUENCY_LABELS, cn, formatDateWithDay } from '../lib/utils'
import { geocodeAddress } from '../lib/mapbox'

export const emptyPool = {
  name: '',
  address: '',
  latitude: null,
  longitude: null,
  sameAsClient: false,
  type: 'chlorine',
  volume_litres: '',
  shape: 'rectangular',
  regular_service: true,
  schedule_frequency: 'weekly',
  access_notes: '',
  pump_model: '',
  filter_type: '',
  heater: '',
  first_service_date: new Date().toISOString().split('T')[0],
}

// Convert a poolForm state object into the payload we actually insert into the DB.
// Handles geocoding fallback so callers don't have to.
export async function buildPoolPayload(poolForm) {
  const { pump_model, filter_type, heater, volume_litres, sameAsClient, first_service_date, regular_service, latitude, longitude, ...rest } = poolForm
  let lat = latitude
  let lng = longitude
  if ((lat == null || lng == null) && rest.address) {
    const geo = await geocodeAddress(rest.address)
    lat = geo?.lat ?? null
    lng = geo?.lng ?? null
  }
  return {
    ...rest,
    name: rest.name?.trim() || null,
    volume_litres: volume_litres ? Number(volume_litres) : null,
    equipment: { pump_model, filter_type, heater },
    schedule_frequency: regular_service ? rest.schedule_frequency : null,
    // next_due_at is deliberately NOT set here. It is the scheduling cache owned
    // by recomputePoolNextDue.js; the create sites write it AFTER insert via
    // setPoolNextDue(id, initialPoolDueDate(poolForm)). Writing it in this
    // payload (then spreading into .insert) was an un-routed write that the
    // single-writer guard could not see — hence the split.
    access_notes: regular_service ? rest.access_notes : null,
    latitude: lat,
    longitude: lng,
    geocoded_at: lat != null ? new Date().toISOString() : null,
  }
}

// The legacy-pool first due date, derived from the create form. A pool created
// here has no recurring_job_profile, so its next_due_at is operator-set (=
// first service date) — exactly the "legacy bootstrap" setPoolNextDue handles.
// Returns a 'YYYY-MM-DD' string, or null when servicing is off. Call sites pass
// this to setPoolNextDue(newPoolId, ...) right after the insert.
export function initialPoolDueDate(poolForm) {
  if (!poolForm?.regular_service) return null
  return poolForm.first_service_date || new Date().toISOString().split('T')[0]
}

// Edit-safe payload â€” attribute fields only. Deliberately OMITS
// next_due_at and schedule_frequency: the recurring flow + the
// ClientDetail "Schedule" modal own a pool's schedule, and buildPoolPayload
// (create) unconditionally rewrites next_due_at from first_service_date,
// which would wipe a live schedule on every pool edit. Used by EditPoolModal.
export async function buildPoolUpdatePayload(poolForm) {
  const { pump_model, filter_type, heater, volume_litres, sameAsClient, first_service_date, regular_service, schedule_frequency, next_due_at, latitude, longitude, ...rest } = poolForm
  let lat = latitude
  let lng = longitude
  if ((lat == null || lng == null) && rest.address) {
    const geo = await geocodeAddress(rest.address)
    lat = geo?.lat ?? null
    lng = geo?.lng ?? null
  }
  return {
    name: rest.name?.trim() || null,
    address: rest.address,
    type: rest.type,
    shape: rest.shape,
    volume_litres: volume_litres ? Number(volume_litres) : null,
    equipment: { pump_model, filter_type, heater },
    access_notes: rest.access_notes || null,
    latitude: lat,
    longitude: lng,
    ...(lat != null ? { geocoded_at: new Date().toISOString() } : {}),
  }
}

const typeOptions = POOL_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))
const shapeOptions = POOL_SHAPES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const freqOptions = SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: FREQUENCY_LABELS[f] || f }))

export default function PoolFormFields({ poolForm, setPoolForm, clientAddress, showSchedule = true }) {
  const handlePoolChange = (e) => {
    setPoolForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSameAsClient = (e) => {
    const checked = e.target.checked
    setPoolForm(prev => ({
      ...prev,
      sameAsClient: checked,
      address: checked ? (clientAddress || '') : '',
    }))
  }

  return (
    <>
      <Input
        label="Pool Name"
        name="name"
        value={poolForm.name || ''}
        onChange={handlePoolChange}
        placeholder="e.g. Main pool, Spa, Rooftop (optional)"
      />

      <label className={cn('flex items-center gap-2 min-h-tap', clientAddress ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}>
        <input
          type="checkbox"
          checked={poolForm.sameAsClient}
          onChange={handleSameAsClient}
          disabled={!clientAddress}
          className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-pool-500 focus:ring-pool-500 dark:bg-gray-800"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">Same address as client</span>
        {!clientAddress && <span className="text-xs text-gray-400 dark:text-gray-500">(no address on file)</span>}
      </label>

      {poolForm.sameAsClient ? (
        <Input label="Pool Address" value={poolForm.address} disabled />
      ) : (
        <LocationField
          label="Pool Address"
          placeholder="Start typing an address (or type freely if not found)..."
          address={poolForm.address}
          lat={poolForm.latitude}
          lng={poolForm.longitude}
          onChange={({ address, lat, lng }) =>
            setPoolForm(prev => ({ ...prev, address, latitude: lat, longitude: lng }))
          }
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Select label="Pool Type" name="type" value={poolForm.type} onChange={handlePoolChange} options={typeOptions} />
        <Select label="Shape" name="shape" value={poolForm.shape} onChange={handlePoolChange} options={shapeOptions} />
      </div>

      <Input
        label="Volume (litres)"
        name="volume_litres"
        type="number"
        value={poolForm.volume_litres}
        onChange={handlePoolChange}
        placeholder="e.g. 50000"
      />

      {/* Scheduling block â€” create flow only. In edit mode the schedule is
          owned by the recurring flow + the ClientDetail "Schedule" modal,
          so we hide it (and buildPoolUpdatePayload never touches next_due_at). */}
      {showSchedule && (
        <>
          <label className="flex items-center justify-between min-h-tap cursor-pointer">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Regular Servicing</span>
            </div>
            <div className={cn('relative w-11 h-6 rounded-full transition-colors',
              poolForm.regular_service ? 'bg-pool-500' : 'bg-gray-200 dark:bg-gray-700')}>
              <div className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                poolForm.regular_service ? 'translate-x-[22px]' : 'translate-x-0.5')} />
              <input type="checkbox" className="sr-only"
                checked={poolForm.regular_service}
                onChange={e => setPoolForm(prev => ({ ...prev, regular_service: e.target.checked }))} />
            </div>
          </label>

          {poolForm.regular_service && (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Frequency"
                  name="schedule_frequency"
                  value={poolForm.schedule_frequency}
                  onChange={handlePoolChange}
                  options={freqOptions}
                />
                <div>
                  <Input
                    label="First Service Date"
                    name="first_service_date"
                    type="date"
                    value={poolForm.first_service_date}
                    onChange={handlePoolChange}
                  />
                  {poolForm.first_service_date && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDateWithDay(poolForm.first_service_date)}</p>
                  )}
                </div>
              </div>
              <TextArea
                label="Notes"
                name="access_notes"
                value={poolForm.access_notes}
                onChange={handlePoolChange}
                placeholder="Gate code, dog, key location..."
              />
            </div>
          )}
        </>
      )}

      {/* Edit mode keeps Access Notes available without the schedule block. */}
      {!showSchedule && (
        <TextArea
          label="Access Notes"
          name="access_notes"
          value={poolForm.access_notes}
          onChange={handlePoolChange}
          placeholder="Gate code, dog, key location..."
        />
      )}

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Equipment</h3>
        <div className="space-y-3">
          <Input label="Pump Model" name="pump_model" value={poolForm.pump_model} onChange={handlePoolChange} placeholder="e.g. Astral CTX 280" />
          <Input label="Filter Type" name="filter_type" value={poolForm.filter_type} onChange={handlePoolChange} placeholder="e.g. Sand / Cartridge" />
          <Input label="Heater" name="heater" value={poolForm.heater} onChange={handlePoolChange} placeholder="e.g. Raypak 266A" />
        </div>
      </div>
    </>
  )
}
