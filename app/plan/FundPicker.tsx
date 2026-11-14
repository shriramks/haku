'use client'
import { useEffect, useState } from 'react'
import { searchAmfiSchemes } from '@/app/portfolio/actions'
import { MIN_QUERY_CHARS, type MfSchemeResult } from '@/lib/mf-schemes'
import { SearchIcon } from '@/components/icons'
import { FundResult } from './FundResult'

/**
 * Debounced AMFI search limited to debt and arbitrage funds (the Debt sleeve). `inPlan` holds the scheme codes
 * already in this FY's plan; those results show but cannot be picked.
 */
export function FundPicker({ inPlan, onPick }: { inPlan: Set<string>; onPick: (s: MfSchemeResult) => void }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<MfSchemeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [failed, setFailed]     = useState(false)
  const searchable = query.trim().length >= MIN_QUERY_CHARS

  useEffect(() => {
    if (!searchable) { setResults([]); setSearching(false); setFailed(false); return }
    let stale = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const res = await searchAmfiSchemes(query, true)
      if (stale) return
      setSearching(false)
      if ('error' in res) { setResults([]); setFailed(true); return }
      setFailed(false)
      setResults(res.schemes)
    }, 250)
    return () => { stale = true; clearTimeout(timer) }
  }, [query, searchable])

  return (
    <div className="px-5 pb-3" style={{ minHeight: 'min(500px, 55vh)' }}>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
        <input type="text" placeholder="Search debt and arbitrage funds…" value={query} onChange={e => setQuery(e.target.value)}
          className="w-full pl-9 pr-3 rounded-xl text-body outline-none"
          style={{ height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
      </div>
      {results.length > 0 ? (
        <div className="mt-1 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)', maxHeight: '45vh', overflowY: 'auto' }}>
          {results.map(s => <FundResult key={s.code} scheme={s} inPlan={inPlan.has(s.code)} onPick={onPick} />)}
        </div>
      ) : searchable ? (
        <p className="text-subheadline mt-2 px-1" style={{ color: 'var(--text-faint)' }}>
          {searching ? 'Searching…' : failed ? 'Search failed' : 'No matching funds'}
        </p>
      ) : null}
    </div>
  )
}
