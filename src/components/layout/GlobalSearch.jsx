import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, MapPin, User, ClipboardList, FileText, Receipt, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useBusiness } from '../../hooks/useBusiness'
import { cn } from '../../lib/utils'

/**
 * Global search — searches across pools, clients, jobs, quotes, invoices.
 * Triggered via ⌘K / Ctrl+K.
 *
 * Each category capped at 5 results. Click → navigate to entity detail page.
 */
export default function GlobalSearch({ className }) {
  const { business } = useBusiness()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const debounceRef = useRef(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ pools: [], clients: [], jobs: [], quotes: [], invoices: [] })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // ⌘K / Ctrl+K to focus
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Outside click closes dropdown
  useEffect(() => {
    function onClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Run search (debounced)
  const runSearch = useCallback(async (q) => {
    if (!business?.id || !q || q.length < 2) {
      setResults({ pools: [], clients: [], jobs: [], quotes: [], invoices: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    const term = `%${q}%`

    try {
      const [poolsRes, clientsRes, jobsRes, quotesRes, invoicesRes] = await Promise.all([
        supabase
          .from('pools')
          .select('id, address, clients(name)')
          .eq('business_id', business.id)
          .ilike('address', term)
          .limit(5),
        supabase
          .from('clients')
          .select('id, name, email, phone, address')
          .eq('business_id', business.id)
          .or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term},address.ilike.${term}`)
          .limit(5),
        supabase
          .from('jobs')
          .select('id, title, status, scheduled_date, clients(name)')
          .eq('business_id', business.id)
          .ilike('title', term)
          .limit(5),
        supabase
          .from('quotes')
          .select('id, title, status, clients(name)')
          .eq('business_id', business.id)
          .or(`title.ilike.${term}`)
          .limit(5),
        supabase
          .from('invoices')
          .select('id, invoice_number, status, total, clients(name)')
          .eq('business_id', business.id)
          .ilike('invoice_number', term)
          .limit(5),
      ])

      setResults({
        pools: poolsRes.data || [],
        clients: clientsRes.data || [],
        jobs: jobsRes.data || [],
        quotes: quotesRes.data || [],
        invoices: invoicesRes.data || [],
      })
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setLoading(false)
    }
  }, [business?.id])

  function handleChange(e) {
    const v = e.target.value
    setQuery(v)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(v), 250)
  }

  function handleSelect(href) {
    setOpen(false)
    setQuery('')
    setResults({ pools: [], clients: [], jobs: [], quotes: [], invoices: [] })
    inputRef.current?.blur()
    navigate(href)
  }

  const totalResults = results.pools.length + results.clients.length + results.jobs.length + results.quotes.length + results.invoices.length
  const hasQuery = query.trim().length >= 2
  const showDropdown = open && hasQuery

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none"
        strokeWidth={2}
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={handleChange}
        onFocus={() => query.length >= 2 && setOpen(true)}
        placeholder="Search pools, clients, addresses..."
        className="w-full h-10 pl-9 pr-14 rounded-xl bg-gray-100/80 dark:bg-gray-800/80 border border-transparent text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:bg-white dark:focus:bg-gray-900 focus:border-pool-400 focus:ring-2 focus:ring-pool-500/20 transition-all"
        style={{ fontSize: '14px' }}
        autoComplete="off"
        spellCheck={false}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[10px] font-medium text-gray-400 dark:text-gray-500 pointer-events-none">
        ⌘K
      </kbd>

      {/* Results dropdown */}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-elevated border border-gray-100 dark:border-gray-800 max-h-[70vh] overflow-y-auto animate-scale-in">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400 dark:text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching...
            </div>
          ) : totalResults === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
              No results for <span className="font-semibold">"{query}"</span>
            </div>
          ) : (
            <div className="py-2">
              {results.pools.length > 0 && (
                <Group label="Pools" count={results.pools.length}>
                  {results.pools.map(p => (
                    <Row
                      key={p.id}
                      Icon={MapPin}
                      iconColor="text-pool-600 dark:text-pool-400"
                      iconBg="bg-pool-50 dark:bg-pool-950/40"
                      title={p.address || 'Pool'}
                      subtitle={p.clients?.name}
                      onClick={() => handleSelect(`/pools/${p.id}`)}
                    />
                  ))}
                </Group>
              )}

              {results.clients.length > 0 && (
                <Group label="Clients" count={results.clients.length}>
                  {results.clients.map(c => (
                    <Row
                      key={c.id}
                      Icon={User}
                      iconColor="text-violet-600 dark:text-violet-400"
                      iconBg="bg-violet-50 dark:bg-violet-950/40"
                      title={c.name}
                      subtitle={c.email || c.phone || c.address}
                      onClick={() => handleSelect(`/clients/${c.id}`)}
                    />
                  ))}
                </Group>
              )}

              {results.jobs.length > 0 && (
                <Group label="Work Orders" count={results.jobs.length}>
                  {results.jobs.map(j => (
                    <Row
                      key={j.id}
                      Icon={ClipboardList}
                      iconColor="text-emerald-600 dark:text-emerald-400"
                      iconBg="bg-emerald-50 dark:bg-emerald-950/40"
                      title={j.title || 'Work Order'}
                      subtitle={[j.clients?.name, j.status].filter(Boolean).join(' · ')}
                      onClick={() => handleSelect(`/work-orders/${j.id}`)}
                    />
                  ))}
                </Group>
              )}

              {results.quotes.length > 0 && (
                <Group label="Quotes" count={results.quotes.length}>
                  {results.quotes.map(q => (
                    <Row
                      key={q.id}
                      Icon={FileText}
                      iconColor="text-amber-600 dark:text-amber-400"
                      iconBg="bg-amber-50 dark:bg-amber-950/40"
                      title={q.title || 'Quote'}
                      subtitle={[q.clients?.name, q.status].filter(Boolean).join(' · ')}
                      onClick={() => handleSelect(`/quotes/${q.id}`)}
                    />
                  ))}
                </Group>
              )}

              {results.invoices.length > 0 && (
                <Group label="Invoices" count={results.invoices.length}>
                  {results.invoices.map(inv => (
                    <Row
                      key={inv.id}
                      Icon={Receipt}
                      iconColor="text-blue-600 dark:text-blue-400"
                      iconBg="bg-blue-50 dark:bg-blue-950/40"
                      title={inv.invoice_number || 'Invoice'}
                      subtitle={[inv.clients?.name, inv.status].filter(Boolean).join(' · ')}
                      onClick={() => handleSelect(`/invoices/${inv.id}`)}
                    />
                  ))}
                </Group>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, count, children }) {
  return (
    <div className="mb-1 last:mb-0">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {label}
        </p>
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 tabular-nums">
          {count}
        </span>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Row({ Icon, iconColor, iconBg, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
    >
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
        <Icon className={cn('w-4 h-4', iconColor)} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{title}</p>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>
        )}
      </div>
    </button>
  )
}
