// Country list for the Settings "home country" selector + the per-field
// address-search override. ISO 3166-1 alpha-2 codes; display names come
// from Intl.DisplayNames so we don't hand-maintain labels.
//
// A generous list covering realistic markets. The address override also
// offers "Any country", so an obscure code not listed here is still
// reachable via the manual map pin.
const CODES = [
  'AU', 'NZ', 'US', 'CA', 'GB', 'IE', 'ZA',
  'SG', 'MY', 'ID', 'TH', 'PH', 'VN', 'IN', 'HK', 'JP', 'KR', 'CN', 'TW',
  'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'TR',
  'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK',
  'FI', 'PL', 'CZ', 'GR', 'HU', 'RO', 'IS',
  'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY',
  'FJ', 'PG', 'NC', 'PF',
]

function regionName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

export const COUNTRIES = CODES
  .map(code => ({ code, name: regionName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Human-readable name for a code, even if it's outside the curated list.
export function countryName(code) {
  if (!code) return ''
  return regionName(code.toUpperCase())
}

// Best-guess home country from the device locale (e.g. "en-AU" → "AU").
// Used to seed the Settings field before the operator sets one, and as
// the fallback when a business has no country saved. Falls back to AU.
export function getDefaultCountryCode() {
  try {
    const loc = (typeof navigator !== 'undefined' && navigator.language) || 'en-AU'
    const region = new Intl.Locale(loc).maximize().region
    return region || 'AU'
  } catch {
    return 'AU'
  }
}
