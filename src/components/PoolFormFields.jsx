import Input, { Select, TextArea } from './ui/Input'
import LocationField from './ui/LocationField'
import { POOL_TYPES, POOL_SHAPES, cn } from '../lib/utils'
import { geocodeAddress } from '../lib/mapbox'

// A pool is now PURE ATTRIBUTES — no scheduling. Scheduling lives only in
// recurring services (recurring_job_profiles), created via /recurring. The old
// pool-level schedule_frequency / first_service_date / next_due_at bootstrap
// was removed (it produced fragile "legacy" schedules with no profile).
export const emptyPool = {
  name: '',
  address: '',
  latitude: null,
  longitude: null,
  sameAsClient: false,
  type: 'chlorine',
  volume_litres: '',
  shape: 'rectangular',
  access_notes: '',
  pump_model: '',
  filter_type: '',
  chlorinator: '',
}

// Convert a poolForm state object into the payload we actually insert into the DB.
// Handles geocoding fallback so callers don't have to.
export async function buildPoolPayload(poolForm) {
  // schedule_frequency / next_due_at are intentionally NOT set — a pool carries
  // no schedule. Scheduling is created separately as a recurring service.
  const { pump_model, filter_type, chlorinator, volume_litres, sameAsClient, schedule_frequency, next_due_at, latitude, longitude, ...rest } = poolForm
  // Guard: never let a stray `undefined`-named key (from a malformed change event)
  // reach the insert as a bogus column — Postgres would reject the whole row with
  // "Could not find the 'undefined' column of 'pools'".
  delete rest.undefined
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
    equipment: { pump_model, filter_type, chlorinator },
    access_notes: rest.access_notes || null,
    latitude: lat,
    longitude: lng,
    geocoded_at: lat != null ? new Date().toISOString() : null,
  }
}

// Edit-safe payload Ã¢â‚¬â€ attribute fields only. Deliberately OMITS
// next_due_at and schedule_frequency: the recurring flow + the
// ClientDetail "Schedule" modal own a pool's schedule, and buildPoolPayload
// (create) unconditionally rewrites next_due_at from first_service_date,
// which would wipe a live schedule on every pool edit. Used by EditPoolModal.
export async function buildPoolUpdatePayload(poolForm) {
  const { pump_model, filter_type, chlorinator, volume_litres, sameAsClient, first_service_date, regular_service, schedule_frequency, next_due_at, latitude, longitude, ...rest } = poolForm
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
    equipment: { pump_model, filter_type, chlorinator },
    access_notes: rest.access_notes || null,
    latitude: lat,
    longitude: lng,
    ...(lat != null ? { geocoded_at: new Date().toISOString() } : {}),
  }
}

const typeOptions = POOL_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))
const shapeOptions = POOL_SHAPES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))

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

      {/* Scheduling block Ã¢â‚¬â€ create flow only. In edit mode the schedule is
          configured as a recurring service (/recurring), not on the pool. */}
      <TextArea
        label="Access Notes"
        name="access_notes"
        value={poolForm.access_notes}
        onChange={handlePoolChange}
        placeholder="Gate code, dog, key location..."
      />

      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Equipment</h3>
        <div className="space-y-3">
          <Input label="Pump Model" name="pump_model" value={poolForm.pump_model} onChange={handlePoolChange} placeholder="e.g. Astral CTX 280" />
          <Input label="Filter Type" name="filter_type" value={poolForm.filter_type} onChange={handlePoolChange} placeholder="e.g. Sand / Cartridge" />
          <Input label="Chlorinator" name="chlorinator" value={poolForm.chlorinator} onChange={handlePoolChange} placeholder="e.g. Zodiac eXO, Astral VX" />
        </div>
      </div>
    </>
  )
}
