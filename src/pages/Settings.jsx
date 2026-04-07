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
        <div className="space-y-5">
          {/* Business Profile */}
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Business Profile
            </h3>

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

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Brand Colour</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={form.brand_colour}
                  onChange={(e) => updateField('brand_colour', e.target.value)}
                  className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                />
                <span className="text-sm text-gray-500">{form.brand_colour}</span>
              </div>
            </div>

            <Button
              onClick={handleSave}
              loading={saving}
              className="w-full min-h-tap"
            >
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>
          </Card>

          {/* Subscription */}
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Subscription
            </h3>

            <div className="flex items-center gap-3">
              <p className="text-gray-900 font-medium">Current Plan</p>
              <Badge variant={PLAN_BADGE[plan] || 'default'}>
                {plan.charAt(0).toUpperCase() + plan.slice(1)}
              </Badge>
            </div>

            <Button
              variant="secondary"
              onClick={() => navigate('/subscription')}
              className="w-full min-h-tap"
            >
              Manage Subscription
            </Button>
          </Card>

          {/* Sign Out */}
          <Button
            variant="danger"
            onClick={handleSignOut}
            className="w-full min-h-tap"
          >
            Sign Out
          </Button>
        </div>
      </PageWrapper>
    </>
  )
}
