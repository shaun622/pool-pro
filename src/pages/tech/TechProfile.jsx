import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useAuth } from '../../hooks/useAuth'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'

export default function TechProfile() {
  const { user, signOut } = useAuth()
  const { staffRecord, refetch } = useBusiness()
  const navigate = useNavigate()
  const fileRef = useRef()

  const [name, setName] = useState(staffRecord?.name || '')
  const [phone, setPhone] = useState(staffRecord?.phone || '')
  const [photoPreview, setPhotoPreview] = useState(staffRecord?.photo_url || null)
  const [saving, setSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
    // Upload immediately
    uploadPhoto(file)
  }

  async function uploadPhoto(file) {
    try {
      const ext = file.name.split('.').pop()
      const path = `${staffRecord.business_id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('staff-photos').upload(path, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('staff-photos').getPublicUrl(path)
      await supabase.from('staff_members').update({ photo_url: urlData.publicUrl }).eq('id', staffRecord.id)
      refetch()
    } catch (err) {
      console.error('Photo upload error:', err)
    }
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await supabase.from('staff_members').update({
        name: name.trim(),
        phone: phone.trim() || null,
      }).eq('id', staffRecord.id)
      await refetch()
    } catch (err) {
      console.error('Error updating profile:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    if (!newPassword || newPassword.length < 6) {
      setPwMessage('Password must be at least 6 characters.')
      return
    }
    setPwSaving(true)
    setPwMessage('')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwMessage('Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
    } catch (err) {
      setPwMessage(err.message || 'Failed to update password.')
    } finally {
      setPwSaving(false)
    }
  }

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const initials = (staffRecord?.name || '??').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="max-w-lg mx-auto px-4 pb-8">
      {/* Back button */}
      <button onClick={() => navigate('/tech')} className="flex items-center gap-1 py-3 text-sm text-pool-600 font-semibold">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Back to Run Sheet
      </button>

      <h1 className="text-xl font-bold text-gray-900 mb-6">My Profile</h1>

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3 mb-6">
        <button type="button" onClick={() => fileRef.current?.click()} className="relative group">
          {photoPreview ? (
            <img src={photoPreview} alt="Profile" className="w-24 h-24 rounded-full object-cover ring-2 ring-gray-200" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-pool-100 text-pool-700 flex items-center justify-center text-xl font-bold ring-2 ring-gray-200">
              {initials}
            </div>
          )}
          <span className="absolute bottom-0 right-0 w-7 h-7 bg-pool-500 rounded-full flex items-center justify-center text-white shadow">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
      </div>

      {/* Profile fields */}
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 space-y-4 mb-4">
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Email" value={user?.email || staffRecord?.email || ''} disabled className="opacity-60" />
        <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0400 000 000" />
        <Button onClick={handleSave} loading={saving} className="w-full min-h-tap">Save Changes</Button>
      </div>

      {/* Password */}
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Change Password</h2>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <Input label="New Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
          {pwMessage && (
            <p className={cn('text-xs font-medium', pwMessage.includes('success') ? 'text-green-600' : 'text-red-600')}>{pwMessage}</p>
          )}
          <Button type="submit" variant="secondary" loading={pwSaving} className="w-full min-h-tap">Update Password</Button>
        </form>
      </div>

      {/* Logout */}
      <button onClick={handleLogout} className="w-full py-3 rounded-xl bg-white border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 active:scale-[0.98] transition-all min-h-tap mb-4">
        Log Out
      </button>

      <p className="text-center text-xs text-gray-300">PoolPro v1.0</p>
    </div>
  )
}

function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}
