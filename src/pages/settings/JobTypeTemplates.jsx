import { useState, useEffect } from 'react'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input, { TextArea, Select } from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import ConfirmModal from '../../components/ui/ConfirmModal'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'

const SUGGESTED_JOB_TYPES = [
  {
    name: 'Regular Maintenance',
    description: 'Standard weekly/fortnightly pool maintenance visit',
    default_tasks: ['Check & empty skimmer basket', 'Check & empty pump basket', 'Vacuum pool', 'Brush walls & tiles', 'Test water chemistry', 'Add chemicals as needed', 'Check equipment operation', 'Clean waterline'],
    estimated_duration_minutes: 45,
    color: '#0EA5E9',
  },
  {
    name: 'Green Pool Recovery',
    description: 'Full treatment for algae-affected pools',
    default_tasks: ['Assess algae severity', 'Remove debris', 'Brush all surfaces', 'Shock treat pool', 'Add algaecide', 'Check & clean filter', 'Test water chemistry', 'Set return visit schedule'],
    estimated_duration_minutes: 90,
    color: '#22C55E',
  },
  {
    name: 'Equipment Inspection',
    description: 'Thorough check of all pool equipment',
    default_tasks: ['Inspect pump & motor', 'Check filter pressure', 'Inspect salt cell', 'Check timer/automation', 'Inspect plumbing for leaks', 'Test safety equipment', 'Check water level sensor', 'Report findings'],
    estimated_duration_minutes: 60,
    color: '#8B5CF6',
  },
  {
    name: 'Filter Clean',
    description: 'Deep clean or replacement of filter media',
    default_tasks: ['Turn off equipment', 'Remove filter cartridge/grids', 'Hose & soak filter', 'Inspect for damage', 'Reassemble filter', 'Check pressure after restart', 'Test water flow'],
    estimated_duration_minutes: 75,
    color: '#F59E0B',
  },
  {
    name: 'Pool Opening (Seasonal)',
    description: 'Seasonal pool startup after winter',
    default_tasks: ['Remove cover', 'Clean & store cover', 'Fill pool to operating level', 'Prime & start pump', 'Clean filter', 'Test & balance water', 'Shock treat', 'Inspect all equipment', 'Set timer schedule'],
    estimated_duration_minutes: 120,
    color: '#06B6D4',
  },
  {
    name: 'Site Visit / Quote',
    description: 'Initial visit to assess pool and provide a quote',
    default_tasks: ['Inspect pool condition', 'Measure pool dimensions', 'Check equipment', 'Assess water quality', 'Take photos', 'Discuss requirements with client', 'Prepare quote'],
    estimated_duration_minutes: 30,
    color: '#EC4899',
  },
]

const emptyForm = {
  name: '',
  description: '',
  default_tasks: [],
  estimated_duration_minutes: '',
  default_price: '',
  color: '#0EA5E9',
}

