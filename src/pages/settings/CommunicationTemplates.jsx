import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input, { TextArea, Select } from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { PLACEHOLDERS, DEFAULT_TEMPLATES, renderTemplate } from '../../lib/templateEngine'
import { cn } from '../../lib/utils'

const TRIGGER_TYPES = [
  { value: '', label: 'No trigger (manual)' },
  { value: 'service_reminder', label: 'Service Reminder' },
  { value: 'running_late', label: 'Running Late' },
  { value: 'service_complete', label: 'Service Complete' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'survey', label: 'Survey Request' },
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'quote_accepted', label: 'Quote Accepted' },
  { value: 'job_update', label: 'Job Status Update' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'custom', label: 'Custom' },
]

const TRIGGER_COLORS = {
  service_reminder: 'primary',
  running_late: 'warning',
  service_complete: 'success',
  follow_up: 'mineral',
  survey: 'freshwater',
  quote_sent: 'chlorine',
  quote_accepted: 'success',
  job_update: 'default',
  invoice: 'salt',
  custom: 'default',
}

const TYPE_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
]

const emptyTemplate = {
  name: '',
  type: 'email',
  trigger_type: '',
  subject: '',
  body: '',
  is_active: true,
}

export default function CommunicationTemplates() {
  const { business } = useBusiness()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyTemplate)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showPlaceholders, setShowPlaceholders] = useState(false)

  useEffect(() => {
    if (business?.id) fetchTemplates()
  }, [business?.id])

  async function fetchTemplates() {
    setLoading(true)
    const { data } = await supabase
      .from('communication_templates')
      .select('*')
      .eq('business_id', business.id)
      .order('trigger_type')
      .order('type')
      .order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyTemplate)
    setModalOpen(true)
  }

  function openEdit(template) {
    setEditing(template)
    setForm({
      name: template.name || '',
      type: template.type || 'email',
      trigger_type: template.trigger_type || '',
      subject: template.subject || '',
      body: template.body || '',
      is_active: template.is_active !== false,
    })
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.body.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        trigger_type: form.trigger_type || null,
        subject: form.type === 'email' ? form.subject.trim() : null,
        body: form.body.trim(),
        is_active: form.is_active,
      }
      if (editing) {
        await supabase.from('communication_templates').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('communication_templates').insert({ ...payload, business_id: business.id })
      }
      setModalOpen(false)
      fetchTemplates()
    } catch (err) {
      alert(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing || !confirm('Delete this template?')) return
    await supabase.from('communication_templates').delete().eq('id', editing.id)
    setModalOpen(false)
    fetchTemplates()
  }

  async function seedDefaults() {
    const existing = templates.map(t => `${t.name}-${t.type}`.toLowerCase())
    const toAdd = DEFAULT_TEMPLATES.filter(t => !existing.includes(`${t.name}-${t.type}`.toLowerCase()))
    if (toAdd.length === 0) return
    await supabase.from('communication_templates').insert(
      toAdd.map(t => ({ ...t, business_id: business.id }))
    )
    fetchTemplates()
  }

  function insertPlaceholder(placeholder) {
    setForm(prev => ({ ...prev, body: prev.body + placeholder }))
    setShowPlaceholders(false)
  }

  // Preview with sample data
  const previewVars = {
    client_name: 'John Smith', client_first_name: 'John', client_email: 'john@example.com',
    client_phone: '0412 345 678', pool_address: '123 Main St, Sydney', pool_type: 'Concrete',
    job_date: 'Wednesday 15 April 2026', job_time: '9:00 AM', job_type: 'Regular Maintenance',
    technician_name: 'Mike Wilson', business_name: business?.name || 'Pool Co',
    business_phone: business?.phone || '1300 123 456', business_email: business?.email || 'info@poolco.com.au',
    portal_link: 'https://poolmateapp.online/portal/abc123', survey_link: 'https://poolmateapp.online/survey/abc123',
    next_service_date: 'Wednesday 22 April 2026', eta_minutes: '15',
    invoice_number: 'INV-001', invoice_total: '$150.00', quote_total: '$250.00',
  }

  const triggerLabel = (key) => TRIGGER_TYPES.find(t => t.value === key)?.label || 'Manual'

  // Group templates by trigger type
  const grouped = templates.reduce((acc, t) => {
    const key = t.trigger_type || 'custom'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  if (loading) {
    return (
      <>
        <Header title="Message Templates" backTo="/settings" />
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
      <Header
        title="Message Templates"
        backTo="/settings"
        right={
          <button onClick={openAdd} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors">
            <svg className="w-6 h-6 text-pool-600 dark:text-pool-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        }
      />
      <PageWrapper>
        {templates.length === 0 ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            }
            title="No templates yet"
            description="Create message templates for automated emails and SMS"
            action="Load Default Templates"
            onAction={seedDefaults}
          />
        ) : (
          <div className="space-y-5">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={seedDefaults} className="flex-1 text-xs">
                Load Defaults
              </Button>
              <Button onClick={openAdd} className="flex-1 text-xs">
                + New Template
              </Button>
            </div>

            {Object.entries(grouped).map(([trigger, items]) => (
              <section key={trigger}>
                <h3 className="section-title mb-2">{triggerLabel(trigger)}</h3>
                <div className="space-y-2">
                  {items.map(t => (
                    <Card key={t.id} onClick={() => openEdit(t)}>
                      <div className="flex items-start gap-3">
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                          t.type === 'sms' ? 'bg-green-50 dark:bg-green-950/40' : 'bg-blue-50 dark:bg-blue-950/40')}>
                          {t.type === 'sms' ? (
                            <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{t.name}</p>
                            {!t.is_active && <Badge variant="default">Disabled</Badge>}
                          </div>
                          {t.subject && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.subject}</p>}
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1">{t.body}</p>
                        </div>
                        <Badge variant={TRIGGER_COLORS[t.trigger_type] || 'default'} className="shrink-0 mt-0.5">
                          {t.type.toUpperCase()}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </PageWrapper>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Template' : 'New Template'}>
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Template Name"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Service Reminder"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              options={TYPE_OPTIONS}
              value={form.type}
              onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
            />
            <Select
              label="Trigger"
              options={TRIGGER_TYPES}
              value={form.trigger_type}
              onChange={e => setForm(prev => ({ ...prev, trigger_type: e.target.value }))}
            />
          </div>
          {form.type === 'email' && (
            <Input
              label="Subject Line"
              value={form.subject}
              onChange={e => setForm(prev => ({ ...prev, subject: e.target.value }))}
              placeholder="e.g. Pool Service Tomorrow — {pool_address}"
            />
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">Message Body</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPlaceholders(!showPlaceholders)}
                  className="text-[11px] text-pool-600 dark:text-pool-400 font-semibold hover:text-pool-700"
                >
                  {showPlaceholders ? 'Hide' : '+ Insert Variable'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold hover:text-gray-700 dark:text-gray-300"
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
            </div>

            {showPlaceholders && (
              <div className="flex flex-wrap gap-1.5 mb-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl animate-fade-in">
                {PLACEHOLDERS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => insertPlaceholder(p.key)}
                    className="text-[11px] px-2 py-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-pool-600 font-medium hover:bg-pool-50 transition-colors"
                  >
                    {p.key}
                  </button>
                ))}
              </div>
            )}

            {showPreview ? (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed min-h-[120px]">
                {form.type === 'email' && form.subject && (
                  <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    {renderTemplate(form.subject, previewVars)}
                  </p>
                )}
                {renderTemplate(form.body, previewVars) || <span className="text-gray-400 dark:text-gray-500 italic">Empty template</span>}
              </div>
            ) : (
              <TextArea
                value={form.body}
                onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))}
                placeholder={form.type === 'sms'
                  ? 'Hi {client_first_name}, reminder: your pool service is tomorrow. {business_name}'
                  : 'Hi {client_name},\n\nJust a friendly reminder that your pool service is scheduled for tomorrow.\n\nThanks,\n{business_name}'}
                rows={6}
              />
            )}
            {form.type === 'sms' && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                {form.body.length}/160 characters {form.body.length > 160 ? `(${Math.ceil(form.body.length / 153)} segments)` : ''}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(prev => ({ ...prev, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-pool-600 dark:text-pool-400 focus:ring-pool-500"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">Active</span>
          </label>

          <div className="flex gap-3 pt-2">
            {editing && (
              <Button type="button" variant="danger" onClick={handleDelete} className="px-4">Delete</Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
