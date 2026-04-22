import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '../../lib/utils'
import { geocodeAddress } from '../../lib/mapbox'

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY

/**
 * Address input with Google Places (New) autocomplete.
 * Falls back to Nominatim if Google fails.
 *
 * Props:
 *   label       — optional label above input
 *   value       — current address string
 *   onChange    — (address) => void  (called on every keystroke)
 *   onSelect    — ({ address, lat, lng }) => void  (called when user picks a suggestion)
 *   placeholder
 *   required
 *   className
 */
export default function AddressAutocomplete({
  label,
  value,
  onChange,
  onSelect,
  placeholder = 'Start typing an address...',
  required,
  className,
  ...rest
}) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionToken, setSessionToken] = useState(() => cryptoRandom())
  const debounceRef = useRef(null)
  const containerRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const fetchSuggestions = useCallback(async (query) => {
    if (!query || query.length < 3) {
      setSuggestions([])
      return
    }
    setLoading(true)
    try {
      if (GOOGLE_KEY) {
        // Google Places (New) Autocomplete API
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_KEY,
          },
          body: JSON.stringify({
            input: query,
            sessionToken,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const items = (data.suggestions || [])
            .map(s => s.placePrediction)
            .filter(Boolean)
            .map(p => ({
              placeId: p.placeId,
              mainText: p.structuredFormat?.mainText?.text || p.text?.text || '',
              secondaryText: p.structuredFormat?.secondaryText?.text || '',
              fullText: p.text?.text || '',
            }))
          setSuggestions(items)
          setOpen(items.length > 0)
          setLoading(false)
          return
        }
      }
      // Fallback: Nominatim
      const encoded = encodeURIComponent(query)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&addressdetails=1`
      )
      if (res.ok) {
        const data = await res.json()
        const items = data.map(d => ({
          placeId: null,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          mainText: d.display_name.split(',')[0],
          secondaryText: d.display_name.split(',').slice(1, 4).join(',').trim(),
          fullText: d.display_name,
        }))
        setSuggestions(items)
        setOpen(items.length > 0)
      }
    } catch (err) {
      console.error('Autocomplete error:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  function handleInput(e) {
    const v = e.target.value
    onChange?.(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 250)
  }

  async function pickSuggestion(item) {
    setOpen(false)
    setSuggestions([])

    let lat = item.lat
    let lng = item.lng
    let fullAddress = item.fullText || [item.mainText, item.secondaryText].filter(Boolean).join(', ')

    // If we got a Google placeId, fetch details to get coordinates
    if (item.placeId && GOOGLE_KEY) {
      try {
        const res = await fetch(
          `https://places.googleapis.com/v1/places/${item.placeId}?fields=location,formattedAddress&key=${GOOGLE_KEY}`
        )
        if (res.ok) {
          const data = await res.json()
          lat = data.location?.latitude
          lng = data.location?.longitude
          fullAddress = data.formattedAddress || fullAddress
        }
      } catch (err) {
        console.error('Place details error:', err)
      }
    }

    // Last resort: Nominatim geocode
    if ((lat == null || lng == null) && fullAddress) {
      const geo = await geocodeAddress(fullAddress)
      if (geo) {
        lat = geo.lat
        lng = geo.lng
      }
    }

    onChange?.(fullAddress)
    onSelect?.({ address: fullAddress, lat, lng })
    // Reset session token for next search
    setSessionToken(cryptoRandom())
  }

  return (
    <div ref={containerRef} className="space-y-1.5 relative">
      {label && <label className="block text-sm font-medium text-gray-600">{label}</label>}
      <input
        className={cn('input', className)}
        type="text"
        value={value || ''}
        onChange={handleInput}
        onFocus={() => suggestions.length && setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        {...rest}
      />

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-elevated border border-gray-100 overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="w-full text-left px-4 py-3 hover:bg-pool-50 transition-colors border-b border-gray-50 last:border-0 flex items-start gap-2.5"
            >
              <svg className="w-4 h-4 text-pool-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{s.mainText}</p>
                {s.secondaryText && <p className="text-xs text-gray-500 truncate">{s.secondaryText}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-xs text-gray-400">Searching…</p>
      )}
    </div>
  )
}

function cryptoRandom() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
