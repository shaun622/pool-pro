import { useState, useRef } from 'react'
import Header from '../components/layout/Header'
import PageWrapper from '../components/layout/PageWrapper'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Input, { TextArea, Select } from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import StaffCard, { ROLE_LABELS } from '../components/ui/StaffCard'
import { useStaff } from '../hooks/useStaff'
import { useBusiness } from '../hooks/useBusiness'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

const ROLE_OPTIONS = [
  { value: 'tech', label: 'Technician' },
  { value: 'admin', label: 'Admin' },
]

const emptyForm = {
  name: '',
  role: 'tech',
  phone: '',
  email: '',
  password: '',
  bio: '',
}

export default function Staff() {
  const { business } = useBusiness()
  const { staff, loading, staffLimit, canAddStaff, createStaff, updateStaff, deleteStaff, uploadPhoto } = useStaff()

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef()

  function openAdd() {
    if (!canAddStaff) {
      alert(`Your ${business?.plan || 'trial'} plan allows up to ${staffLimit} staff member${staffLimit !== 1 ? 's' : ''}. Upgrade to add more.`)
      return
    }
    setEditing(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
    setShowModal(true)
  }

  function openEdit(member) {
    setEditing(member)
    setForm({
      name: member.name || '',
      role: member.role || 'tech',
      phone: member.phone || '',
      email: member.email || '',
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

  async function handleSave() {
    if (!form.name.trim()) return
    if (!editing && form.email && form.password && form.password.length < 6) {
      alert('Password must be at least 6 characters.')
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
      const payload = { ...staffFields, photo_url }

      if (editing) {
        await updateStaff(editing.id, payload)
      } else {
        // Create auth account if email + password provided
        let userId = null
        if (form.email && form.password) {
          const { data: authData, error: signupErr } = await supabase.auth.signUp({
            email: form.email,
            password: form.password,
            options: { data: { role: 'staff' } },
          })
          if (signupErr) throw signupErr
          // If identities exist, it's a new user; otherwise email was already registered (still OK)
          userId = authData.user?.identities?.length > 0 ? authData.user.id : null
        }
        await createStaff({
          ...payload,
          ...(userId ? { user_id: userId, invite_status: 'accepted' } : {}),
        })
      }
      setShowModal(false)
    } catch (err) {
      console.error('Error saving staff:', err)
      alert('Failed to save. Please try again.')
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
      alert('Failed to delete.')
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

  if (loading) {
    return (
      <>
        <Header title="Staff" backTo="/settings" />
        <PageWrapper>
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageWrapper>
      </>
    )
  }

  const activeStaff = staff.filter(s => s.is_active)
  const inactiveStaff = staff.filter(s => !s.is_active)

  return (
    <>
      <Header
        title="Staff"
        backTo="/settings"
        right={
          <button
            onClick={openAdd}
            className="text-pool-500 font-medium text-sm min-h-[44px] flex items-center px-2"
          >
            + Add
          </button>
        }
      />
      <PageWrapper>
        {/* Staff limit indicator */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {activeStaff.length} / {staffLimit} staff
          </p>
          <Badge variant={canAddStaff ? 'success' : 'warning'}>
            {business?.plan || 'trial'} plan
          </Badge>
        </div>

        {staff.length === 0 ? (
          <EmptyState
            title="No staff members"
            description="Add your team members so they appear on service reports and the client portal."
            actionLabel="Add Staff Member"
            onAction={openAdd}
          />
        ) : (
          <div className="space-y-3">
            {activeStaff.map(member => (
              <Card key={member.id} onClick={() => openEdit(member)} className="p-4">
                <StaffCard staff={member} variant="compact" />
              </Card>
            ))}

            {inactiveStaff.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-6 mb-2">
                  Inactive
                </h3>
                {inactiveStaff.map(member => (
                  <Card key={member.id} onClick={() => openEdit(member)} className="p-4 opacity-60">
                    <StaffCard staff={member} variant="compact" />
                  </Card>
                ))}
              </>
            )}
          </div>
        )}

        {/* Add/Edit Modal */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title={editing ? 'Edit Staff Member' : 'Add Staff Member'}
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
                  <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center ring-2 ring-gray-200">
                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                )}
                <span className="absolute bottom-0 right-0 w-7 h-7 bg-pool-500 rounded-full flex items-center justify-center text-white shadow">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <p className="text-xs text-gray-400">Tap to upload photo</p>
            </div>

            <Input
              label="Full Name"
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
            {!editing && form.email && (
              <Input
                label="Password (for their login)"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
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
              {editing ? 'Save Changes' : 'Add Staff Member'}
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
      </PageWrapper>
    </>
  )
}
