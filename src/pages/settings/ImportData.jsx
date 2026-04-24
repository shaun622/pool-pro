import { useState, useRef } from 'react'
import Header from '../../components/layout/Header'
import PageWrapper from '../../components/layout/PageWrapper'
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

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''))
  const rows = lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || []
    return values.map(v => v.trim().replace(/^"/, '').replace(/"$/, ''))
  })
  return { headers, rows }
}

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

    let imported = 0, skipped = 0, errors = []

    try {
      if (importType === 'clients') {
        for (const row of parsed.rows) {
          const name = row[columnMap.name]
          if (!name) { skipped++; continue }
          try {
            await supabase.from('clients').insert({
              business_id: business.id,
              name,
              email: row[columnMap.email] || null,
              phone: row[columnMap.phone] || null,
              address: row[columnMap.address] || null,
            })
            imported++
          } catch (err) {
            if (err.code === '23505') skipped++ // duplicate
            else { errors.push(`Row ${imported + skipped + errors.length + 1}: ${err.message}`); }
          }
        }
      } else if (importType === 'pools') {
        // Need to look up client by name first
        const { data: existingClients } = await supabase.from('clients').select('id, name').eq('business_id', business.id)
        const clientMap = {}
        for (const c of (existingClients || [])) clientMap[c.name.toLowerCase()] = c.id

        for (const row of parsed.rows) {
          const clientName = row[columnMap.client_name]
          const address = row[columnMap.address]
          if (!clientName || !address) { skipped++; continue }
          const clientId = clientMap[clientName.toLowerCase()]
          if (!clientId) { errors.push(`Client "${clientName}" not found`); continue }
          try {
            await supabase.from('pools').insert({
              business_id: business.id,
              client_id: clientId,
              address,
              type: row[columnMap.type] || null,
              volume_litres: row[columnMap.volume_litres] ? Number(row[columnMap.volume_litres]) : null,
              schedule_frequency: row[columnMap.schedule_frequency] || 'weekly',
            })
            imported++
          } catch (err) {
            errors.push(`"${address}": ${err.message}`)
          }
        }
      }
    } catch (err) {
      errors.push(err.message)
    }

    setResult({ imported, skipped, errors })
    setImporting(false)
  }

  return (
    <>
      <Header title="Import Data" backTo="/settings" />
      <PageWrapper>
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
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">Upload CSV File</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              Expected columns: {typeDef.columns.map(c => (
                <span key={c} className={cn('font-mono', typeDef.required.includes(c) && 'font-bold text-gray-600 dark:text-gray-400')}>
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
      </PageWrapper>
    </>
  )
}
