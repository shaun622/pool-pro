import { useState, useEffect } from 'react'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import ConfirmModal from '../../components/ui/ConfirmModal'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { formatDate, cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'

const TRIGGER_EVENTS = [
  { value: 'service_completed', label: 'Service Completed' },
  { value: 'job_scheduled', label: 'Job Scheduled' },
  { value: 'job_started', label: 'Job Started' },
  { value: 'job_completed', label: 'Job Completed' },
  { value: 'job_running_late', label: 'Running Late' },
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'quote_accepted', label: 'Quote Accepted' },
]

const TRIGGER_COLORS = {
  service_completed: 'success',
  job_scheduled: 'primary',
  job_started: 'warning',
  job_completed: 'success',
  job_running_late: 'danger',
  quote_sent: 'chlorine',
  quote_accepted: 'success',
}

const TRIGGER_ICONS = {
  service_completed: '✓',
  job_scheduled: '📅',
  job_started: '▶',
  job_completed: '✓',
  job_running_late: '⏰',
  quote_sent: '📤',
  quote_accepted: '✅',
}

const ACTION_OPTIONS = [
  { value: 'send_email', label: 'Send Email' },
  { value: 'send_sms', label: 'Send SMS' },
  { value: 'both', label: 'Email + SMS' },
]

const DELAY_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '15', label: '15 minutes after' },
  { value: '60', label: '1 hour after' },
  { value: '120', label: '2 hours after' },
  { value: '1440', label: '24 hours after' },
  { value: '-1440', label: '24 hours before' },
  { value: '-2880', label: '48 hours before' },
]

const emptyForm = {
  name: '',
  trigger_event: 'service_completed',
  action_type: 'send_email',
  template_id: '',
  delay_minutes: '0',
}

