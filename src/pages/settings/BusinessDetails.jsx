import { useState, useEffect, useRef } from 'react'
import { Building2, Check, Image as ImageIcon, Palette, Receipt, Trash2, Upload } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import { COUNTRIES, getDefaultCountryCode } from '../../lib/countries'

const AUSTRALIAN_TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
]

// Preset brand colours — pool-leaning palette + a few neutrals
const PRESET_COLOURS = [
  { hex: '#0EA5E9', label: 'Pool blue' },
  { hex: '#0284C7', label: 'Deep blue' },
  { hex: '#14B8A6', label: 'Teal' },
  { hex: '#10B981', label: 'Emerald' },
  { hex: '#F59E0B', label: 'Amber' },
  { hex: '#EF4444', label: 'Red' },
  { hex: '#0F172A', label: 'Slate' },
]

function normalizeHex(input) {
  // Ensure leading #, uppercase, 6 chars
  let v = (input || '').trim().replace(/^#/, '').toUpperCase()
  v = v.replace(/[^0-9A-F]/g, '')
  return v
}

export default function BusinessDetails() {
  const toast = useToast()
  const { business, loading: bizLoading, updateBusiness } = useBusiness()

  const [form, setForm] = useState({
    name: '', abn: '', phone: '', email: '', logo_url: '', brand_colour: '#0EA5E9', timezone: 'Australia/Sydney',
    // Home country (ISO alpha-2) — drives address autocomplete defaults.
    country_code: 'AU',
    // gst_enabled is the master switch: false means we're not GST-
    // registered, so new docs save with rate=0 and the GST line is
    // hidden in totals / PDFs. Toggling this off keeps the entered
    // rate around so flipping back on is one click.
    gst_enabled: true,
    // GST rate stored as decimal (0.10 = 10%) but edited in the form
    // as a percent so the operator types "10" instead of "0.10". Save
    // converts back to decimal before writing.
    gst_rate_percent: 10,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name || '',
        abn: business.abn || '',
        phone: business.phone || '',
        email: business.email || '',
        logo_url: business.logo_url || '',
        brand_colour: business.brand_colour || '#0EA5E9',
        timezone: business.timezone || 'Australia/Sydney',
        // Seed from the device locale when unset so it's sensible on first visit.
        country_code: business.country_code || getDefaultCountryCode(),
        // Treat absence as "registered" (current behaviour) for legacy
        // rows that predate the gst_enabled column.
        gst_enabled: business.gst_enabled !== false,
        // numeric(5,4) arrives from PostgREST as a string ("0.1000") so coerce.
        gst_rate_percent: business.gst_rate != null ? Number(business.gst_rate) * 100 : 10,
      })
    }
  }, [business])

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    try {
      setSaving(true)
      const { gst_rate_percent, ...rest } = form
      // Use Number.isFinite so an empty field falls back to 10%, but
      // explicit 0 is preserved (the previous `|| 10` snapped any 0
      // back to 10, which was the bug operators hit when trying to
      // disable GST by typing 0).
      const pct = Number(gst_rate_percent)
      const gstRate = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : 0.10
      const payload = {
        ...rest,
        gst_enabled: !!form.gst_enabled,
        gst_rate: gstRate,
      }
      await updateBusiness(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Error updating business:', err)
      toast.error('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return }
    if (file.size > 4 * 1024 * 1024) { toast.error('Logo must be under 4MB'); return }
    setUploading(true)
    try {
      const resized = await resizeImage(file, 400, 200)
      const fileName = `${business.id}-logo-${Date.now()}.png`
      if (form.logo_url) {
        const oldPath = form.logo_url.split('/logos/')[1]
        if (oldPath) await supabase.storage.from('logos').remove([oldPath])
      }
      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, resized, { contentType: 'image/png' })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName)
      const logoUrl = urlData.publicUrl
      await updateBusiness({ logo_url: logoUrl })
      updateField('logo_url', logoUrl)
    } catch (err) {
      console.error('Logo upload error:', err)
      toast.error('Failed to upload logo: ' + (err.message || 'Unknown error'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function resizeImage(file, maxWidth, maxHeight) {
    return new Promise((resolve) => {
      const img = new Image()
      const canvas = document.createElement('canvas')
      const reader = new FileReader()
      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img
          if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth }
          if (height > maxHeight) { width = Math.round((width * maxHeight) / height); height = maxHeight }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob(resolve, 'image/png', 1)
        }
        img.src = e.target.result
      }
      reader.readAsDataURL(file)
    })
  }

  async function handleRemoveLogo() {
    if (!form.logo_url) return
    try {
      const oldPath = form.logo_url.split('/logos/')[1]
      if (oldPath) await supabase.storage.from('logos').remove([oldPath])
      await updateBusiness({ logo_url: null })
      updateField('logo_url', '')
    } catch (err) {
      console.error('Error removing logo:', err)
    }
  }

  if (bizLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hexInput = form.brand_colour.replace(/^#/, '').toUpperCase()

  return (
    <div className="space-y-6">
      {/* ── BRANDING ── */}
      <section>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1.5">
              <Building2 className="w-3.5 h-3.5" strokeWidth={2.5} />
              Branding · what your customers see
            </p>
            <p className="text-[13.5px] text-gray-500 dark:text-gray-400 max-w-prose">
              Trading name, contact details and your brand colours appear on every quote, invoice, and customer-facing page.
            </p>
          </div>
          {saved && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold uppercase tracking-wider shrink-0">
              <Check className="w-3 h-3" strokeWidth={2.5} />
              Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Trading name"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="Crystal Clear Pools"
          />
          <Input
            label="Public email"
            type="email"
            value={form.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="hello@example.com"
          />
          <Input
            label="ABN"
            value={form.abn}
            onChange={(e) => updateField('abn', e.target.value)}
            placeholder="XX XXX XXX XXX"
          />
          <Input
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => updateField('phone', e.target.value)}
            placeholder="0400 000 000"
          />
          <Select
            label="Timezone"
            value={form.timezone}
            onChange={(e) => updateField('timezone', e.target.value)}
            options={AUSTRALIAN_TIMEZONES}
          />
          <Select
            label="Country"
            value={form.country_code}
            onChange={(e) => updateField('country_code', e.target.value)}
            options={COUNTRIES.map(c => ({ value: c.code, label: c.name }))}
          />
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-2">
          Address search defaults to this country. You can switch country on any individual address field.
        </p>
      </section>

      {/* ── TAX & INVOICING ── */}
      <section>
        <p className="eyebrow mb-3">
          <Receipt className="w-3.5 h-3.5" strokeWidth={2.5} />
          Tax & invoicing · GST applied to new quotes and invoices
        </p>

        {/* Master GST toggle. Disabled state greys the rate input but
            keeps the value so flipping back on doesn't lose the rate. */}
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 px-4 py-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Charge GST</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {form.gst_enabled
                ? 'New quotes and invoices include GST at the rate below.'
                : "Off — new quotes and invoices won't include GST. Turn on once you're GST-registered."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.gst_enabled}
            onClick={() => updateField('gst_enabled', !form.gst_enabled)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
              form.gst_enabled ? 'bg-pool-500' : 'bg-gray-300 dark:bg-gray-700',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform translate-y-0.5',
                form.gst_enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>

        <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-4', form.gst_enabled ? '' : 'opacity-50 pointer-events-none')}>
          <Input
            label="GST rate (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={form.gst_rate_percent}
            onChange={(e) => updateField('gst_rate_percent', e.target.value)}
            placeholder="10"
            disabled={!form.gst_enabled}
          />
        </div>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-2">
          Existing quotes and invoices keep the rate they were issued under — this only changes new docs.
        </p>
      </section>

      {/* ── LOGO ── */}
      <section>
        <p className="eyebrow mb-3">
          <ImageIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
          Logo · shown on PDFs, the customer portal, your invoices
        </p>
        <Card className="!p-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden p-1.5 shrink-0">
              {form.logo_url ? (
                <img src={form.logo_url} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <ImageIcon className="w-6 h-6 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {form.logo_url ? 'Logo uploaded' : 'No logo yet'}
              </p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
                Square PNG or SVG works best · max 4 MB
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {form.logo_url && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="inline-flex items-center gap-1 text-xs text-red-500 dark:text-red-400 font-semibold hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2.5} />
                  Remove
                </button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={Upload}
                onClick={() => fileInputRef.current?.click()}
                loading={uploading}
              >
                {form.logo_url ? 'Change logo' : 'Upload logo'}
              </Button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
        </Card>
      </section>

      {/* ── BRAND COLOUR ── */}
      <section>
        <p className="eyebrow mb-3">
          <Palette className="w-3.5 h-3.5" strokeWidth={2.5} />
          Brand colour · used on PDFs, the customer portal, your invoices
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {PRESET_COLOURS.map(c => {
            const active = form.brand_colour.toUpperCase() === c.hex.toUpperCase()
            return (
              <button
                key={c.hex}
                type="button"
                onClick={() => updateField('brand_colour', c.hex)}
                className={cn(
                  'w-10 h-10 rounded-xl shrink-0 transition-all',
                  active
                    ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-gray-100 dark:ring-offset-gray-900 scale-110'
                    : 'ring-1 ring-black/10 hover:scale-105',
                )}
                style={{ backgroundColor: c.hex }}
                aria-label={c.label}
                title={c.label}
              />
            )
          })}
          <span className="h-8 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
          {/* Custom hex */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click() /* visually only — clicking opens picker via input */}
              className="w-10 h-10 rounded-xl shrink-0 ring-1 ring-black/10 relative cursor-pointer overflow-hidden"
              style={{ backgroundColor: form.brand_colour }}
              aria-label="Custom colour"
            >
              <input
                type="color"
                value={form.brand_colour}
                onChange={(e) => updateField('brand_colour', e.target.value.toUpperCase())}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </button>
            <span className="text-sm text-gray-400 dark:text-gray-500">#</span>
            <input
              type="text"
              maxLength={6}
              value={hexInput}
              onChange={(e) => {
                const v = normalizeHex(e.target.value)
                updateField('brand_colour', '#' + v.padEnd(6, '0').slice(0, 6))
              }}
              className="w-20 h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-semibold uppercase tabular-nums tracking-wide text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-pool-500/30"
              placeholder="0EA5E9"
            />
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            Selected · {form.brand_colour.toUpperCase()}
          </span>
        </div>
      </section>

      {/* ── SAVE ── */}
      <div className="pt-2">
        <Button onClick={handleSave} loading={saving} className={cn(saved && '!bg-gradient-success')}>
          {saved ? 'Saved!' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
