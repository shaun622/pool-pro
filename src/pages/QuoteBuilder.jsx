import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import { useBusiness } from '../hooks/useBusiness'
import { useClients } from '../hooks/useClients'
import { supabase } from '../lib/supabase'
import { formatCurrency, calculateGST, cn } from '../lib/utils'

const EMPTY_LINE = { description: '', quantity: 1, unit_price: 0, recurring: null }

const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: '6_weekly', label: 'Every 6 Weeks' },
  { value: 'quarterly', label: 'Quarterly' },
]

export default function QuoteBuilder() {
  const { business } = useBusiness()
  const { clients, createClient } = useClients()
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = Boolean(id)

  const [clientId, setClientId] = useState('')
  const [poolId, setPoolId] = useState('')
  const [clientPools, setClientPools] = useState([])
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE }])
  const [scope, setScope] = useState('')
  const [terms, setTerms] = useState('')
  const [pricingItems, setPricingItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(isEditing)

  // New client modal
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [newClientForm, setNewClientForm] = useState({ name: '', email: '', phone: '', address: '' })
  const [newClientSaving, setNewClientSaving] = useState(false)

  // Fetch pricing items
  useEffect(() => {
    if (!business?.id) return
    supabase
      .from('pricing_items')
      .select('*')
      .eq('business_id', business.id)
      .order('name')
      .then(({ data }) => setPricingItems(data || []))
  }, [business?.id])

  // Fetch existing quote if editing
  useEffect(() => {
    if (!id) return
    async function fetchQuote() {
      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        console.error('Error fetching quote:', error)
        navigate('/jobs')
        return
      }

      setClientId(data.client_id || '')
      setPoolId(data.pool_id || '')
      setLineItems(data.line_items?.length ? data.line_items.map(li => ({ ...EMPTY_LINE, ...li })) : [{ ...EMPTY_LINE }])
      setScope(data.scope || '')
      setTerms(data.terms || '')
      setLoading(false)
    }
    fetchQuote()
  }, [id])

  // Fetch pools for selected client
  useEffect(() => {
    if (!clientId) {
      setClientPools([])
      setPoolId('')
      return
    }
    supabase
      .from('pools')
      .select('id, name, address')
      .eq('client_id', clientId)
      .then(({ data }) => setClientPools(data || []))
  }, [clientId])

  const clientOptions = useMemo(
    () => [
      { value: '', label: 'Select client...' },
      ...clients.map((c) => ({ value: c.id, label: c.name })),
    ],
    [clients]
  )

  const poolOptions = useMemo(
    () => [
      { value: '', label: 'No pool (general)' },
      ...clientPools.map((p) => ({ value: p.id, label: p.address || p.name })),
    ],
    [clientPools]
  )

  const pricingOptions = useMemo(
    () => [
      { value: '', label: 'Add from saved items...' },
      ...pricingItems.map((p) => ({
        value: p.id,
        label: `${p.name} - ${formatCurrency(p.unit_price)}`,
      })),
    ],
    [pricingItems]
  )

  // Calculations
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0),
    0
  )
  const gst = calculateGST(subtotal)
  const total = subtotal + gst

  function updateLineItem(index, field, value) {
    const stringFields = ['description', 'recurring']
    setLineItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, [field]: stringFields.includes(field) ? value : Number(value) || 0 }
          : item
      )
    )
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE }])
  }

  function removeLineItem(index) {
    if (lineItems.length <= 1) return
    setLineItems((prev) => prev.filter((_, i) => i !== index))
  }

  function addPricingItem(pricingItemId) {
    if (!pricingItemId) return
    const item = pricingItems.find((p) => p.id === pricingItemId)
    if (!item) return
    setLineItems((prev) => [
      ...prev,
      { description: item.name, quantity: 1, unit_price: item.unit_price, recurring: null },
    ])
  }

  async function handleCreateClient(e) {
    e.preventDefault()
    if (!newClientForm.name.trim()) return
    setNewClientSaving(true)
    try {
      const created = await createClient(newClientForm)
      setClientId(created.id)
      setNewClientOpen(false)
      setNewClientForm({ name: '', email: '', phone: '', address: '' })
    } catch (err) {
      console.error('Error creating client:', err)
    } finally {
      setNewClientSaving(false)
    }
  }

  async function saveQuote(status = 'draft') {
    if (!clientId) return

    const quoteData = {
      business_id: business.id,
      client_id: clientId,
      pool_id: poolId || null,
      line_items: lineItems.filter((li) => li.description),
      scope,
      terms,
      subtotal,
      gst,
      total,
      status,
      recurring_settings: null,
    }

    try {
      if (status === 'sent') {
        setSending(true)
      } else {
        setSaving(true)
      }

      let result
      if (isEditing) {
        result = await supabase
          .from('quotes')
          .update(quoteData)
          .eq('id', id)
          .select()
          .single()
      } else {
        result = await supabase.from('quotes').insert(quoteData).select().single()
      }

      if (result.error) throw result.error

      // If sending, invoke edge function
      if (status === 'sent') {
        try {
          await supabase.functions.invoke('send-quote', {
            body: { quote_id: result.data.id },
          })
        } catch (err) {
          console.error('Failed to send quote notification:', err)
        }
      }

      navigate('/jobs')
    } catch (err) {
      console.error('Error saving quote:', err)
    } finally {
      setSaving(false)
      setSending(false)
    }
  }

  if (loading) {
    return (
      <>
        <Header title={isEditing ? 'Edit Quote' : 'New Quote'} backTo="/jobs" />
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
      <Header title={isEditing ? 'Edit Quote' : 'New Quote'} backTo="/jobs" />
      <PageWrapper>
        <div className="space-y-5">
          {/* Client & Pool selection */}
          <Card className="p-4 space-y-4">
            <div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    label="Client"
                    options={clientOptions}
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setNewClientOpen(true)}
                  className="min-h-[44px] px-3 rounded-lg border border-dashed border-pool-300 text-pool-600 text-sm font-medium hover:bg-pool-50 transition-colors whitespace-nowrap"
                >
                  + New
                </button>
              </div>
            </div>
            {clientId && (
              <Select
                label="Pool (optional)"
                options={poolOptions}
                value={poolId}
                onChange={(e) => setPoolId(e.target.value)}
              />
            )}
          </Card>

          {/* Line items */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Line Items
            </h3>

            {/* Saved pricing picker */}
            {pricingItems.length > 0 && (
              <div className="mb-4">
                <Select
                  options={pricingOptions}
                  onChange={(e) => {
                    addPricingItem(e.target.value)
                    e.target.value = ''
                  }}
                />
              </div>
            )}

            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="space-y-2 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <Input
                    label="Description"
                    placeholder="Item description"
                    value={item.description}
                    onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      label="Qty"
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                    />
                    <Input
                      label="Unit Price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', e.target.value)}
                    />
                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700">Total</label>
                      <p className="input bg-gray-50 text-gray-600">
                        {formatCurrency((item.quantity || 0) * (item.unit_price || 0))}
                      </p>
                    </div>
                  </div>
                  {/* Billing type: one-off or recurring */}
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      <button type="button"
                        onClick={() => updateLineItem(index, 'recurring', null)}
                        className={cn('px-3 py-1.5 text-xs font-semibold transition-colors',
                          !item.recurring ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>
                        One-off
                      </button>
                      <button type="button"
                        onClick={() => updateLineItem(index, 'recurring', 'monthly')}
                        className={cn('px-3 py-1.5 text-xs font-semibold transition-colors border-l border-gray-200',
                          item.recurring ? 'bg-pool-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}>
                        Recurring
                      </button>
                    </div>
                    {item.recurring && (
                      <select
                        value={item.recurring}
                        onChange={e => updateLineItem(index, 'recurring', e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 min-h-[32px]"
                      >
                        {FREQUENCY_OPTIONS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {lineItems.length > 1 && (
                    <button
                      onClick={() => removeLineItem(index)}
                      className="text-xs text-red-500 hover:text-red-700 min-h-tap flex items-center"
                    >
                      Remove item
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addLineItem}
              className="mt-3 text-sm text-pool-600 font-medium hover:text-pool-700 min-h-tap flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add line item
            </button>

            {/* Recurring info note */}
            {lineItems.some(li => li.recurring) && (
              <div className="bg-pool-50 border border-pool-200 rounded-lg p-2.5 mt-3">
                <p className="text-xs text-pool-600">
                  <svg className="w-3.5 h-3.5 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Recurring items will generate ongoing invoices. One-off items only appear on the first invoice.
                </p>
              </div>
            )}
          </Card>

          {/* Scope & Terms */}
          <Card className="p-4 space-y-4">
            <TextArea
              label="Scope of Work"
              placeholder="Describe the work to be completed..."
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
            <TextArea
              label="Terms & Conditions"
              placeholder="Payment terms, warranty, etc..."
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Card>

          {/* Totals */}
          <Card className="p-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-700">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">GST (10%)</span>
                <span className="text-gray-700">{formatCurrency(gst)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold border-t border-gray-200 pt-2">
                <span className="text-gray-900">Total</span>
                <span className="text-gray-900">{formatCurrency(total)}</span>
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1 min-h-tap"
              onClick={() => saveQuote('draft')}
              loading={saving}
            >
              Save Draft
            </Button>
            <Button
              variant="primary"
              className="flex-1 min-h-tap"
              onClick={() => saveQuote('sent')}
              loading={sending}
              disabled={!clientId || lineItems.every((li) => !li.description)}
            >
              Send Quote
            </Button>
          </div>
        </div>
      </PageWrapper>

      {/* New Client Modal */}
      <Modal open={newClientOpen} onClose={() => setNewClientOpen(false)} title="New Client">
        <form onSubmit={handleCreateClient} className="space-y-4">
          <Input
            label="Name"
            value={newClientForm.name}
            onChange={e => setNewClientForm(prev => ({ ...prev, name: e.target.value }))}
            required
            placeholder="Full name"
          />
          <Input
            label="Email"
            type="email"
            value={newClientForm.email}
            onChange={e => setNewClientForm(prev => ({ ...prev, email: e.target.value }))}
            placeholder="email@example.com"
          />
          <Input
            label="Phone"
            type="tel"
            value={newClientForm.phone}
            onChange={e => setNewClientForm(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="0400 000 000"
          />
          <Input
            label="Address"
            value={newClientForm.address}
            onChange={e => setNewClientForm(prev => ({ ...prev, address: e.target.value }))}
            placeholder="Street address"
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setNewClientOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={newClientSaving}>
              Create Client
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
