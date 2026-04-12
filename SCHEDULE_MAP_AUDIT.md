# Schedule / Route / Map — Full Technical Audit

This document explains **exactly** how the Schedule page, route planning, and map rendering work in TreePro. You can share this with another Claude chat and they'll be able to rebuild the entire feature in a different project.

---

## 0. Architecture Overview (30-second version)

```
┌─────────────────────────────────────────────────────────────────┐
│                       Schedule.jsx                              │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐    │
│  │ Day picker    │  │ View toggle   │  │ Travel summary   │    │
│  │ (prev/today/  │  │ List|Upcoming │  │ (km + min)       │    │
│  │  next)        │  │ |Map          │  │                  │    │
│  └───────────────┘  └───────────────┘  └──────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  List View  → draggable job cards, drop to reorder       │   │
│  │  Upcoming   → grouped by date, next 50 jobs              │   │
│  │  Map View   → ScheduleMap with numbered pins + polyline  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Click any job → opens <Modal> with <JobDetailView>            │
│                  (does NOT navigate away)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         │ uses
         ▼
┌─────────────────────┐    ┌──────────────────────┐    ┌──────────────┐
│  src/lib/geocode.js │    │ ScheduleMap.jsx      │    │ JobDetailView│
│  - geocodeAddress   │    │ (react-leaflet +     │    │ (shared UI,  │
│  - searchAddresses  │    │  Mapbox tiles)       │    │  used in     │
│  - placeDetails     │    │                      │    │  modal + page│
│  - distanceKm       │    │                      │    │ )            │
│  - totalRouteKm     │    └──────────────────────┘    └──────────────┘
│  - estimateTravelMin│
│  - getRoadRoute ←── OSRM public routing server (no key)
└─────────────────────┘
```

**Key insight:** the page never calls the map code directly. It just builds an array of `{ id, lat, lng, label, subtitle, time }` and passes it to `<ScheduleMap points={...} />`. The map is a pure presentational component.

---

## 1. Dependencies

```json
{
  "leaflet": "^1.9.4",
  "react-leaflet": "^4.2.1"
}
```

> ⚠️ `react-leaflet@4.x` requires React 18. If you're on React 17, use `react-leaflet@3.x`. If you're on React 19, you may need `react-leaflet@5.x` (API identical).

**Global CSS import** (once in your app entry, e.g. `src/main.jsx`):

```js
import 'leaflet/dist/leaflet.css'
```

Without that import, tiles render but the map container has no sizing and markers look broken.

---

## 2. Environment Variables

Put these in `.env` at project root. Vite requires the `VITE_` prefix.

```bash
# Mapbox public token (free tier: 50k tile loads/month) — https://account.mapbox.com
VITE_MAPBOX_TOKEN=pk.eyJ1...your_token...

# Google Places API (New) key — optional, improves address search quality
VITE_GOOGLE_PLACES_KEY=AIza...your_key...
```

Both are **optional** with graceful fallbacks:

- No Mapbox token → falls back to OpenStreetMap raster tiles (uglier but works).
- No Google key → falls back to Nominatim (free, slower, sometimes imprecise).

**IMPORTANT:** restart the Vite dev server after editing `.env`, it only reads env vars at startup.

---

## 3. Database Schema (Supabase / Postgres)

Only three tables are touched by the schedule feature:

### `jobs`
```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  client_id uuid references clients(id),
  job_site_id uuid references job_sites(id),
  job_type text,
  status text check (status in ('scheduled','in_progress','on_hold','completed')) default 'scheduled',
  scheduled_date date,           -- YYYY-MM-DD (legacy, still populated)
  scheduled_start timestamptz,   -- precise start time, used for ordering
  scheduled_end timestamptz,     -- precise end time
  duration_minutes int default 60,
  staff_id uuid,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);
```

The dual `scheduled_date` + `scheduled_start` design is intentional: `scheduled_date` lets you cheaply query "all jobs for day X" without timezone math, while `scheduled_start` gives you precise time-of-day ordering and drag-reorder support.

### `job_sites`
```sql
create table job_sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  address text,
  notes text,
  lat double precision,   -- ← auto-geocoded on first display
  lng double precision,
  created_at timestamptz default now()
);
```

