import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Image as ImageIcon, Trash2 } from 'lucide-react'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

const AUSTRALIAN_TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
]

export default function BusinessDetails() {
  const { business, loading: bizLoading, updateBusiness } = useBusiness()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: '', abn: '', phone: '', email: '', logo_url: '', brand_colour: '#0891b2', timezone: 'Australia/Sydney',
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
        brand_colour: business.brand_colour || '#0891b2',
        timezone: business.timezone || 'Australia/Sydney',
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
      await updateBusiness(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Error updating business:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { alert('Please select an image file'); return }
    if (file.size > 2 * 1024 * 1024) { alert('Logo must be under 2MB'); return }
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
      alert('Failed to upload logo: ' + (err.message || 'Unknown error'))
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
      <>
        <Header title="Business Details" backTo="/settings" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Header title="Business Details" backTo="/settings" />
      <PageWrapper>
        <Card className="space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400 flex items-center justify-center">
              <Building2 className="w-5 h-5" strokeWidth={2} />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Business Profile</h3>
          </div>

          <Input label="Business Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} />
          <Input label="ABN" value={form.abn} onChange={(e) => updateField('abn', e.target.value)} placeholder="XX XXX XXX XXX" />
          <Input label="Phone" type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
          <Select label="Timezone" value={form.timezone} onChange={(e) => updateField('timezone', e.target.value)} options={AUSTRALIAN_TIMEZONES} />

          {/* Logo upload */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">Company Logo</label>
            {form.logo_url ? (
              <div className="flex items-center gap-4">
                <div className="w-24 h-16 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden p-2">
                  <img src={form.logo_url} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-pool-600 dark:text-pool-400 font-semibold hover:text-pool-700 text-left">Change logo</button>
                  <button type="button" onClick={handleRemoveLogo} className="text-xs text-red-500 dark:text-red-400 font-semibold hover:text-red-600 text-left flex items-center gap-1">
                    <Trash2 className="w-3 h-3" strokeWidth={2.5} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl hover:border-pool-400 hover:bg-pool-50/30 dark:hover:bg-pool-950/20 transition-all cursor-pointer"
              >
                {uploading ? (
                  <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-gray-400 dark:text-gray-500" strokeWidth={2} />
                    </div>
                    <span className="text-sm text-gray-400 dark:text-gray-500">Tap to upload logo</span>
                    <span className="text-[11px] text-gray-300 dark:text-gray-600">Max 400x200px, under 2MB</span>
                  </>
                )}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">Brand Colour</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.brand_colour}
                onChange={(e) => updateField('brand_colour', e.target.value)}
                className="w-11 h-11 rounded-xl border-2 border-gray-200 dark:border-gray-700 cursor-pointer p-0.5 shadow-inner-soft"
              />
              <span className="text-sm text-gray-400 dark:text-gray-500 font-mono">{form.brand_colour}</span>
            </div>
          </div>

          <Button onClick={handleSave} loading={saving} className={cn('w-full', saved && '!bg-gradient-success')}>
            {saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </Card>
      </PageWrapper>
    </>
  )
}
