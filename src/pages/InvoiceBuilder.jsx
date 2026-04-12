import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { formatCurrency, calculateGST } from '../lib/utils'

const EMPTY_LINE = { description: '', quantity: 1, unit_price: 0 }

export default function InvoiceBuilder() {
  const { business } = useBusiness()
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const isEditing = Boolean(id)

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [lineItems, setLineItems] = useState([{ ...EMPTY_LINE }])
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(isEditing)
  const [confirmSendOpen, setConfirmSendOpen] = useState(false)
  const [prefillRef, setPrefillRef] = useState('')

  // Pre-fill from query params (from Work Order or Quote conversion)
  useEffect(() => {
    if (isEditing) return
    const clientParam = searchParams.get('client')
    const descParam = searchParams.get('desc')
    const priceParam = searchParams.get('price')
    const refParam = searchParams.get('ref')
    const itemsParam = searchParams.get('items')

    if (clientParam) setClientId(clientParam)
    if (refParam) setPrefillRef(refParam)

    if (itemsParam) {
      // From quote: full line items JSON
      try {
        const items = JSON.parse(itemsParam)
        if (Array.isArray(items) && items.length > 0) {
          setLineItems(items.map(li => ({
            description: li.description || '',
            quantity: li.quantity || 1,
            unit_price: li.unit_price || 0,
          })))
        }
      } catch (e) { /* ignore parse errors */ }
    } else if (descParam) {
      // From work order: single line item
      setLineItems([{
        description: descParam,
        quantity: 1,
        unit_price: priceParam ? Number(priceParam) : 0,
      }])
    }
  }, [isEditing, searchParams])

  // Fetch clients
  useEffect(() => {
    if (!business?.id) return
    supabase
      .from('clients')
      .select('id, name, email')
      .eq('business_id', business.id)
      .order('name')
      .then(({ data }) => setClients(data || []))
  }, [business?.id])

  // Set defaults from business
  useEffect(() => {
    if (!business || isEditing) return
    const prefix = business.invoice_prefix || 'INV'
    const nextNum = business.next_invoice_number || 1
    setInvoiceNumber(`${prefix}-${String(nextNum).padStart(3, '0')}`)

    const termsDays = business.default_payment_terms_days || 14
    const due = new Date()
    due.setDate(due.getDate() + termsDays)
    setDueDate(due.toISOString().split('T')[0])
  }, [business, isEditing])

  // Fetch existing invoice if editing
  useEffect(() => {
    if (!id) return
    async function fetchInvoice() {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        console.error('Error fetching invoice:', error)
        navigate('/invoices')
        return
      }

      setClientId(data.client_id || '')
      setInvoiceNumber(data.invoice_number || '')
      setLineItems(data.line_items?.length ? data.line_items : [{ ...EMPTY_LINE }])
      setIssuedDate(data.issued_date || '')
      setDueDate(data.due_date || '')
      setNotes(data.notes || '')
      setLoading(false)
    }
    fetchInvoice()
  }, [id])

  const clientOptions = useMemo(
    () => [
      { value: '', label: 'Select client...' },
      ...clients.map(c => ({ value: c.id, label: c.name })),
    ],
    [clients]
  )

  // Calculations
  const subtotal = lineItems.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0),
    0
  )
  const gst = calculateGST(subtotal)
  const total = subtotal + gst

  function updateLineItem(index, field, value) {
    setLineItems(prev =>
      prev.map((item, i) =>
        i === index
          ? { ...item, [field]: field === 'description' ? value : Number(value) || 0 }
          : item
      )
    )
  }

  function addLineItem() {
    setLineItems(prev => [...prev, { ...EMPTY_LINE }])
  }

  function removeLineItem(index) {
    if (lineItems.length <= 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  async function saveInvoice(status = 'draft') {
    if (!clientId) return

    const invoiceData = {
      business_id: business.id,
      client_id: clientId,
      invoice_number: invoiceNumber,
      line_items: lineItems.filter(li => li.description),
      subtotal,
      gst,
      total,
      issued_date: issuedDate || null,
      due_date: dueDate || null,
      notes,
      status,
      ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
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
          .from('invoices')
          .update(invoiceData)
          .eq('id', id)
          .select()
          .single()
      } else {
        result = await supabase.from('invoices').insert(invoiceData).select().single()

        // Increment next invoice number
        if (!result.error) {
          await supabase
            .from('businesses')
            .update({ next_invoice_number: (business.next_invoice_number || 1) + 1 })
            .eq('id', business.id)
        }
      }

      if (result.error) throw result.error
      setConfirmSendOpen(false)
      navigate('/invoices')
    } catch (err) {
      console.error('Error saving invoice:', err)
    } finally {
      setSaving(false)
      setSending(false)
    }
  }

  if (loading) {
    return (
      <>
        <Header title={isEditing ? 'Edit Invoice' : 'New Invoice'} backTo="/invoices" />
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
      <Header title={isEditing ? `Invoice ${invoiceNumber}` : 'New Invoice'} backTo="/invoices" />
      <PageWrapper>
        <div className="space-y-5">
          {/* Client & Invoice number */}
          <Card className="p-4 space-y-4">
            <Select
              label="Client"
              options={clientOptions}
              value={clientId}
              onChange={e => setClientId(e.target.value)}
            />
            <Input
              label="Invoice Number"
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              placeholder="INV-001"
            />
          </Card>

          {/* Dates */}
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Issue Date"
                type="date"
                value={issuedDate}
                onChange={e => setIssuedDate(e.target.value)}
              />
              <Input
                label="Due Date"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>
          </Card>

          {/* Line items */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Line Items
            </h3>

            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="space-y-2 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <Input
                    label="Description"
                    placeholder="Item description"
                    value={item.description}
                    onChange={e => updateLineItem(index, 'description', e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      label="Qty"
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={e => updateLineItem(index, 'quantity', e.target.value)}
                    />
                    <Input
                      label="Unit Price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={e => updateLineItem(index, 'unit_price', e.target.value)}
                    />
                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700">Total</label>
                      <p className="input bg-gray-50 text-gray-600">
                        {formatCurrency((item.quantity || 0) * (item.unit_price || 0))}
                      </p>
                    </div>
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
          </Card>

          {/* Notes */}
          <Card className="p-4">
            <TextArea
              label="Notes"
              placeholder="Payment instructions, thank you message, etc..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
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
              onClick={() => saveInvoice('draft')}
              loading={saving}
            >
              Save Draft
            </Button>
            <Button
              variant="primary"
              className="flex-1 min-h-tap"
              onClick={() => setConfirmSendOpen(true)}
              disabled={!clientId || lineItems.every(li => !li.description)}
            >
              Mark as Sent
            </Button>
          </div>
        </div>
      </PageWrapper>

      {/* Confirm send modal */}
      <Modal open={confirmSendOpen} onClose={() => setConfirmSendOpen(false)} title="Send Invoice">
        <p className="text-sm text-gray-600 mb-4">
          This will mark the invoice as sent. The client will be able to view it via their portal.
        </p>
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => setConfirmSendOpen(false)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => saveInvoice('sent')}
            loading={sending}
          >
            Confirm & Send
          </Button>
        </div>
      </Modal>
    </>
  )
}
