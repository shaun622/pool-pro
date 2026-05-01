import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Module-level cache so every consumer reuses the same fetch. Plans
// data is small (a handful of rows), global, and rarely changes — no
// need for React context or per-component state.
let _plansPromise = null

function fetchPlansOnce() {
  if (_plansPromise) return _plansPromise
  _plansPromise = (async () => {
    const { data, error } = await supabase
      .from('plans')
      .select('slug, name, price_cents, period, max_staff, features, sort_order, is_active')
      .order('sort_order', { ascending: true })
    if (error) {
      // Reset so a retry later can succeed (e.g. transient network error)
      _plansPromise = null
      throw error
    }
    return data || []
  })()
  return _plansPromise
}

/**
 * Reset the cache. Used by HQ admin or the customer Subscription page
 * after they've made changes — currently nothing calls this, but we
 * export it for future use.
 */
export function invalidatePlansCache() {
  _plansPromise = null
}

/**
 * Returns { plans, plansBySlug, loading, error }. plansBySlug is keyed
 * by the immutable slug for O(1) lookup of max_staff etc. by code that
 * already knows a business's plan slug (e.g. useBusiness deriving the
 * effective staff limit).
 */
export function usePlans() {
  const [state, setState] = useState({ plans: null, plansBySlug: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    fetchPlansOnce()
      .then(plans => {
        if (cancelled) return
        const plansBySlug = Object.fromEntries(plans.map(p => [p.slug, p]))
        setState({ plans, plansBySlug, loading: false, error: null })
      })
      .catch(err => {
        if (cancelled) return
        setState({ plans: [], plansBySlug: {}, loading: false, error: err.message || String(err) })
      })
    return () => { cancelled = true }
  }, [])

  return state
}
