import { useState, useRef } from 'react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { useBusiness } from '../../hooks/useBusiness'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import CustomSelect from '../../components/ui/CustomSelect'

const IMPORT_TYPES = [
  { value: 'clients', label: 'Clients', columns: ['name', 'email', 'phone', 'address'], required: ['name'] },
  { value: 'pools', label: 'Pools', columns: ['client_name', 'address', 'type', 'volume_litres', 'schedule_frequency'], required: ['client_name', 'address'] },
]

// RFC-4180-ish CSV parser: a character state machine that correctly handles
// quoted fields with embedded commas, escaped quotes ("") and embedded newlines
// — the previous regex/split approach mangled all three (e.g. a name like
// 'John ""JB"" Doe' or an address with a comma).
function parseCSV(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n')
  const rows = []
  let field = '', row = [], inQuotes = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i++ } // escaped quote -> literal "
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); rows.push(row); field = ''; row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Drop blank rows (all-empty fields).
  const clean = rows.filter(r => r.some(c => c.trim() !== ''))
  if (clean.length < 2) return { headers: [], rows: [] }
  return {
    headers: clean[0].map(h => h.trim()),
    rows: clean.slice(1).map(r => r.map(v => v.trim())),
  }
}

// Normalisers for duplicate detection — mirror the live check in NewClientModal
// (email compared case-insensitively, phone compared digits-only).
const normEmail = (s) => (s || '').trim().toLowerCase()
const normPhone = (s) => (s || '').replace(/\D/g, '')
const normName = (s) => (s || '').trim().toLowerCase()

