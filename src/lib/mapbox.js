// Mapbox utilities: geocoding + directions
// All calls go directly to the Mapbox API from the browser.

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export const MAPBOX_AVAILABLE = Boolean(MAPBOX_TOKEN)

/**
 * Forward geocode an address to [lng, lat].
 * Returns null if no results or on error.
 */
export async function geocodeAddress(address) {
  if (!MAPBOX_TOKEN || !address) return null
  try {
    const encoded = encodeURIComponent(address)
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=au&limit=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null
    const [lng, lat] = data.features[0].center
    return { lat, lng, place_name: data.features[0].place_name }
  } catch (err) {
    console.error('Geocode error:', err)
    return null
  }
}

/**
 * Get a driving route between multiple waypoints using Mapbox Directions API.
 * waypoints: array of { lat, lng }
 * Returns: { coordinates: [[lng,lat],...], distance_km, duration_min }
 * Returns null on error.
 */
export async function getRoute(waypoints) {
  if (!MAPBOX_TOKEN || !waypoints || waypoints.length < 2) return null
  try {
    const coords = waypoints
      .map(w => `${w.lng},${w.lat}`)
      .join(';')
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
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
    console.error('Directions error:', err)
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
 * Returns a Mapbox Static tile URL template for Leaflet.
 * Uses the streets-v12 style.
 */
export const MAPBOX_TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
  : null

export const MAPBOX_ATTRIBUTION =
  '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/about/">OpenStreetMap</a>'
