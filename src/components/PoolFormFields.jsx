import Input, { Select, TextArea } from './ui/Input'
import AddressAutocomplete from './ui/AddressAutocomplete'
import { POOL_TYPES, POOL_SHAPES, SCHEDULE_FREQUENCIES, FREQUENCY_LABELS, cn } from '../lib/utils'
import { geocodeAddress } from '../lib/mapbox'

export const emptyPool = {
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
    volume_litres: volume_litres ? Number(volume_litres) : null,
    equipment: { pump_model, filter_type, heater },
    schedule_frequency: regular_service ? rest.schedule_frequency : null,
    next_due_at: regular_service ? (first_service_date || new Date().toISOString()) : null,
    access_notes: regular_service ? rest.access_notes : null,
    latitude: lat,
    longitude: lng,
    geocoded_at: lat != null ? new Date().toISOString() : null,
  }
}

const typeOptions = POOL_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))
const shapeOptions = POOL_SHAPES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const freqOptions = SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: FREQUENCY_LABELS[f] || f }))

export default function PoolFormFields({ poolForm, setPoolForm, clientAddress }) {
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
      {clientAddress && (
        <label className="flex items-center gap-2 min-h-tap cursor-pointer">
          <input
            type="checkbox"
            checked={poolForm.sameAsClient}
            onChange={handleSameAsClient}
            className="w-5 h-5 rounded border-gray-300 text-pool-500 focus:ring-pool-500"
          />
          <span className="text-sm text-gray-700">Same address as client</span>
        </label>
      )}

      {poolForm.sameAsClient ? (
        <Input label="Pool Address" value={poolForm.address} disabled />
      ) : (
        <AddressAutocomplete
          label="Pool Address"
          value={poolForm.address}
          onChange={(v) => setPoolForm(prev => ({ ...prev, address: v, latitude: null, longitude: null }))}
          onSelect={({ address, lat, lng }) =>
            setPoolForm(prev => ({ ...prev, address, latitude: lat, longitude: lng }))
          }
          placeholder="Start typing a street address..."
          required
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

      <label className="flex items-center justify-between min-h-tap cursor-pointer">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">Regular Servicing</span>
        </div>
        <div className={cn('relative w-11 h-6 rounded-full transition-colors',
          poolForm.regular_service ? 'bg-pool-500' : 'bg-gray-200')}>
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
            <Input
              label="First Service Date"
              name="first_service_date"
              type="date"
              value={poolForm.first_service_date}
              onChange={handlePoolChange}
            />
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

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Equipment</h3>
        <div className="space-y-3">
          <Input label="Pump Model" name="pump_model" value={poolForm.pump_model} onChange={handlePoolChange} placeholder="e.g. Astral CTX 280" />
          <Input label="Filter Type" name="filter_type" value={poolForm.filter_type} onChange={handlePoolChange} placeholder="e.g. Sand / Cartridge" />
          <Input label="Heater" name="heater" value={poolForm.heater} onChange={handlePoolChange} placeholder="e.g. Raypak 266A" />
        </div>
      </div>
    </>
  )
}
