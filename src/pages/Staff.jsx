import { useState, useRef, useMemo } from 'react'
import { Plus, Shield, Wrench, CheckCircle2, Phone, Mail } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import AddSeatCard from '../components/ui/AddSeatCard'
import { useStaff } from '../hooks/useStaff'
import { useBusiness } from '../hooks/useBusiness'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useToast } from '../contexts/ToastContext'

const ROLE_OPTIONS = [
  { value: 'tech', label: 'Technician' },
  { value: 'admin', label: 'Admin' },
]

const ROLE_LABELS = {
  tech: 'Technician',
  technician: 'Technician',
  senior_tech: 'Senior Technician',
  admin: 'Admin',
  manager: 'Manager',
  owner: 'Owner',
}

const ADMIN_ROLES = new Set(['admin', 'manager', 'owner'])
const isAdminRole = (role) => ADMIN_ROLES.has((role || '').toLowerCase())

const emptyForm = {
  name: '',
  role: 'tech',
  phone: '',
  email: '',
  password: '',
  bio: '',
}

export default function Staff() {
  const toast = useToast()
  const { business, userRole } = useBusiness()
  const { user } = useAuth()
  const { staff, loading, staffLimit, canAddStaff, createStaff, updateStaff, deleteStaff, uploadPhoto } = useStaff()

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newDirectPassword, setNewDirectPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const fileRef = useRef()

  // The business owner lives in `businesses.owner_id`, NOT `staff_members`.
  // Synthesise a virtual row so they appear in the admin list. Only renders
  // when the current viewer is the owner (we have their email from auth).
  // We could later denormalise owner_email onto businesses to show this for
  // non-owner viewers too.
  const ownerVirtual = useMemo(() => {
    if (userRole !== 'owner' || !user || !business?.owner_id) return null
    return {
      id: `__owner__:${business.owner_id}`,
      name: user.email,
      role: 'owner',
      email: user.email,
      phone: null,
      photo_url: null,
      bio: null,
      is_active: true,
      user_id: business.owner_id, // drives the "Login" pill
      _virtual: true,
    }
  }, [userRole, user, business?.owner_id])

  // Group staff into admin / tech / inactive
  const { admins, technicians, inactive } = useMemo(() => {
    const admins = ownerVirtual ? [ownerVirtual] : []
    const technicians = []
    const inactive = []
    for (const m of staff) {
      // Skip any staff_members row that's actually the owner (in case one was
      // ever created with role='owner' or matching user_id) — owner is rendered
      // via ownerVirtual.
      if (ownerVirtual && m.user_id === business?.owner_id) continue
      if (!m.is_active) { inactive.push(m); continue }
      if (isAdminRole(m.role)) admins.push(m)
      else technicians.push(m)
    }
    return { admins, technicians, inactive }
  }, [staff, ownerVirtual, business?.owner_id])

  // Active count for the seat indicator — exclude the owner since they
  // don't consume a seat against the plan limit.
  const activeCount = admins.filter(m => !m._virtual).length + technicians.length

  // Whether there's anyone to render. Must count the synthetic owner row
  // (ownerVirtual lands in `admins`), NOT just the raw staff_members rows
  // in `staff`. Gating the page on `staff.length === 0` made the owner —
  // and the whole section — vanish the moment the last technician was
  // deleted, reappearing only once a new staff row existed again.
  const hasMembers = admins.length > 0 || technicians.length > 0 || inactive.length > 0

  function openAdd(roleHint = 'tech') {
    if (!canAddStaff) {
      toast.error(`Your ${business?.plan || 'trial'} plan allows up to ${staffLimit} staff member${staffLimit !== 1 ? 's' : ''}. Upgrade to add more.`)
      return
    }
    setEditing(null)
    setForm({ ...emptyForm, role: roleHint })
    setPhotoFile(null)
    setPhotoPreview(null)
    setShowModal(true)
  }

  function openEdit(member) {
    // Virtual owner row isn't editable — there's no staff_members record to update.
    if (member?._virtual) return
    setShowSetPassword(false)
    setNewDirectPassword('')
    setEditing(member)
    setForm({
      name: member.name || '',
      role: member.role || 'tech',
      phone: member.phone || '',
      email: member.email || '',
      password: '',
      bio: member.bio || '',
    })
    setPhotoFile(null)
    setPhotoPreview(member.photo_url || null)
    setShowModal(true)
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // Helper — creates a brand new auth account for the staff member.
  //
  // SECURITY: This function MUST refuse to link the new staff_members row
  // to an existing auth user. The previous behaviour fell back to
  // signInWithPassword on signup failure, which silently attached the
  // staff role to whatever account already had that email — including
  // customer portal accounts on other businesses. That was a serious
  // cross-tenant identity leak (a tech "login" would actually sign the
  // person in as someone's customer).
  //
  // Now: signUp only. If the email is already registered, throw a clear
  // error and let the admin pick a different email.
  async function createAuthForStaff(email, password) {
    const { createClient } = await import('@supabase/supabase-js')
    const authClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    )
    const { data: authData, error: signupErr } = await authClient.auth.signUp({
      email,
      password,
      options: { data: { role: 'staff' } },
    })
    if (signupErr) {
      // "User already registered", network error, etc — surface it.
      throw new Error(signupErr.message || 'Failed to create login. Try a different email.')
    }
    // Supabase quirk: when an email is already registered, signUp returns
    // success with a user object whose `identities` array is empty (the
    // "phantom signup" behaviour designed to not leak which emails are
    // registered). We treat that as "email already in use".
    if (!authData.user?.id || (authData.user.identities && authData.user.identities.length === 0)) {
      throw new Error(`That email is already in use. Choose a different email — never reuse a customer/portal email for staff logins.`)
    }
    return authData.user.id
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const needsAuthSetup = form.email && form.password && (!editing || !editing.user_id)
    if (needsAuthSetup && form.password.length < 6) {
      toast.error('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    try {
      let photo_url = editing?.photo_url || null
      if (photoFile) {
        photo_url = await uploadPhoto(photoFile)
      }

      // Strip password from the staff record payload
      const { password, ...staffFields } = form
      const payload = { ...staffFields, photo_url, is_active: true }

      if (editing) {
        // If we need to create an auth account for this existing staff, do it first.
        // If it fails (e.g. email already in use), STOP — don't update the staff
        // record. The admin needs to fix the email or drop the password field.
        let userIdUpdate = {}
        if (needsAuthSetup) {
          const userId = await createAuthForStaff(form.email, form.password)
          userIdUpdate = { user_id: userId, invite_status: 'accepted' }
        }
        await updateStaff(editing.id, { ...payload, ...userIdUpdate })
      } else {
        // Create auth account first, then staff record. If auth creation
        // fails, do NOT create the staff_members row at all — better to
        // surface the error and let the admin retry than leave a partial
        // half-broken record behind.
        let userId = null
        if (form.email && form.password) {
          userId = await createAuthForStaff(form.email, form.password)
        }
        await createStaff({
          ...payload,
          ...(userId ? { user_id: userId, invite_status: 'accepted' } : {}),
        })
      }
      setShowModal(false)
    } catch (err) {
      console.error('Error saving staff:', err)
      // Surface the actual error message — typically "email already in use"
      // or "password too weak" — so the admin can fix and retry.
      toast.error(err?.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing) return
    setDeleting(true)
    try {
      await deleteStaff(editing.id)
      setShowModal(false)
    } catch (err) {
      console.error('Error deleting staff:', err)
      toast.error('Failed to delete.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleActive(member) {
    try {
      await updateStaff(member.id, { is_active: !member.is_active })
    } catch (err) {
      console.error('Error toggling staff status:', err)
    }
  }

  async function handleSendPasswordReset() {
    if (!editing?.email) return
    setResetSending(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(editing.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      toast.success(`Reset link sent to ${editing.email}`)
    } catch (err) {
      console.error('Error sending password reset:', err)
      toast.error(err.message || 'Failed to send reset email.')
    } finally {
      setResetSending(false)
    }
  }

  async function handleSetPasswordDirectly() {
    if (!editing) return
    if (!newDirectPassword || newDirectPassword.length < 6) {
      toast.error('Password must be at least 6 characters.')
      return
    }
    setSettingPassword(true)
    try {
      const { data, error } = await supabase.functions.invoke('set-staff-password', {
        body: { staff_id: editing.id, new_password: newDirectPassword },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      // If a new auth user was created, refresh the staff record so the row
      // picks up the new user_id and the LOGIN pill appears.
      if (data?.action === 'created') {
        setEditing(prev => prev ? { ...prev, user_id: data.user_id } : prev)
      }
      toast.success(`Password ${data?.action === 'created' ? 'set' : 'updated'} for ${editing.name}`)
      setNewDirectPassword('')
      setShowSetPassword(false)
    } catch (err) {
      console.error('Error setting password directly:', err)
      toast.error(err.message || 'Failed to update password.')
    } finally {
      setSettingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Team & roles</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
            {activeCount} of {staffLimit} {staffLimit === 1 ? 'seat' : 'seats'} used
          </p>
        </div>
        <Badge variant={canAddStaff ? 'success' : 'warning'}>
          {business?.plan || 'trial'} plan
        </Badge>
      </div>

      {!hasMembers ? (
        <EmptyState
          title="No team members yet"
          description="Add admins so your business owners and managers can log in, or technicians for field workers using the tech app."
          actionLabel="Add team member"
          onAction={() => openAdd('tech')}
        />
      ) : (
        <div className="space-y-4">
          {/* ── ADMIN & STAFF ── */}
          <RoleSection
            icon={Shield}
            label="Admin & staff"
            description="People who log in to manage clients, jobs, and billing"
            members={admins}
            onAdd={() => openAdd('admin')}
            onEdit={openEdit}
            emptyText="No admins yet. Owners and managers go here."
            canAdd={canAddStaff}
          />

          {/* ── TECHNICIANS ── */}
          <RoleSection
            icon={Wrench}
            label="Technicians"
            description="Field workers using the mobile tech app for service stops"
            members={technicians}
            onAdd={() => openAdd('tech')}
            onEdit={openEdit}
            emptyText="No technicians yet. Add the people who service pools in the field."
            canAdd={canAddStaff}
          />

          {/* Seat upsell — same card as the Subscription page so the
              operator can buy a seat from wherever they noticed the
              limit. Self-hides for trial / staff-override accounts. */}
          <AddSeatCard />

          {/* ── INACTIVE ── */}
          {inactive.length > 0 && (
            <Card className="!p-0 overflow-hidden opacity-90">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400 inline-flex items-center gap-2">
                  Inactive
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-bold tabular-nums text-gray-600 dark:text-gray-400">
                    {inactive.length}
                  </span>
                </p>
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {inactive.map(member => (
                  <li key={member.id}>
                    <MemberRow member={member} onClick={() => openEdit(member)} dimmed />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={
          editing
            ? 'Edit team member'
            : isAdminRole(form.role) ? 'Add admin' : 'Add technician'
        }
      >
        <div className="space-y-4">
          {/* Photo upload */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative group"
            >
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Staff photo"
                  className="w-24 h-24 rounded-full object-cover ring-2 ring-gray-200"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center ring-2 ring-gray-200">
                  <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              )}
              <span className="absolute bottom-0 right-0 w-7 h-7 bg-pool-500 rounded-full flex items-center justify-center text-white shadow">
                <Plus className="w-4 h-4" strokeWidth={2.5} />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoSelect}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500">Tap to upload photo</p>
          </div>

          <Input
            label="Full name"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="e.g. Matt Wilson"
          />
          <Select
            label="Role"
            name="role"
            value={form.role}
            onChange={handleChange}
            options={ROLE_OPTIONS}
          />
          <Input
            label="Phone"
            name="phone"
            type="tel"
            value={form.phone}
            onChange={handleChange}
            placeholder="0400 000 000"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="matt@example.com"
          />
          {form.email && (!editing || !editing.user_id) && (
            <div className="space-y-1">
              <Input
                label={editing ? 'Set password (creates their login)' : 'Password (for their login)'}
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
              {editing && !editing.user_id && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  This member doesn't have a login yet. Set a password so they can sign in with their email.
                </p>
              )}
            </div>
          )}
          {editing && editing.user_id && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={2.25} />
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium truncate">
                    Login active — they sign in with this email
                  </span>
                </div>
                {!showSetPassword && (
                  <button
                    type="button"
                    onClick={() => setShowSetPassword(true)}
                    className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors shrink-0"
                  >
                    Set new password
                  </button>
                )}
              </div>

              {showSetPassword && (
                <div className="pt-1 space-y-2">
                  <Input
                    label="New password for this user"
                    type="password"
                    value={newDirectPassword}
                    onChange={e => setNewDirectPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowSetPassword(false); setNewDirectPassword('') }}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-900 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSetPasswordDirectly}
                      disabled={settingPassword || newDirectPassword.length < 6}
                      className="h-8 px-3 rounded-lg bg-emerald-500 text-white text-[11px] font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {settingPassword ? 'Updating…' : 'Update password'}
                    </button>
                    <span className="ml-auto text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
                      Tell them the new password
                    </span>
                  </div>
                </div>
              )}

              {editing.email && !showSetPassword && (
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-emerald-200/40 dark:border-emerald-800/30">
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 pt-1.5">
                    Or send them a reset link by email
                  </p>
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={resetSending}
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 underline decoration-dotted underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {resetSending ? 'Sending…' : 'Send reset email'}
                  </button>
                </div>
              )}
            </div>
          )}
          <TextArea
            label="Bio"
            name="bio"
            value={form.bio}
            onChange={handleChange}
            placeholder="Brief intro shown to customers..."
            rows={3}
          />

          <Button onClick={handleSave} loading={saving} className="w-full min-h-tap">
            {editing ? 'Save changes' : 'Add team member'}
          </Button>

          {editing && (
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => handleToggleActive(editing)}
                className="flex-1 min-h-tap"
              >
                {editing.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                loading={deleting}
                className="flex-1 min-h-tap"
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

// ─── Section card for a role group ─────────────────
function RoleSection({ icon: Icon, label, description, members, onAdd, onEdit, emptyText, canAdd }) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pool-600 dark:text-pool-400 inline-flex items-center gap-2">
            <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
            {label}
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-pool-50 dark:bg-pool-950/40 text-[10px] font-bold tabular-nums text-pool-700 dark:text-pool-300">
              {members.length}
            </span>
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
        <button
          onClick={onAdd}
          disabled={!canAdd}
          className={cn(
            'inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold transition-colors shrink-0',
            canAdd
              ? 'bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 hover:bg-pool-100 dark:hover:bg-pool-950/60'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed',
          )}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          Add
        </button>
      </div>
      {members.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 dark:text-gray-600 italic">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {members.map(member => (
            <li key={member.id}>
              <MemberRow member={member} onClick={() => onEdit(member)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ─── A single member row ─────────────────
function MemberRow({ member, onClick, dimmed }) {
  const isOwner = member._virtual || member.role === 'owner'
  const roleLabel = isOwner ? 'Account owner' : (ROLE_LABELS[member.role] || member.role)
  const initials = (member.name || '?')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hasLogin = !!member.user_id

  // Virtual owner is read-only (rendered as a div, no hover affordance, no
  // click handler). Other rows are clickable buttons.
  const Tag = member._virtual ? 'div' : 'button'

  return (
    <Tag
      onClick={member._virtual ? undefined : onClick}
      className={cn(
        'w-full text-left px-4 py-3 flex items-center gap-3 transition-colors',
        member._virtual
          ? 'cursor-default'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
        dimmed && 'opacity-60',
      )}
    >
      {/* Avatar */}
      {member.photo_url ? (
        <img
          src={member.photo_url}
          alt={member.name}
          className="w-10 h-10 rounded-full object-cover ring-1 ring-white dark:ring-gray-900 shrink-0"
        />
      ) : (
        <span className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ring-1 ring-white dark:ring-gray-900 shrink-0',
          isOwner
            ? 'bg-gradient-brand text-white'
            : 'bg-pool-100 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300',
        )}>
          {initials}
        </span>
      )}

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{member.name}</p>
          {isOwner && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-pool-50 dark:bg-pool-950/40 text-pool-700 dark:text-pool-300 text-[9.5px] font-semibold uppercase tracking-wider ring-1 ring-pool-200/70 dark:ring-pool-800/50 shrink-0">
              Owner
            </span>
          )}
          {hasLogin && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[9.5px] font-semibold uppercase tracking-wider ring-1 ring-emerald-200/60 dark:ring-emerald-800/40 shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2.5} />
              Login
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 truncate">
          {roleLabel}
          {!isOwner && member.email && ` · ${member.email}`}
        </p>
      </div>

      {/* Quick contact chips — hidden for the virtual owner since their email
          is already shown as the primary identifier */}
      {!member._virtual && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {member.phone && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <Phone className="w-3.5 h-3.5" strokeWidth={2} />
            </span>
          )}
          {member.email && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <Mail className="w-3.5 h-3.5" strokeWidth={2} />
            </span>
          )}
        </div>
      )}
    </Tag>
  )
}

