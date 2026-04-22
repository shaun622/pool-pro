import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import Input, { Select, TextArea } from './ui/Input'
import AddressAutocomplete from './ui/AddressAutocomplete'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { POOL_TYPES, POOL_SHAPES, SCHEDULE_FREQUENCIES, FREQUENCY_LABELS, cn } from '../lib/utils'
import { geocodeAddress, MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../lib/mapbox'

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
      <label className={cn('flex items-center gap-2 min-h-tap', clientAddress ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')}>
        <input
          type="checkbox"
          checked={poolForm.sameAsClient}
          onChange={handleSameAsClient}
          disabled={!clientAddress}
          className="w-5 h-5 rounded border-gray-300 text-pool-500 focus:ring-pool-500"
        />
        <span className="text-sm text-gray-700">Same address as client</span>
        {!clientAddress && <span className="text-xs text-gray-400">(no address on file)</span>}
      </label>

      {poolForm.sameAsClient ? (
        <Input label="Pool Address" value={poolForm.address} disabled />
      ) : (
        <>
          <AddressAutocomplete
            label="Pool Address"
            value={poolForm.address}
            onChange={(v) => setPoolForm(prev => ({ ...prev, address: v, latitude: null, longitude: null }))}
            onSelect={({ address, lat, lng }) =>
              setPoolForm(prev => ({ ...prev, address, latitude: lat, longitude: lng }))
            }
            placeholder="Start typing an address (or type freely if not found)..."
          />
          <ManualPinPicker
            address={poolForm.address}
            lat={poolForm.latitude}
            lng={poolForm.longitude}
            onPick={({ lat, lng }) => setPoolForm(prev => ({ ...prev, latitude: lat, longitude: lng }))}
          />
        </>
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

// Pin icon for the picker map
const pinIcon = L.divIcon({
  className: 'manual-pin',
  html: `<div style="
    background:#0CA5EB;color:white;width:32px;height:32px;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);
  "><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="transform:rotate(45deg);"><path d="M5 13l4 4L19 7"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
})

function ClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function FlyTo({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lng != null) {
      map.flyTo([lat, lng], 16, { duration: 0.5 })
    }
  }, [lat, lng, map])
  return null
}

function ManualPinPicker({ address, lat, lng, onPick }) {
  const [open, setOpen] = useState(false)
  const [tempLat, setTempLat] = useState(lat)
  const [tempLng, setTempLng] = useState(lng)
  const [searching, setSearching] = useState(false)

  // Default to Bali center if no coords yet (good for the user's use case)
  const initialLat = lat ?? -8.4095
  const initialLng = lng ?? 115.1889

  function handleOpen() {
    setTempLat(lat)
    setTempLng(lng)
    setOpen(true)
  }

  function handleConfirm() {
    if (tempLat != null && tempLng != null) {
      onPick({ lat: tempLat, lng: tempLng })
    }
    setOpen(false)
  }

  async function handleSearchAddress() {
    if (!address) return
    setSearching(true)
    try {
      const geo = await geocodeAddress(address)
      if (geo) {
        setTempLat(geo.lat)
        setTempLng(geo.lng)
      }
    } finally {
      setSearching(false)
    }
  }

  const hasCoords = lat != null && lng != null

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-xs font-medium transition-colors',
          hasCoords
            ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
        )}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {hasCoords ? 'Pin set — tap to adjust' : 'Drop pin manually on map'}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Drop Pin">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Tap anywhere on the map to drop a pin at the pool location. Useful when the address can't be found.
          </p>
          {address && (
            <button
              type="button"
              onClick={handleSearchAddress}
              disabled={searching}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-pool-50 border border-pool-200 text-pool-700 text-xs font-medium hover:bg-pool-100 disabled:opacity-50"
            >
              {searching ? 'Searching…' : `Try to find "${address.slice(0, 30)}${address.length > 30 ? '...' : ''}" on map`}
            </button>
          )}
          <div className="h-72 rounded-xl overflow-hidden border border-gray-200">
            <MapContainer
              center={[tempLat ?? initialLat, tempLng ?? initialLng]}
              zoom={tempLat != null ? 16 : 11}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer url={MAPBOX_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} attribution={MAPBOX_ATTRIBUTION} />
              <ClickHandler onClick={(la, ln) => { setTempLat(la); setTempLng(ln) }} />
              {tempLat != null && tempLng != null && (
                <Marker position={[tempLat, tempLng]} icon={pinIcon} />
              )}
              <FlyTo lat={tempLat} lng={tempLng} />
            </MapContainer>
          </div>
          {tempLat != null && tempLng != null && (
            <p className="text-xs text-gray-500 text-center">
              {tempLat.toFixed(5)}, {tempLng.toFixed(5)}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleConfirm} disabled={tempLat == null || tempLng == null} className="flex-1">
              Confirm Pin
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
