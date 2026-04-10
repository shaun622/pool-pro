// Mapping utilities
//   - Mapbox: map tiles ONLY (basemap for Leaflet)
//   - Nominatim: background geocoding (free, no key)
//   - OSRM: road routing (free public demo server, no key)
//   - Google Places: address autocomplete (see AddressAutocomplete component)

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export const MAPBOX_AVAILABLE = Boolean(MAPBOX_TOKEN)

/**
 * Forward geocode an address to { lat, lng } using Nominatim (OpenStreetMap).
 * Free, no API key required. Australian results only.
 */
export async function geocodeAddress(address) {
  if (!address) return null
  try {
    const encoded = encodeURIComponent(address)
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=au`
    const res = await fetch(url, {
      headers: {
        // Nominatim requires a user agent
        'Accept-Language': 'en',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    const first = data[0]
    return {
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
      place_name: first.display_name,
    }
  } catch (err) {
    console.error('Geocode (Nominatim) error:', err)
    return null
  }
}

/**
 * Get a driving route between multiple waypoints using OSRM public demo server.
 * Free, no key required.
 * waypoints: array of { lat, lng }
 * Returns: { coordinates: [[lng,lat],...], distance_km, duration_min }
 */
export async function getRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) return null
  try {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';')
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.routes?.length) return null
    const route = data.routes[0]
    return {
      coordinates: route.geometry.coordinates, // [[lng, lat], ...]
      distance_km: route.distance / 1000,
      duration_min: route.duration / 60,
    }
  } catch (err) {
    console.error('Route (OSRM) error:', err)
    return null
  }
}

/**
 * Haversine straight-line distance fallback (km)
 */
export function haversineKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Mapbox Static tile URL template for Leaflet (streets-v12 style).
 * ONLY used for the basemap visuals.
 */
export const MAPBOX_TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
  : null

export const MAPBOX_ATTRIBUTION =
  '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/about/">OpenStreetMap</a>'
