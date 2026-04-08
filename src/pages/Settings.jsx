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

          {/* Message Templates */}
          <Card onClick={() => navigate('/settings/templates')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Message Templates</h3>
              <p className="text-xs text-gray-400">Email & SMS templates for automations</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Automations */}
          <Card onClick={() => navigate('/settings/automations')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Automations</h3>
              <p className="text-xs text-gray-400">Auto-send reminders & follow-ups</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Job Types */}
          <Card onClick={() => navigate('/settings/job-types')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Job Types</h3>
              <p className="text-xs text-gray-400">Service templates with default tasks</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
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

          {/* Surveys */}
          <Card onClick={() => navigate('/settings/surveys')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Survey Results</h3>
              <p className="text-xs text-gray-400">Customer feedback & ratings</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Import Data */}
          <Card onClick={() => navigate('/settings/import')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Import Data</h3>
              <p className="text-xs text-gray-400">Bulk import clients & pools from CSV</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Card>

          {/* Integrations */}
          <Card onClick={() => navigate('/settings/integrations')} className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.313a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364l1.757 1.757" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">Integrations</h3>
              <p className="text-xs text-gray-400">Xero, QuickBooks, Stripe & more</p>
            </div>
            <Badge variant="default">Coming Soon</Badge>
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