export default function JobTypeTemplates() {
  const toast = useToast()
  const { business } = useBusiness()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [newTask, setNewTask] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)

  useEffect(() => {
    if (business?.id) fetchTemplates()
  }, [business?.id])

  async function fetchTemplates() {
    setLoading(true)
    const { data } = await supabase
      .from('job_type_templates')
      .select('*')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(template) {
    setEditing(template)
    setForm({
      name: template.name || '',
      description: template.description || '',
      default_tasks: template.default_tasks || [],
      estimated_duration_minutes: template.estimated_duration_minutes || '',
      default_price: template.default_price || '',
      color: template.color || '#0EA5E9',
    })
    setModalOpen(true)
  }

  function addTask() {
    if (!newTask.trim()) return
    setForm(prev => ({ ...prev, default_tasks: [...prev.default_tasks, newTask.trim()] }))
    setNewTask('')
  }

  function removeTask(index) {
    setForm(prev => ({ ...prev, default_tasks: prev.default_tasks.filter((_, i) => i !== index) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        default_tasks: form.default_tasks,
        estimated_duration_minutes: form.estimated_duration_minutes ? Number(form.estimated_duration_minutes) : null,
        default_price: form.default_price ? Number(form.default_price) : null,
        color: form.color,
      }
      if (editing) {
        await supabase.from('job_type_templates').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('job_type_templates').insert({ ...payload, business_id: business.id })
      }
      setModalOpen(false)
      fetchTemplates()
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    await supabase.from('job_type_templates').update({ is_active: false }).eq('id', editing.id)
    setModalOpen(false)
    fetchTemplates()
  }

  async function addSuggested(jt) {
    if (templates.some(t => t.name.toLowerCase() === jt.name.toLowerCase())) return
    await supabase.from('job_type_templates').insert({
      business_id: business.id,
      name: jt.name,
      description: jt.description,
      default_tasks: jt.default_tasks,
      estimated_duration_minutes: jt.estimated_duration_minutes,
      color: jt.color,
    })
    fetchTemplates()
  }

  async function addAllSuggested() {
    const existing = templates.map(t => t.name.toLowerCase())
    const toAdd = SUGGESTED_JOB_TYPES.filter(j => !existing.includes(j.name.toLowerCase()))
    if (!toAdd.length) return
    await supabase.from('job_type_templates').insert(
      toAdd.map(j => ({
        business_id: business.id,
        name: j.name,
        description: j.description,
        default_tasks: j.default_tasks,
        estimated_duration_minutes: j.estimated_duration_minutes,
        color: j.color,
      }))
    )
    fetchTemplates()
    setShowSuggestions(false)
  }

  function formatDuration(mins) {
    if (!mins) return null
    if (mins < 60) return `${mins} min`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }

  if (loading) {
    return (
      <>
        <Header title="Job Types" backTo="/settings" />
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
        title="Job Types"
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
        {templates.length === 0 && !showSuggestions ? (
          <EmptyState
            icon={
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            }
            title="No job types yet"
            description="Create templates for different service types"
            action="Load Suggested Types"
            onAction={() => setShowSuggestions(true)}
          />
        ) : (
          <div className="space-y-5">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowSuggestions(!showSuggestions)} className="flex-1 text-xs">
                {showSuggestions ? 'Hide Suggestions' : 'Show Suggestions'}
              </Button>
              <Button onClick={openAdd} className="flex-1 text-xs">
                + Add Job Type
              </Button>
            </div>

            <div className="space-y-2">
              {templates.map(t => (
                <Card key={t.id} onClick={() => openEdit(t)}>
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: t.color || '#0EA5E9' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</p>
                      {t.description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t.description}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        {t.default_tasks?.length > 0 && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t.default_tasks.length} tasks</span>
                        )}
                        {t.estimated_duration_minutes && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{formatDuration(t.estimated_duration_minutes)}</span>
                        )}
                        {t.default_price && (
                          <span className="text-[11px] text-pool-600 dark:text-pool-400 font-medium">${Number(t.default_price).toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {showSuggestions && (
          <div className="mt-5 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Suggested Job Types</h3>
              <button onClick={addAllSuggested} className="text-xs text-pool-600 dark:text-pool-400 font-semibold min-h-tap flex items-center hover:text-pool-700">
                Add all
              </button>
            </div>
            <div className="space-y-2">
              {SUGGESTED_JOB_TYPES.map((jt, i) => {
                const alreadyAdded = templates.some(t => t.name.toLowerCase() === jt.name.toLowerCase())
                return (
                  <Card key={i} className={cn(alreadyAdded && 'opacity-50')}>
                    <div className="flex items-start gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: jt.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{jt.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{jt.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{jt.default_tasks.length} tasks</span>
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">{formatDuration(jt.estimated_duration_minutes)}</span>
                        </div>
                      </div>
                      {!alreadyAdded ? (
                        <button onClick={() => addSuggested(jt)} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-pool-50 dark:hover:bg-pool-950/40 transition-colors shrink-0">
                          <svg className="w-5 h-5 text-pool-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      ) : (
                        <div className="min-h-tap min-w-tap flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </PageWrapper>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Job Type' : 'New Job Type'}>
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Regular Maintenance"
            required
          />
          <TextArea
            label="Description"
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Brief description of this service type"
            rows={2}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (mins)"
              type="number"
              value={form.estimated_duration_minutes}
              onChange={e => setForm(prev => ({ ...prev, estimated_duration_minutes: e.target.value }))}
              placeholder="45"
            />
            <Input
              label="Default Price ($)"
              type="number"
              value={form.default_price}
              onChange={e => setForm(prev => ({ ...prev, default_price: e.target.value }))}
              placeholder="150"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color}
                onChange={e => setForm(prev => ({ ...prev, color: e.target.value }))}
                className="w-11 h-11 rounded-xl border-2 border-gray-200 dark:border-gray-700 cursor-pointer p-0.5"
              />
              <span className="text-sm text-gray-400 dark:text-gray-500 font-mono">{form.color}</span>
            </div>
          </div>

          {/* Tasks */}
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">Default Tasks</label>
            {form.default_tasks.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {form.default_tasks.map((task, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-5 shrink-0">{i + 1}.</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{task}</span>
                    <button type="button" onClick={() => removeTask(i)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                placeholder="Add a task..."
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }}
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={addTask} className="px-3 shrink-0">+</Button>
            </div>
          </div>

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
        title="Delete this job type?"
        description="This cannot be undone."
        destructive
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </>
  )
}