export default function Automations() {
  const toast = useToast()
  const { business } = useBusiness()
  const [rules, setRules] = useState([])
  const [templates, setTemplates] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (business?.id) fetchAll()
  }, [business?.id])

  async function fetchAll() {
    setLoading(true)
    const [rulesRes, templatesRes, logsRes] = await Promise.all([
      supabase.from('automation_rules').select('*, communication_templates:template_id(name, type)')
        .eq('business_id', business.id).order('created_at', { ascending: false }),
      supabase.from('communication_templates').select('id, name, type, trigger_type')
        .eq('business_id', business.id).eq('is_active', true).order('name'),
      supabase.from('automation_logs').select('*')
        .eq('business_id', business.id).order('sent_at', { ascending: false }).limit(50),
    ])
    setRules(rulesRes.data || [])
    setTemplates(templatesRes.data || [])
    setLogs(logsRes.data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(rule) {
    setEditing(rule)
    setForm({
      name: rule.name || '',
      trigger_event: rule.trigger_event || 'service_completed',
      action_type: rule.action_type || 'send_email',
      template_id: rule.template_id || '',
      delay_minutes: String(rule.delay_minutes || 0),
    })
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        trigger_event: form.trigger_event,
        action_type: form.action_type,
        template_id: form.template_id || null,
        delay_minutes: Number(form.delay_minutes) || 0,
        is_active: true,
      }
      if (editing) {
        await supabase.from('automation_rules').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('automation_rules').insert({ ...payload, business_id: business.id })
      }
      setModalOpen(false)
      fetchAll()
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rule) {
    await supabase.from('automation_rules').update({ is_active: !rule.is_active }).eq('id', rule.id)
    fetchAll()
  }

  async function handleDelete() {
    if (!editing) return
    await supabase.from('automation_rules').delete().eq('id', editing.id)
    setModalOpen(false)
    fetchAll()
  }

  const triggerLabel = (key) => TRIGGER_EVENTS.find(t => t.value === key)?.label || key
  const delayLabel = (mins) => {
    if (mins === 0) return 'Immediately'
    if (mins < 0) return `${Math.abs(mins / 60)}h before`
    if (mins < 60) return `${mins}m after`
    return `${mins / 60}h after`
  }

  // Filter templates based on selected action type
  const filteredTemplates = templates.filter(t => {
    if (form.action_type === 'send_email') return t.type === 'email'
    if (form.action_type === 'send_sms') return t.type === 'sms'
    return true // 'both' shows all
  })

  if (loading) {
    return (
      <>
        <Header title="Automations" backTo="/settings" />
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
        title="Automations"
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
        {/* Tab toggle */}
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-5">
          <button
            className={cn('flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all',
              !showLogs ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-card' : 'text-gray-500 dark:text-gray-400')}
            onClick={() => setShowLogs(false)}
          >
            Rules ({rules.length})
          </button>
          <button
            className={cn('flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all',
              showLogs ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-card' : 'text-gray-500 dark:text-gray-400')}
            onClick={() => setShowLogs(true)}
          >
            Activity Log
          </button>
        </div>

        {!showLogs ? (
          <>
            {rules.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                }
                title="No automations yet"
                description="Set up rules to automatically send messages"
                action="Create Automation"
                onAction={openAdd}
              />
            ) : (
              <div className="space-y-2.5">
                {rules.map(rule => (
                  <Card key={rule.id} onClick={() => openEdit(rule)}>
                    <div className="flex items-start gap-3">
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-sm',
                        rule.is_active ? 'bg-green-50' : 'bg-gray-100 dark:bg-gray-800')}>
                        {TRIGGER_ICONS[rule.trigger_event] || '⚡'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={cn('text-sm font-semibold truncate', rule.is_active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500')}>
                            {rule.name}
                          </p>
                          {!rule.is_active && <Badge variant="default">Paused</Badge>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {triggerLabel(rule.trigger_event)} → {rule.action_type === 'both' ? 'Email + SMS' : rule.action_type === 'send_sms' ? 'SMS' : 'Email'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={TRIGGER_COLORS[rule.trigger_event] || 'default'} className="text-[10px]">
                            {delayLabel(rule.delay_minutes)}
                          </Badge>
                          {rule.communication_templates?.name && (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{rule.communication_templates.name}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); toggleActive(rule) }}
                        className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0 mt-1',
                          rule.is_active ? 'bg-green-500' : 'bg-gray-300')}
                      >
                        <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white dark:bg-gray-900 shadow transition-transform',
                          rule.is_active ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Activity Log */
          logs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400 dark:text-gray-500">No messages sent yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <Card key={log.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-2 h-2 rounded-full shrink-0 mt-1.5',
                      log.status === 'sent' ? 'bg-green-500' : log.status === 'failed' ? 'bg-red-500' : 'bg-amber-500')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{log.template_name || 'Message'}</p>
                        <Badge variant={log.channel === 'sms' ? 'success' : 'primary'} className="text-[10px] shrink-0">
                          {log.channel?.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {log.recipient_email || log.recipient_phone}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{formatDate(log.sent_at)}</p>
                      {log.error_message && (
                        <p className="text-xs text-red-500 mt-0.5">{log.error_message}</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </PageWrapper>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Automation' : 'New Automation'}>
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Rule Name"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Send reminder day before"
            required
          />
          <Select
            label="Trigger Event"
            options={TRIGGER_EVENTS}
            value={form.trigger_event}
            onChange={e => setForm(prev => ({ ...prev, trigger_event: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Action"
              options={ACTION_OPTIONS}
              value={form.action_type}
              onChange={e => setForm(prev => ({ ...prev, action_type: e.target.value }))}
            />
            <Select
              label="Timing"
              options={DELAY_OPTIONS}
              value={form.delay_minutes}
              onChange={e => setForm(prev => ({ ...prev, delay_minutes: e.target.value }))}
            />
          </div>
          <Select
            label="Message Template"
            options={[
              { value: '', label: 'Select template...' },
              ...filteredTemplates.map(t => ({ value: t.id, label: `${t.name} (${t.type})` }))
            ]}
            value={form.template_id}
            onChange={e => setForm(prev => ({ ...prev, template_id: e.target.value }))}
          />
          {templates.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl">
              No message templates found. Create templates in Settings → Message Templates first.
            </p>
          )}
          <div className="flex gap-3 pt-2">
            {editing && (
              <Button type="button" variant="danger" onClick={() => setConfirmDeleteOpen(true)} className="px-4">Delete</Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete this automation?"
        description="This cannot be undone."
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </>
  )
}
