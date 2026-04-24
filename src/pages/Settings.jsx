import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Mail, Zap, ClipboardList, Beaker, Users as UsersIcon,
  Star, Upload, Plug, CreditCard, ChevronRight, LogOut, Image as ImageIcon, Trash2,
} from 'lucide-react'
import PageWrapper from '../components/layout/PageWrapper'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'
import { ThemeToggleFull } from '../components/layout/ThemeToggle'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

const PLAN_BADGE = {
  trial: 'warning',
  starter: 'primary',
  pro: 'success',
}

const AUSTRALIAN_TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
]

// Sub-page sections — grouped row-link card
const SECTIONS = [
  { to: '/settings/templates', label: 'Message Templates', description: 'Email & SMS templates for automations',  Icon: Mail,          color: 'blue'    },
  { to: '/settings/automations', label: 'Automations',     description: 'Auto-send reminders & follow-ups',       Icon: Zap,           color: 'amber'   },
  { to: '/settings/job-types', label: 'Job Types',         description: 'Service templates with default tasks',    Icon: ClipboardList, color: 'cyan'    },
  { to: '/settings/chemicals', label: 'Chemical Library',  description: 'Manage your products and dosages',        Icon: Beaker,        color: 'emerald' },
  { to: '/settings/staff',     label: 'Staff',             description: 'Manage your team members',                Icon: UsersIcon,     color: 'violet'  },
  { to: '/settings/surveys',   label: 'Survey Results',    description: 'Customer feedback & ratings',             Icon: Star,          color: 'pink'    },
  { to: '/settings/import',    label: 'Import Data',       description: 'Bulk import clients & pools from CSV',    Icon: Upload,        color: 'indigo'  },
]

const COLOR_CLASSES = {
  blue:    'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
  amber:   'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  cyan:    'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
  violet:  'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400',
  pink:    'bg-pink-50 dark:bg-pink-950/40 text-pink-600 dark:text-pink-400',
  indigo:  'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400',
  teal:    'bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400',
  pool:    'bg-pool-50 dark:bg-pool-950/40 text-pool-600 dark:text-pool-400',
  red:     'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
}

export default function Settings() {
  const { business, loading: bizLoading, updateBusiness } = useBusiness()
  const { user, signOut } = useAuth()
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
      <PageWrapper>
        <PageHero title="Settings" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageWrapper>
    )
  }

  const plan = business?.plan || 'trial'

  return (
    <>
      <PageWrapper>
        <PageHero
          title="Settings"
          subtitle={user?.email ? `Signed in as ${user.email}` : undefined}
        />

        <div className="space-y-6">
          {/* ── Business Profile ─────────────────────────────── */}
          <div className="space-y-2">
            <h2 className="section-title">Business</h2>
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
                      <button type="button" onClick={handleRemoveLogo} className="text-xs text-red-500 font-semibold hover:text-red-600 text-left flex items-center gap-1">
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
          </div>

          {/* ── Configuration sections — divided row-link card ── */}
          <div className="space-y-2">
            <h2 className="section-title">Configuration</h2>
            <Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800">
              {SECTIONS.map(s => (
                <button
                  key={s.to}
                  onClick={() => navigate(s.to)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                >
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES[s.color])}>
                    <s.Icon className="w-5 h-5" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{s.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{s.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                </button>
              ))}
            </Card>
          </div>

          {/* ── Integrations & Subscription ─────────────────── */}
          <div className="space-y-2">
            <h2 className="section-title">Account</h2>
            <Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800">
              <button
                onClick={() => navigate('/settings/integrations')}
                className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES.teal)}>
                  <Plug className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Integrations</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Xero, QuickBooks, Stripe & more</p>
                </div>
                <Badge variant="default">Coming Soon</Badge>
              </button>
              <div className="w-full flex items-center gap-3 px-4 py-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', COLOR_CLASSES.amber)}>
                  <CreditCard className="w-5 h-5" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Subscription</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Manage your plan</p>
                </div>
                <Badge variant={PLAN_BADGE[plan] || 'default'}>
                  {plan.charAt(0).toUpperCase() + plan.slice(1)}
                </Badge>
              </div>
            </Card>
          </div>

          {/* ── Appearance ───────────────────────────────────── */}
          <div className="space-y-2">
            <h2 className="section-title">Appearance</h2>
            <Card className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-gray-100">Theme</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Choose light, dark, or match your system
                </p>
              </div>
              <ThemeToggleFull />
            </Card>
          </div>

          {/* ── Sign out ─────────────────────────────────────── */}
          <button
            onClick={handleSignOut}
            className="w-full py-3.5 text-sm font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-2xl transition-colors min-h-tap flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" strokeWidth={2} />
            Sign Out
          </button>
        </div>
      </PageWrapper>
    </>
  )
}
