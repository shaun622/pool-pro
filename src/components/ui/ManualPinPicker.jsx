import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import Modal from './Modal'
import Button from './Button'
import { cn } from '../../lib/utils'
import { geocodeAddress, reverseGeocode, MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from '../../lib/mapbox'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'

// Hardcoded ultimate fallback for the manual pin map — Sanur, Bali. Used
// when the browser blocks geolocation and the business hasn't pinned a
// location yet.
const SANUR = { lat: -8.6803, lng: 115.2623 }

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

// Recenter the map onto the resolved fallback location, but only while
// the operator hasn't placed a pin yet — once they tap, FlyTo (above)
// takes over and we shouldn't yank them back.
function FlyToDefault({ lat, lng, hasTemp }) {
  const map = useMap()
  useEffect(() => {
    if (hasTemp || lat == null || lng == null) return
    map.flyTo([lat, lng], 13, { duration: 0.4 })
  }, [lat, lng, hasTemp, map])
  return null
}

/**
 * "Drop pin manually on map" button + modal. Shared by every address
 * form (client + pool) so the pin-drop experience is identical app-wide.
 *
 * Props:
 *   address — current address string (used to seed the search + decide
 *             whether to reverse-geocode an empty address on confirm)
 *   lat, lng — current pinned coordinates (or null)
 *   onPick({ lat, lng, address? }) — called on confirm. address is only
 *             included when we derived one (reverse geocode of an empty
 *             address), so a typed address is never clobbered.
 */
export default function ManualPinPicker({ address, lat, lng, onPick }) {
  const { business } = useBusiness()
  const [open, setOpen] = useState(false)
  const [tempLat, setTempLat] = useState(lat)
  const [tempLng, setTempLng] = useState(lng)
  const [searching, setSearching] = useState(false)

  // Cascading default for the map when the form has no coords yet:
  //   1. browser geolocation — best "near me" answer
  //   2. the business's most recently pinned pool — proxy for "where
  //      this business operates"
  //   3. Sanur, Bali — hardcoded ultimate fallback
  const [defaultCenter, setDefaultCenter] = useState(SANUR)

  useEffect(() => {
    let cancelled = false

    async function tryBusinessFallback() {
      if (cancelled || !business?.id) return
      const { data } = await supabase
        .from('pools')
        .select('latitude, longitude')
        .eq('business_id', business.id)
        .not('latitude', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      if (data?.latitude != null && data?.longitude != null) {
        setDefaultCenter({ lat: Number(data.latitude), lng: Number(data.longitude) })
      }
      // else: stays at the SANUR initial state
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return
          setDefaultCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        () => { tryBusinessFallback() },
        { timeout: 5000, enableHighAccuracy: false, maximumAge: 60_000 },
      )
    } else {
      tryBusinessFallback()
    }

    return () => { cancelled = true }
  }, [business?.id])

  // Use the resolved default when the form has no pin yet.
  const initialLat = lat ?? defaultCenter.lat
  const initialLng = lng ?? defaultCenter.lng

  function handleOpen() {
    setTempLat(lat)
    setTempLng(lng)
    setOpen(true)
  }

  function handleConfirm() {
    if (tempLat != null && tempLng != null) {
      // If the address is still empty, seed it with a coords string so
      // required-address Save buttons enable immediately, then upgrade to
      // a real street address from reverse geocode when it lands. If the
      // operator already typed an address, leave it alone.
      if (!address?.trim()) {
        const coordsStr = `${tempLat.toFixed(5)}, ${tempLng.toFixed(5)}`
        onPick({ lat: tempLat, lng: tempLng, address: coordsStr })
        reverseGeocode(tempLat, tempLng).then((addr) => {
          if (addr) onPick({ lat: tempLat, lng: tempLng, address: addr })
        })
      } else {
        onPick({ lat: tempLat, lng: tempLng })
      }
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
            ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-300 hover:bg-green-100'
            : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tap anywhere on the map to drop a pin at the location. Useful when the address can't be found.
          </p>
          {address && (
            <button
              type="button"
              onClick={handleSearchAddress}
              disabled={searching}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-pool-50 dark:bg-pool-950/40 border border-pool-200 dark:border-pool-800/40 text-pool-700 dark:text-pool-300 text-xs font-medium hover:bg-pool-100 disabled:opacity-50"
            >
              {searching ? 'Searching…' : `Try to find "${address.slice(0, 30)}${address.length > 30 ? '...' : ''}" on map`}
            </button>
          )}
          <div className="h-72 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
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
              <FlyToDefault
                lat={defaultCenter.lat}
                lng={defaultCenter.lng}
                hasTemp={tempLat != null && tempLng != null}
              />
            </MapContainer>
          </div>
          {tempLat != null && tempLng != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
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
