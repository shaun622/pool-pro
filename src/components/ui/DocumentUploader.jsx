import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import Button from './Button'
import Card from './Card'
import Badge from './Badge'
import { cn, formatDate } from '../../lib/utils'

const CATEGORY_LABELS = {
  certificate: 'Certificate',
  compliance: 'Compliance',
  photo: 'Photo',
  contract: 'Contract',
  report: 'Report',
  other: 'Other',
}

const CATEGORY_COLORS = {
  certificate: 'success',
  compliance: 'warning',
  photo: 'primary',
  contract: 'mineral',
  report: 'freshwater',
  other: 'default',
}

const FILE_ICONS = {
  pdf: '📄',
  doc: '📝', docx: '📝',
  xls: '📊', xlsx: '📊',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
  default: '📎',
}

export default function DocumentUploader({ clientId, poolId, jobId, documents = [], onUpdate }) {
  const { business } = useBusiness()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !business?.id) return

    setUploading(true)
    try {
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
        const path = `${business.id}/${Date.now()}-${file.name}`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(path, file, { contentType: file.type })
        if (uploadError) throw uploadError

        await supabase.from('documents').insert({
          business_id: business.id,
          client_id: clientId || null,
          pool_id: poolId || null,
          job_id: jobId || null,
          name: file.name,
          file_type: ext,
          file_size: file.size,
          storage_path: path,
          category: getCategory(ext),
        })
      }
      onUpdate?.()
    } catch (err) {
      console.error('Upload error:', err)
      alert('Failed to upload: ' + (err.message || 'Unknown error'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function getCategory(ext) {
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'photo'
    if (['pdf'].includes(ext)) return 'report'
    if (['doc', 'docx'].includes(ext)) return 'contract'
    return 'other'
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete ${doc.name}?`)) return
    try {
      await supabase.storage.from('documents').remove([doc.storage_path])
      await supabase.from('documents').delete().eq('id', doc.id)
      onUpdate?.()
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  function getFileUrl(path) {
    const { data } = supabase.storage.from('documents').getPublicUrl(path)
    return data?.publicUrl
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const icon = (ext) => FILE_ICONS[ext] || FILE_ICONS.default

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</h4>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-xs text-pool-600 font-semibold hover:text-pool-700 min-h-tap flex items-center"
        >
          {uploading ? 'Uploading...' : '+ Upload'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        onChange={handleUpload}
        className="hidden"
      />

      {documents.length === 0 ? (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-gray-200 rounded-2xl hover:border-pool-400 hover:bg-pool-50/30 transition-all cursor-pointer"
        >
          {uploading ? (
            <div className="w-6 h-6 border-2 border-pool-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-sm text-gray-400">Tap to upload documents</span>
            </>
          )}
        </button>
      ) : (
        <div className="space-y-1.5">
          {documents.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
              <span className="text-lg shrink-0">{icon(doc.file_type)}</span>
              <div className="flex-1 min-w-0">
                <a
                  href={getFileUrl(doc.storage_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 truncate block hover:text-pool-600"
                >
                  {doc.name}
                </a>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={CATEGORY_COLORS[doc.category] || 'default'} className="text-[10px]">
                    {CATEGORY_LABELS[doc.category] || 'Other'}
                  </Badge>
                  <span className="text-[10px] text-gray-400">{formatSize(doc.file_size)}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(doc)}
                className="text-gray-300 hover:text-red-500 shrink-0 min-h-tap min-w-tap flex items-center justify-center"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