### `clients`
```sql
create table clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id),
  name text,
  phone text,
  email text,
  address text,
  lat double precision,
  lng double precision
);
```

---

## 4. The Geocoding Layer — `src/lib/geocode.js`

This single file handles **four separate concerns**:

1. **Address → coordinates** (geocoding) via Nominatim
2. **Autocomplete dropdown** via Google Places (New) with Nominatim fallback
3. **Straight-line distance math** (Haversine)
4. **Road routing** via OSRM public demo server

### 4.1 In-memory cache + throttling

```js
const cache = new Map()
let lastRequest = 0

async function throttle() {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequest))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequest = Date.now()
}
```

Nominatim's usage policy caps you at **1 req/sec**. We enforce 1.1s to be safe. This prevents getting banned. Results are cached in-memory per-session.

### 4.2 Simple geocode (single address → coords)

```js
export async function geocodeAddress(address) {
  if (!address) return null
  if (cache.has(address)) return cache.get(address)
  await throttle()
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(address)}`
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
    const data = await res.json()
    if (data?.[0]) {
      const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      cache.set(address, coords)
      return coords
    }
  } catch (e) {
    console.warn('Geocode failed:', address, e)
  }
  cache.set(address, null)
  return null
}
```

**This is the function the Schedule page calls in a background loop** to lazily populate `lat`/`lng` on `job_sites` rows that are missing them. See section 5.3.

`countrycodes=au` biases results to Australia so `"24 Cliff St"` resolves to Sydney's Watsons Bay, not Cliff Street in Berlin. Change to your country code.

### 4.3 Google Places autocomplete (v1 REST)

```js
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY

async function googleAutocomplete(query, country = 'AU') {
  if (!GOOGLE_KEY) return null
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: [country.toLowerCase()],
      languageCode: 'en',
    }),
  })
  const data = await res.json()
  return (data.suggestions || [])
    .filter(s => s.placePrediction)
    .map(s => ({
      placeId: s.placePrediction.placeId,
      label: s.placePrediction.text?.text || '',
      lat: null,  // ← coords resolved on selection
      lng: null,
    }))
}
```

Google's new Places API returns **predictions without coordinates** — you have to resolve the `placeId` to coords on user selection:

```js
export async function placeDetails(placeId) {
  if (!GOOGLE_KEY || !placeId) return null
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'id,formattedAddress,location,displayName',
    },
  })
  const data = await res.json()
  return {
    label: data.formattedAddress || data.displayName?.text || '',
    lat: data.location?.latitude ?? null,
    lng: data.location?.longitude ?? null,
  }
}
```

> 🔑 The `X-Goog-FieldMask` header is **mandatory** for Places API (New) — without it you'll get a 400 error. Only request the fields you need; billing is per-field.

### 4.4 Unified search (used by `<AddressAutocomplete />`)

```js
export async function searchAddresses(query, { limit = 6, country = 'au' } = {}) {
  if (!query || query.trim().length < 3) return []

  // Google first
  const google = await googleAutocomplete(query, country.toUpperCase())
  if (google && google.length > 0) return google.slice(0, limit)

  // Nominatim fallback
  await throttle()
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${limit}&countrycodes=${country}&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  const data = await res.json()
  return (data || []).map(r => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    address: r.address || {},
  }))
}
```

Callers should check `result.placeId` — if present, they must call `placeDetails(placeId)` on select to get coords; otherwise lat/lng are already populated.

### 4.5 Haversine distance

```js
export function distanceKm(a, b) {
  if (!a || !b) return 0
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(x))
}

export function totalRouteKm(coords) {
  if (coords.length < 2) return 0
  let total = 0
  for (let i = 0; i < coords.length - 1; i++) total += distanceKm(coords[i], coords[i + 1])
  return total
}

export function estimateTravelMinutes(coords) {
  // assumes ~40km/h average urban speed
  return Math.round((totalRouteKm(coords) / 40) * 60)
}
```

These are the **fallback** numbers shown before the road routing API returns. They're roughly 30-40% shorter than actual driving distance because they're straight lines.

### 4.6 Road routing via OSRM (the cool bit)

```js
const routeCache = new Map()

