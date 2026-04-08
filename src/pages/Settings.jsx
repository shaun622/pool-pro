import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
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
            <Input
              label="Logo URL"
              type="url"
              value={form.logo_url}
              onChange={(e) => updateField('logo_url', e.target.value)}
              placeholder="https://..."
            />

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