export default function ImportData() {
  const { business } = useBusiness()
  const fileRef = useRef(null)
  const [importType, setImportType] = useState('clients')
  const [parsed, setParsed] = useState(null)
  const [columnMap, setColumnMap] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const typeDef = IMPORT_TYPES.find(t => t.value === importType)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result)
      setParsed({ headers, rows, fileName: file.name })
      // Auto-map columns by name match
      const autoMap = {}
      for (const col of typeDef.columns) {
        const match = headers.findIndex(h => h.toLowerCase().replace(/[_\s]/g, '') === col.replace(/[_\s]/g, ''))
        if (match >= 0) autoMap[col] = match
      }
      setColumnMap(autoMap)
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleImport() {
    if (!parsed || !business?.id) return
    setImporting(true)
    setResult(null)

    // NOTE: supabase-js v2 does NOT throw on a DB error — it resolves with an
    // { error } object. So we branch on `error` explicitly; the old try/catch
    // never fired, which meant failed rows were silently counted as imported.
    let imported = 0, skipped = 0, duplicates = 0, errors = []

    try {
      if (importType === 'clients') {
        // Pull existing customers once so we can skip duplicates — there is no DB
        // unique constraint on email/phone, so dedupe is enforced here.
        const { data: existing } = await supabase
          .from('clients').select('name, email, phone').eq('business_id', business.id)
        const seenEmails = new Set()
        const seenPhones = new Set()
        const seenNames = new Set()
        for (const c of (existing || [])) {
          if (c.email) seenEmails.add(normEmail(c.email))
          if (c.phone) seenPhones.add(normPhone(c.phone))
          if (!c.email && !c.phone && c.name) seenNames.add(normName(c.name))
        }

        for (let i = 0; i < parsed.rows.length; i++) {
          const row = parsed.rows[i]
          const name = (row[columnMap.name] || '').trim()
          if (!name) { skipped++; continue }
          const email = row[columnMap.email] || null
          const phone = row[columnMap.phone] || null
          const e = normEmail(email), p = normPhone(phone), n = normName(name)

          // Duplicate of an existing customer OR of a row already imported from
          // this same file. Fall back to name only when there's no email/phone.
          const isDup = (e && seenEmails.has(e)) || (p && seenPhones.has(p)) || (!e && !p && seenNames.has(n))
          if (isDup) { duplicates++; continue }

          const { error } = await supabase.from('clients').insert({
            business_id: business.id,
            name,
            email,
            phone,
            address: row[columnMap.address] || null,
          })
          if (error) {
            if (error.code === '23505') duplicates++
            else errors.push(`Row ${i + 2}: ${error.message}`) // +2: header row + 1-based
          } else {
            imported++
            if (e) seenEmails.add(e)
            if (p) seenPhones.add(p)
            if (!e && !p) seenNames.add(n)
          }
        }
      } else if (importType === 'pools') {
        // Need to look up client by name first
        const { data: existingClients } = await supabase.from('clients').select('id, name').eq('business_id', business.id)
        // Map client name -> id, but track names shared by MORE THAN ONE client so
        // we never silently assign a pool to the wrong same-named client.
        const clientMap = {}
        const ambiguous = new Set()
        for (const c of (existingClients || [])) {
          const key = (c.name || '').toLowerCase()
          if (clientMap[key] !== undefined) ambiguous.add(key)
          else clientMap[key] = c.id
        }

        for (const row of parsed.rows) {
          const clientName = row[columnMap.client_name]
          const address = row[columnMap.address]
          if (!clientName || !address) { skipped++; continue }
          const key = clientName.toLowerCase()
          if (ambiguous.has(key)) { errors.push(`Client "${clientName}" is ambiguous — more than one client has this name; assign this pool manually`); continue }
          const clientId = clientMap[key]
          if (!clientId) { errors.push(`Client "${clientName}" not found`); continue }
          const { error } = await supabase.from('pools').insert({
            business_id: business.id,
            client_id: clientId,
            address,
            // type is NOT NULL — default to 'chlorine' (matches emptyPool) so a
            // blank column can't silently fail the insert.
            type: row[columnMap.type] || 'chlorine',
            volume_litres: row[columnMap.volume_litres] ? Number(row[columnMap.volume_litres]) : null,
            schedule_frequency: row[columnMap.schedule_frequency] || 'weekly',
          })
          if (error) errors.push(`"${address}": ${error.message}`)
          else imported++
        }
      }
    } catch (err) {
      errors.push(err.message)
    }

    setResult({ imported, skipped, duplicates, errors })
    setImporting(false)
  }

  function downloadTemplate() {
    const csv = typeDef.columns.join(',') + '\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${importType}-template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="space-y-5">
          {/* Type selector */}
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            {IMPORT_TYPES.map(t => (
              <button
                key={t.value}
                className={cn('flex-1 py-2.5 text-sm font-semibold text-center rounded-lg min-h-tap transition-all',
                  importType === t.value ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-card' : 'text-gray-500 dark:text-gray-400')}
                onClick={() => { setImportType(t.value); setParsed(null); setResult(null) }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Upload area */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Upload CSV File</h3>
              <button onClick={downloadTemplate} className="text-xs font-semibold text-pool-600 dark:text-pool-400 hover:text-pool-700">
                Download template
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Expected columns: {typeDef.columns.map(c => (
                <span key={c} className={cn('font-semibold uppercase tracking-wider text-[11px]', typeDef.required.includes(c) && 'font-bold text-gray-600 dark:text-gray-400')}>
                  {c}{typeDef.required.includes(c) ? '*' : ''}{', '}
                </span>
              ))}
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl hover:border-pool-400 hover:bg-pool-50/30 transition-all cursor-pointer"
            >
              <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {parsed ? parsed.fileName : 'Choose CSV file...'}
              </span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
          </Card>

          {/* Preview */}
          {parsed && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Preview</h3>
                <Badge variant="primary">{parsed.rows.length} rows</Badge>
              </div>

              {/* Column mapping */}
              <div className="space-y-2 mb-4">
                {typeDef.columns.map(col => (
                  <div key={col} className="flex items-center gap-3">
                    <span className={cn('text-xs w-28 shrink-0', typeDef.required.includes(col) ? 'font-bold text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400')}>
                      {col}{typeDef.required.includes(col) ? ' *' : ''}
                    </span>
                    <CustomSelect
                      inline
                      value={columnMap[col] ?? ''}
                      onChange={e => setColumnMap(prev => ({ ...prev, [col]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                      placeholder="— skip —"
                      options={[{ value: '', label: '— skip —' }, ...parsed.headers.map((h, i) => ({ value: i, label: h }))]}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>

              {/* Data preview */}
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800">
                      {parsed.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400 border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1.5 text-gray-700 dark:text-gray-300 truncate max-w-[120px]">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 5 && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">...and {parsed.rows.length - 5} more rows</p>
                )}
              </div>

              <Button
                onClick={handleImport}
                loading={importing}
                className="w-full mt-4"
                disabled={!typeDef.required.every(r => columnMap[r] != null)}
              >
                Import {parsed.rows.length} {importType}
              </Button>
            </Card>
          )}

          {/* Results */}
          {result && (
            <Card className={cn(result.errors.length > 0 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-green-400')}>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">Import Complete</h3>
              <div className="flex gap-4 text-sm">
                <div><span className="font-bold text-green-600 dark:text-green-400">{result.imported}</span> imported</div>
                <div><span className="font-bold text-gray-400 dark:text-gray-500">{result.skipped}</span> skipped</div>
                {result.duplicates > 0 && (
                  <div><span className="font-bold text-amber-500">{result.duplicates}</span> already existed</div>
                )}
                {result.errors.length > 0 && (
                  <div><span className="font-bold text-red-500">{result.errors.length}</span> errors</div>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  {result.errors.slice(0, 10).map((err, i) => (
                    <p key={i} className="text-[11px] text-red-500">{err}</p>
                  ))}
                </div>
              )}
            </Card>
          )}
      </div>
    </div>
  )
}
