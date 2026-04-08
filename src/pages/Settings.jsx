import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

const PLAN_BADGE = {
  trial: 'warning',
  starter: 'primary',
  pro: 'success',
}

export default function Settings() {
  const { business, loading: bizLoading, updateBusiness } = useBusiness()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: '',
    abn: '',
    phone: '',
    email: '',
    logo_url: '',
    brand_colour: '#0891b2',
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
      })
    }
  }, [business])

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
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

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Logo must be under 2MB')
      return
    }

    setUploading(true)
    try {
      // Resize to email-safe dimensions (max 400px wide, PNG)
      const resized = await resizeImage(file, 400, 200)

      const fileExt = 'png'
      const fileName = `${business.id}-logo-${Date.now()}.${fileExt}`

      // Delete old logo if exists
      if (form.logo_url) {
        const oldPath = form.logo_url.split('/logos/')[1]
        if (oldPath) {
          await supabase.storage.from('logos').remove([oldPath])
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, resized, { contentType: 'image/png' })
      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName)
      const logoUrl = urlData.publicUrl

      // Save to business
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

          // Scale down maintaining aspect ratio
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width)
            width = maxWidth
          }
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height)
            height = maxHeight
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          // Transparent background for PNG
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
      if (oldPath) {
        await supabase.storage.from('logos').remove([oldPath])
      }
      await updateBusiness({ logo_url: null })
      updateField('logo_url', '')
    } catch (err) {
      console.error('Error removing logo:', err)
    }
  }

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login')
    } catch (err) {
      console.error('Error signing out:', err)
    }
  }

  if (bizLoading) {
    return (
      <>
        <Header title="Settings" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  const plan = business?.plan || 'trial'

  return (
    <>
      <Header title="Settings" />
      <PageWrapper>
        <div className="space-y-4">
          {/* Business Profile */}
          <Card className="space-y-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-gray-900">Business Profile</h3>
            </div>

            <Input
              label="Business Name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
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
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
            {/* Logo upload */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-600">Company Logo</label>
              {form.logo_url ? (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden p-2">
                    <img src={form.logo_url} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-pool-600 font-semibold hover:text-pool-700 text-left"
                    >
                      Change logo
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="text-xs text-red-500 font-semibold hover:text-red-600 text-left"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-gray-200 rounded-2xl hover:border-pool-400 hover:bg-pool-50/30 transition-all cursor-pointer"
                >
                  {uploading ? (
                    <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-sm text-gray-400">Tap to upload logo</span>
                      <span className="text-[11px] text-gray-300">Max 400x200px, under 2MB</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-600">Brand Colour</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.brand_colour}
                  onChange={(e) => updateField('brand_colour', e.target.value)}
                  className="w-11 h-11 rounded-xl border-2 border-gray-200 cursor-pointer p-0.5 shadow-inner-soft"
                />
                <span className="text-sm text-gray-400 font-mono">{form.brand_colour}</span>
              </div>
            </div>

            <Button
              onClick={handleSave}
              loading={saving}
              className={cn('w-full min-h-tap', saved && 'bg-gradient-success')}
            >
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </Card>

          {/* Chemical Library */}
          <Card onClick={() => navigate('/settings/chemicals')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Chemical Library</h3>
              <p className="text-xs text-gray-400">Manage your products and dosages</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Staff */}
          <Card onClick={() => navigate('/settings/staff')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Staff</h3>
              <p className="text-xs text-gray-400">Manage your team members</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Subscription */}
          <Card className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Subscription</h3>
              <p className="text-xs text-gray-400">Manage your plan</p>
            </div>
            <Badge variant={PLAN_BADGE[plan] || 'default'}>
              {plan.charAt(0).toUpperCase() + plan.slice(1)}
            </Badge>
          </Card>

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            className="w-full py-3.5 text-sm font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-colors min-h-tap"
          >
            Sign Out
          </button>
        </div>
      </PageWrapper>
    </>
  )
}
