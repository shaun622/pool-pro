import AddressAutocomplete from './AddressAutocomplete'
import ManualPinPicker from './ManualPinPicker'

/**
 * The one address+location control used everywhere a client or pool
 * address is entered — autocomplete, an inline map preview, and a
 * manual "drop pin" picker, all wired to a single { address, lat, lng }
 * value. Built to kill the old discrepancy where pools had a map + pin
 * and clients didn't.
 *
 * Props:
 *   label, placeholder
 *   address, lat, lng — the current value (parent-owned)
 *   onChange({ address, lat, lng }) — called with the full new value on
 *     every change (typing clears the pin; picking a suggestion or
 *     dropping a pin sets it).
 *   required
 */
export default function LocationField({
  label = 'Address',
  placeholder = 'Start typing an address...',
  address = '',
  lat = null,
  lng = null,
  onChange,
  required,
}) {
  return (
    <div className="space-y-2">
      <AddressAutocomplete
        label={label}
        value={address}
        // Free typing clears the pin so a stale location isn't shown.
        onChange={(v) => onChange?.({ address: v, lat: null, lng: null })}
        onSelect={({ address: a, lat: la, lng: ln }) => onChange?.({ address: a, lat: la, lng: ln })}
        placeholder={placeholder}
        required={required}
        mapPreview
        lat={lat}
        lng={lng}
      />
      <ManualPinPicker
        address={address}
        lat={lat}
        lng={lng}
        // Pin-picker may upgrade an empty address via reverse geocode;
        // when it doesn't pass one, keep the current address.
        onPick={({ lat: la, lng: ln, address: a }) =>
          onChange?.({ address: a != null ? a : address, lat: la, lng: ln })
        }
      />
    </div>
  )
}
