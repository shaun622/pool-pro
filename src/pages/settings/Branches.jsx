import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useBranches } from '../../hooks/useBranches'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'

/**
 * Settings → Branches. A branch is a lightweight grouping (name + email): it
 * gives you a filter/"calendar" on the schedule and an email that receives the
 * office copy of service reports for clients assigned to it. Renders inside the
 * Settings pane <Outlet />, so no PageWrapper/Header here.
 */
export default function Branches() {
  const { branches, loading, createBranch, updateBranch, deleteBranch } = useBranches()
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '' })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Branch name is required.'); return }
    setError(''); setBusy(true)
    try {
      await createBranch({ name: form.name.trim(), email: form.email.trim() || null })
      setForm({ name: '', email: '' }); setAdding(false)
    } catch (err) { setError(err.message || 'Could not add branch.') }
    finally { setBusy(false) }
  }

  function startEdit(b) { setError(''); setEditingId(b.id); setEditForm({ name: b.name || '', email: b.email || '' }) }

  async function saveEdit(id) {
    if (!editForm.name.trim()) { setError('Branch name is required.'); return }
    setError(''); setBusy(true)
    try {
      await updateBranch(id, { name: editForm.name.trim(), email: editForm.email.trim() || null })
      setEditingId(null)
    } catch (err) { setError(err.message || 'Could not save branch.') }
    finally { setBusy(false) }
  }

  async function remove(b) {
    if (!window.confirm(`Delete branch "${b.name}"? Clients assigned to it will revert to "No branch".`)) return
    setError(''); setBusy(true)
    try { await deleteBranch(b.id) } catch (err) { setError(err.message || 'Could not delete branch.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="text-sm text-gray-500 dark:text-gray-400 italic">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Branches</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          A branch is a calendar you can filter the schedule by, with its own email that receives the office
          copy of service reports. Assign a client to a branch from the client’s page.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {branches.length === 0 && !adding ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">No branches yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          {branches.map(b => (
            <li key={b.id} className="px-4 py-3">
              {editingId === b.id ? (
                <div className="space-y-3">
                  <Input label="Branch name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                  <Input label="Branch email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="branch@example.com" />
                  <div className="flex gap-2">
                    <Button onClick={() => saveEdit(b.id)} loading={busy}>Save</Button>
                    <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{b.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{b.email || 'No email set'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(b)} title="Edit" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                      <Pencil className="w-4 h-4" strokeWidth={2} />
                    </button>
                    <button onClick={() => remove(b)} title="Delete" className="w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
                      <Trash2 className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={handleAdd} className="space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <Input label="Branch name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. North Shore" autoFocus required />
          <Input label="Branch email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="branch@example.com" />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>Add branch</Button>
            <Button type="button" variant="secondary" onClick={() => { setAdding(false); setForm({ name: '', email: '' }); setError('') }} disabled={busy}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button leftIcon={Plus} onClick={() => setAdding(true)}>Add branch</Button>
      )}
    </div>
  )
}