export async function getRoadRoute(points) {
  if (!points || points.length < 2) return null
  const key = points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  if (routeCache.has(key)) return routeCache.get(key)

  try {
    // OSRM expects lng,lat (yes, reversed from lat,lng)
    const coordsStr = points.map(p => `${p.lng},${p.lat}`).join(';')
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`
    const res = await fetch(url)
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No route')
    const route = data.routes[0]
    // GeoJSON is [lng, lat], Leaflet wants [lat, lng]
    const geometry = route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    const result = {
      geometry,
      distanceKm: route.distance / 1000,
      durationMin: Math.round(route.duration / 60),
    }
    routeCache.set(key, result)
    return result
  } catch (e) {
    console.warn('Road routing failed:', e)
    return null
  }
}
```

**What this does:**
- Sends ordered waypoints to OSRM's free public demo server
- Receives a full polyline geometry following roads
- Returns `{ geometry, distanceKm, durationMin }`

**OSRM gotchas:**
- It's a public demo (`router.project-osrm.org`) — **do not rely on it for production at scale**. For prod, either self-host OSRM in a docker container or pay for Mapbox Directions API ($0.50 per 1k requests).
- Rate limit is unspecified but moderate. The per-route cache prevents hammering it.
- Coordinate order is `lng,lat` (the GeoJSON convention), not `lat,lng`. Easy to mess up.
- If it returns `code !== 'Ok'` the function returns `null` and the UI falls back to the straight-line display.

---

## 5. Schedule Page — `src/pages/Schedule.jsx`

### 5.1 State layout

```js
const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
const [view, setView] = useState('list')    // 'list' | 'upcoming' | 'map'
const [jobs, setJobs] = useState([])          // jobs for selectedDate
const [sites, setSites] = useState({})        // {job_site_id: site}
const [clients, setClients] = useState({})    // {client_id: client}
const [upcomingJobs, setUpcomingJobs] = useState([])  // next 50 non-completed
const [upcomingSites, setUpcomingSites] = useState({})
const [upcomingClients, setUpcomingClients] = useState({})
const [roadRoute, setRoadRoute] = useState(null)  // OSRM result
const [draggingId, setDraggingId] = useState(null)
const [dragOverId, setDragOverId] = useState(null)
const [openJobId, setOpenJobId] = useState(null)  // drives the modal
const modalJob = useJobDetail(openJobId)           // fetches detail lazily
```

### 5.2 Day helpers

```js
function ymd(d) { return d.toISOString().split('T')[0] }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

const goToDay = (offset) => {
  const next = new Date(selectedDate)
  next.setDate(next.getDate() + offset)
  setSelectedDate(startOfDay(next))
}
```

### 5.3 Loading jobs for the selected day

This is the tricky Supabase query that handles the dual `scheduled_start` / `scheduled_date` schema:

```js
useEffect(() => {
  if (!business?.id) return
  const fetchData = async () => {
    setLoading(true)
    const dayStr = ymd(selectedDate)
    const startISO = startOfDay(selectedDate).toISOString()
    const endISO = endOfDay(selectedDate).toISOString()

    const { data: jobsData } = await supabase
      .from('jobs')
      .select('*')
      .eq('business_id', business.id)
      .or(`and(scheduled_start.gte.${startISO},scheduled_start.lte.${endISO}),scheduled_date.eq.${dayStr}`)
      .order('scheduled_start', { ascending: true, nullsFirst: false })

    const jobList = jobsData || []
    setJobs(jobList)

    // Batch-fetch sites and clients referenced by these jobs
    const siteIds = [...new Set(jobList.filter(j => j.job_site_id).map(j => j.job_site_id))]
    const clientIds = [...new Set(jobList.filter(j => j.client_id).map(j => j.client_id))]
    const [sitesRes, clientsRes] = await Promise.all([
      siteIds.length ? supabase.from('job_sites').select('*').in('id', siteIds) : Promise.resolve({ data: [] }),
      clientIds.length ? supabase.from('clients').select('*').in('id', clientIds) : Promise.resolve({ data: [] }),
    ])
    setSites(Object.fromEntries((sitesRes.data || []).map(s => [s.id, s])))
    setClients(Object.fromEntries((clientsRes.data || []).map(c => [c.id, c])))
    setLoading(false)

    // ★ Lazy geocode loop: sites without coords get filled in background
    for (const site of (sitesRes.data || [])) {
      if (!site.lat && site.address) {
        const coords = await geocodeAddress(site.address)
        if (coords) {
          await supabase.from('job_sites').update({ lat: coords.lat, lng: coords.lng }).eq('id', site.id)
          setSites(prev => ({ ...prev, [site.id]: { ...prev[site.id], lat: coords.lat, lng: coords.lng } }))
        }
      }
    }
  }
  fetchData()
}, [business?.id, selectedDate])
```

The `.or(...)` clause reads as: "rows where `scheduled_start` falls in today's UTC range, **OR** rows where `scheduled_date` equals today's YYYY-MM-DD". The `and(...)` wrapper is Supabase's way of grouping the two `.gte`/`.lte` conditions inside the outer `.or`.

The **lazy geocode loop** at the bottom is the magic that makes the map "just work" without blocking the UI. Pages load instantly with text info, then pins appear one-by-one as Nominatim responds.

### 5.4 Building map points from jobs

```js
const mapPoints = jobs
  .map((job, idx) => {
    const site = sites[job.job_site_id]
    if (!site?.lat || !site?.lng) return null
    const client = clients[job.client_id]
    return {
      id: job.id,
      lat: site.lat,
      lng: site.lng,
      label: job.job_type || 'Job',
      subtitle: `${client?.name || ''} · ${site.address || ''}`.trim(),
      time: job.scheduled_start ? formatTime(job.scheduled_start) : null,
    }
  })
  .filter(Boolean)
```

This is **the shape that `<ScheduleMap />` expects**. Every point has `id`, `lat`, `lng`, plus cosmetic `label`/`subtitle`/`time`. Jobs without geocoded sites are filtered out and a footer shows "N job(s) without a mapped address".

### 5.5 Computing travel stats + road route

```js
const totalKm = totalRouteKm(mapPoints)
const travelMin = estimateTravelMinutes(mapPoints)
const displayKm = roadRoute?.distanceKm ?? totalKm
const displayMin = roadRoute?.durationMin ?? travelMin

// Only re-fetch route when the ordered point list actually changes
const routeKey = mapPoints.map(p => `${p.id}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
useEffect(() => {
  let cancelled = false
  if (mapPoints.length < 2) { setRoadRoute(null); return }
  getRoadRoute(mapPoints).then(r => { if (!cancelled) setRoadRoute(r) })
  return () => { cancelled = true }
}, [routeKey])
```

**The `routeKey` pattern is important.** Without it, every render triggers a new OSRM request because `mapPoints` is a new array each time. By serializing into a string key and depending on the string, we only refetch when the actual coordinates or order change.

The `cancelled` flag prevents a stale late-arriving response from overwriting a newer one (race condition guard).

The UI shows `displayKm`/`displayMin` which prefers the road-route numbers if available, else falls back to the Haversine estimate.

### 5.6 Drag-and-drop reordering

```js
const handleDragStart = (id) => setDraggingId(id)
const handleDragOver = (e, id) => { e.preventDefault(); setDragOverId(id) }
const handleDragEnd = () => { setDraggingId(null); setDragOverId(null) }

const handleDrop = async (e, targetId) => {
  e.preventDefault()
  if (!draggingId || draggingId === targetId) { handleDragEnd(); return }
  const fromIdx = jobs.findIndex(j => j.id === draggingId)
  const toIdx = jobs.findIndex(j => j.id === targetId)
  const reordered = [...jobs]
  const [moved] = reordered.splice(fromIdx, 1)
  reordered.splice(toIdx, 0, moved)
  setJobs(reordered)
  handleDragEnd()

  // Persist: re-time the whole day starting 8am, stacking by duration
  const baseHour = 8
  for (let i = 0; i < reordered.length; i++) {
    const newStart = new Date(selectedDate)
    newStart.setHours(baseHour + i, 0, 0, 0)
    const dur = reordered[i].duration_minutes || 60
    const newEnd = new Date(newStart.getTime() + dur * 60000)
    await supabase.from('jobs').update({
      scheduled_start: newStart.toISOString(),
      scheduled_end: newEnd.toISOString(),
      scheduled_date: ymd(newStart),
    }).eq('id', reordered[i].id)
  }
}
```

Uses the **native HTML5 drag-and-drop API** (no library). The draggable card has `draggable` attribute + the four `onDragStart/Over/End/Drop` handlers. When dropped, it:
1. Optimistically updates UI
2. Walks the whole day re-writing `scheduled_start` to 8am + i hours (spaced by duration)
3. Also writes `scheduled_date` because the day might have changed

For a simpler version, skip the "re-time the whole day" bit and just persist the new order as an `order_index` integer column.

### 5.7 The modal popup flow (important UX choice)

Instead of `navigate('/jobs/:id')` when a job is clicked (which flicks away to the Jobs tab), we open a `<Modal>` with a shared `<JobDetailView>` inside:

```js
const [openJobId, setOpenJobId] = useState(null)
const modalJob = useJobDetail(openJobId)   // fetches job+client+site+reports
const [modalUpdating, setModalUpdating] = useState(false)

const modalUpdateStatus = async (status) => {
  if (!modalJob.job) return
  setModalUpdating(true)
  const updates = { status }
  if (status === 'completed') updates.completed_at = new Date().toISOString()
  if (status === 'in_progress' && !modalJob.job.started_at) updates.started_at = new Date().toISOString()
  const { data } = await supabase.from('jobs').update(updates).eq('id', modalJob.job.id).select().single()
  if (data) {
    modalJob.setJob(data)                  // update modal view
    setJobs(prev => prev.map(j => j.id === data.id ? data : j))  // sync list below
  }
  setModalUpdating(false)
}

// ...in JSX:
<Modal open={!!openJobId} onClose={() => setOpenJobId(null)} title="Job Details" size="lg">
  {modalJob.loading ? (
    <Spinner />
  ) : (
    <JobDetailView
      job={modalJob.job} client={modalJob.client} site={modalJob.site}
      staff={staff} reports={modalJob.reports}
      updating={modalUpdating}
      onStatusChange={modalUpdateStatus}
      onEdit={() => { setOpenJobId(null); navigate(`/jobs/${modalJob.job.id}`) }}
      onCreateReport={modalJob.site ? () => { setOpenJobId(null); navigate(`/sites/${modalJob.site.id}/report`) } : null}
      onOpenReport={(rid) => { setOpenJobId(null); navigate(`/reports/${rid}`) }}
      compact
    />
  )}
</Modal>
```

Three places trigger the modal:
1. List view card: `onClick={() => setOpenJobId(job.id)}`
2. Upcoming view card: `onClick={() => setOpenJobId(job.id)}`
3. Map marker "View job" button: `onMarkerClick={(p) => setOpenJobId(p.id)}`

All state syncs cleanly: status changes in the modal propagate back to the underlying list via `setJobs(prev => prev.map(...))`.

---

## 6. The Map Component — `src/components/schedule/ScheduleMap.jsx`

This is a **pure presentational component**. Give it points and route geometry, it renders the map. It does not fetch anything.

### 6.1 Tile layer (Mapbox streets-v12)

```js
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE = 'mapbox/streets-v12'
const TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = MAPBOX_TOKEN
  ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  : '&copy; OpenStreetMap'
```

The `@2x` in the URL requests **retina tiles** (512×512 instead of 256×256) for crisp rendering on HiDPI screens. When using retina tiles with Leaflet you **must** set `tileSize={512}` and `zoomOffset={-1}` on the `TileLayer` component, otherwise the zoom levels will be wrong:

```jsx
<TileLayer
  attribution={TILE_ATTRIBUTION}
  url={TILE_URL}
  {...(MAPBOX_TOKEN ? { tileSize: 512, zoomOffset: -1 } : {})}
/>
```

Other Mapbox styles you can swap in:
- `mapbox/streets-v12` ← default, Google-Maps-ish
- `mapbox/outdoors-v12` (topographic)
- `mapbox/light-v11` / `mapbox/dark-v11`
- `mapbox/satellite-streets-v12`

### 6.2 Numbered pin icon (SVG via divIcon)

```js
function makeNumberIcon(num, color = '#22c55e') {
  return L.divIcon({
    className: 'schedule-marker',
    html: `<div style="position:relative;width:32px;height:42px;">
      <svg viewBox="0 0 32 42" width="32" height="42" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <path d="M16 0C7.2 0 0 7.2 0 16c0 12 16 26 16 26s16-14 16-26C32 7.2 24.8 0 16 0z" fill="${color}"/>
        <circle cx="16" cy="16" r="10" fill="white"/>
        <text x="16" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${color}">${num}</text>
      </svg>
    </div>`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],    // ← bottom-center of the pin touches the coordinate
    popupAnchor: [0, -42],   // ← popup opens from the top of the pin
  })
}
```

`L.divIcon` lets you define a marker as arbitrary HTML/SVG instead of a PNG, so you get numbered, colored, easily-restyled pins for free. The drop-shadow is baked in via SVG filter.

### 6.3 Auto-fit bounds helper

```js
function FitBounds({ points, routeGeometry }) {
  const map = useMap()
  useEffect(() => {
    const all = routeGeometry?.length ? routeGeometry : points.map(p => [p.lat, p.lng])
    if (all.length === 0) return
    if (all.length === 1) {
      map.setView(all[0], 13)
      return
    }
    const bounds = L.latLngBounds(all)
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [points, routeGeometry, map])
  return null
}
```

This is a React-Leaflet pattern: a child component that uses `useMap()` to access the Leaflet map instance and imperatively calls `fitBounds()` whenever the inputs change. It renders nothing. Without this, the map would stay stuck on the initial center and you'd have to pan/zoom manually.

When road route geometry is available, we fit bounds to the whole polyline (better framing). Otherwise we fit to just the pin coordinates. Single point → zoom in to level 13.

### 6.4 The full component

```jsx
export default function ScheduleMap({ points = [], routeGeometry = null, onMarkerClick, height = 320 }) {
  const center = points[0] ? [points[0].lat, points[0].lng] : [-33.8688, 151.2093] // Sydney default
  const straightLine = points.map(p => [p.lat, p.lng])

  return (
    <div style={{ height, width: '100%' }} className="rounded-2xl overflow-hidden border border-gray-200">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          {...(MAPBOX_TOKEN ? { tileSize: 512, zoomOffset: -1 } : {})}
        />

        {/* Route polyline: solid green for road route, dashed for straight-line fallback */}
        {routeGeometry?.length > 1 ? (
          <Polyline positions={routeGeometry} pathOptions={{ color: '#22c55e', weight: 5, opacity: 0.85 }} />
        ) : straightLine.length > 1 ? (
          <Polyline positions={straightLine} pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.5, dashArray: '8, 8' }} />
        ) : null}

        {points.map((p, i) => (
          <Marker key={p.id || i} position={[p.lat, p.lng]} icon={makeNumberIcon(i + 1)}>
            <Popup className="schedule-popup" maxWidth={260} minWidth={220}>
              <div style={{ padding: '4px 2px', fontFamily: 'system-ui, sans-serif' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 12,
                    background: '#22c55e', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>{i + 1}</div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#111827' }}>
                    {p.label || `Stop ${i + 1}`}
                  </p>
                </div>
                {p.subtitle && (
                  <p style={{ margin: '0 0 6px 0', fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
                    {p.subtitle}
                  </p>
                )}
                {p.time && (
                  <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#15803d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                    </svg>
                    {p.time}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onMarkerClick?.(p)}
                  style={{
                    width: '100%', padding: '8px 12px',
                    background: 'linear-gradient(135deg, #22c55e, #15803d)',
                    color: 'white', border: 'none', borderRadius: 10,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(34, 197, 94, 0.3)',
                  }}
                >
                  View job
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBounds points={points} routeGeometry={routeGeometry} />
      </MapContainer>
    </div>
  )
}
```

**Key design choices:**
- `scrollWheelZoom={false}` — prevents accidental zoom when scrolling the page on desktop. Users can still pinch-zoom on mobile or click +/- buttons.
- **Inline styles in the Popup** instead of Tailwind classes — Leaflet renders popups outside the React tree into its own DOM container, so Tailwind classes added later via JSX re-renders sometimes don't get picked up consistently. Inline styles are bulletproof.
- **Solid line vs dashed line** — visually distinguishes "this is the real road route" from "this is just straight lines as a fallback". Users understand the difference immediately.
- The `onMarkerClick` callback is wired to a "View job" button **inside the popup**, not to the marker itself. This is better UX: clicking a marker first opens the popup (showing info), then the user explicitly taps the action button. On mobile especially, tapping a marker that immediately navigates away feels jarring.

---

## 7. Common Gotchas & Fixes

| Issue | Cause | Fix |
|---|---|---|
| Map is blank / grey | Missing `leaflet/dist/leaflet.css` import | Add to `main.jsx` |
| Map has zero height | Parent has no height | `<MapContainer style={{ height: '100%' }}>` inside a div with a fixed height |
| Mapbox tiles look pixelated | Using `@2x` URL without `tileSize: 512` | Add `tileSize={512} zoomOffset={-1}` |
| Pins in wrong place | Passing `[lng, lat]` instead of `[lat, lng]` | Leaflet is `[lat, lng]`. OSRM/GeoJSON is `[lng, lat]`. Convert. |
| OSRM returns `code: 'NoRoute'` | Waypoint is in water/impassable | Filter points or fall back to straight line |
| Jobs don't refresh after drag | Forgot to optimistically update `jobs` state | Call `setJobs(reordered)` **before** the DB writes |
| Infinite route refetch loop | Depending on `mapPoints` array directly | Derive a string `routeKey` and depend on that |
| Nominatim returns foreign results | Missing `countrycodes=` param | Add `countrycodes=au` (or your code) |
| Google Places 400 error | Missing `X-Goog-FieldMask` header | It's mandatory on Places API (New) details calls |
| Modal closes when clicking map | Map popup click bubbles up | `e.stopPropagation()` on button handlers if needed |

---

## 8. File Checklist (what to copy)

If you're porting this to another project, copy:

1. **`src/lib/geocode.js`** — the entire geocoding + routing library (stand-alone, no internal deps except `import.meta.env`)
2. **`src/components/schedule/ScheduleMap.jsx`** — the map component (needs `leaflet` + `react-leaflet` installed)
3. **`src/pages/Schedule.jsx`** — the page itself. Strip out `useBusiness`/`useStaff`/`JobDetailView`/`Modal` and replace with your app's equivalents.
4. **`.env`** — add `VITE_MAPBOX_TOKEN` (and optionally `VITE_GOOGLE_PLACES_KEY`)
5. **`src/main.jsx`** — add `import 'leaflet/dist/leaflet.css'`
6. **`package.json`** — add `leaflet` and `react-leaflet` deps

Install:
```bash
npm install leaflet react-leaflet
```

---

## 9. Possible Upgrades

Things you could add that we haven't:

- **Optimal route ordering** — currently the order is whatever the user set. Add a "Optimize route" button that calls OSRM's `/trip` endpoint (TSP solver).
- **Staff home base** — show the staff member's home as a start/end pin so total km includes commute.
- **Time-of-day aware ETA** — OSRM doesn't do traffic. Swap to Mapbox Directions API for real-time traffic-aware durations.
- **Clustered markers at low zoom** — use `react-leaflet-markercluster` when you have 50+ jobs.
- **Offline tile caching** — serve tiles from IndexedDB via a service worker for PWA offline use.
- **Export to Google Maps app** — long-press a pin → "Open in Google Maps" using `https://www.google.com/maps/dir/?api=1&waypoints=...`.

---

## 10. TL;DR

1. Put `VITE_MAPBOX_TOKEN` in `.env`
2. `npm install leaflet react-leaflet` and import `leaflet/dist/leaflet.css` once
3. Copy `src/lib/geocode.js` wholesale
4. Copy `src/components/schedule/ScheduleMap.jsx` wholesale
5. From your schedule page, fetch jobs + sites, build a `mapPoints` array of `{id, lat, lng, label, subtitle, time}`, call `getRoadRoute(mapPoints)` in a `useEffect` keyed on a serialized coordinate string, and pass the result + points to `<ScheduleMap />`
6. Lazy-geocode any sites missing `lat`/`lng` via `geocodeAddress(address)` in a background loop after the first render
7. Handle marker clicks by opening a modal (don't navigate)

That's it.
