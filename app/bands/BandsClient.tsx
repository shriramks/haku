'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import type { StockRow, BuyBand, FiscalYear } from '@/lib/types'
import FYPicker from '@/components/FYPicker'
import UserMenu from '@/components/UserMenu'
import { RefreshIcon, SparkleIcon, ChevronRightIcon } from '@/components/icons'
import { formatPriceNum } from '@/lib/formatter'
import { revalidateBuyBands } from '@/app/actions'

// Mini 3-zone band bar for list rows (deep · buy · mid — no trim zone, matches BandBar)
function MiniBar({ buyLow, buyHigh, midHigh, cmp }: {
  buyLow: number; buyHigh: number; midHigh: number; cmp: number | null
}) {
  const min = buyLow * 0.85
  const max = midHigh * 1.12
  const range = max - min
  const p = (v: number) => Math.max(0, ((v - min) / range) * 100)

  const dW = p(buyLow)
  const bW = p(buyHigh) - dW
  const mW = 100 - dW - bW
  // Allow marker to reach right edge when CMP is in trim territory
  const cmpX = cmp != null ? Math.min(100, p(cmp)) : null

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', gap: 1.5 }}>
        <div style={{ width: `${dW}%`, background: 'var(--signal-deep)', opacity: 0.65 }} />
        <div style={{ width: `${bW}%`, background: 'var(--signal-buy)' }} />
        <div style={{ width: `${mW}%`, background: 'var(--signal-hold)' }} />
      </div>
      {cmpX !== null && (
        <div style={{
          position: 'absolute', top: -4, left: `${cmpX}%`,
          transform: 'translateX(-50%)',
          width: 3, height: 13, borderRadius: 2,
          background: 'var(--text-primary)', opacity: 0.85,
        }} />
      )}
    </div>
  )
}

interface Props {
  rows: StockRow[]
  bands: BuyBand[]
  fyId: string
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  investabilities: { symbol: string; investable: boolean; total_score: number }[]
}

export default function BandsClient({ rows, bands: initialBands, fyId, fiscalYears, selectedFY, investabilities }: Props) {
  const router = useRouter()
  const [bands, setBands] = useState(initialBands)
  const [week52, setWeek52] = useState<Record<string, { low: number | null; high: number | null }>>(() => {
    const init: Record<string, { low: number | null; high: number | null }> = {}
    for (const b of initialBands) {
      if (b.week_52_low != null || b.week_52_high != null)
        init[b.symbol] = { low: b.week_52_low, high: b.week_52_high }
    }
    return init
  })
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [regeneratingAll, setRegeneratingAll] = useState(false)
  const [actionError, setActionError] = useState('')
  const [showYieldSheet, setShowYieldSheet] = useState(false)
  const [riskFree, setRiskFree] = useState('0.07')
  const [savingRiskFree, setSavingRiskFree] = useState(false)
  const [riskFreeError, setRiskFreeError] = useState('')

  // Fetches CMP + 52W for the given symbols and persists to DB + local state.
  async function fetchAndSaveCmp(symbols: string[]) {
    if (symbols.length === 0) return
    const res = await fetch(`/api/cmp/batch?symbols=${encodeURIComponent(symbols.join(','))}`)
    if (!res.ok) return
    const data = await res.json()
    const sb = getSupabaseBrowser()

    if (data.prices) {
      setBands(prev => prev.map(b => {
        const price = (data.prices as Record<string, number>)[b.symbol]
        return price != null ? { ...b, manual_cmp: price } : b
      }))
    }
    if (data.week52) {
      setWeek52(prev => ({ ...prev, ...data.week52 }))
    }

    // One DB update per symbol combining both price and week52 fields
    const prices = data.prices as Record<string, number> | undefined
    const week52 = data.week52 as Record<string, { low: number | null; high: number | null }> | undefined
    const allSymbols = new Set([...Object.keys(prices ?? {}), ...Object.keys(week52 ?? {})])
    await Promise.all(
      Array.from(allSymbols).map(sym => {
        const patch: Record<string, unknown> = {}
        if (prices?.[sym] != null)                                  { patch.manual_cmp = prices[sym] }
        if (week52?.[sym]?.low != null || week52?.[sym]?.high != null) { patch.week_52_low = week52![sym].low; patch.week_52_high = week52![sym].high }
        if (Object.keys(patch).length === 0) return Promise.resolve()
        return sb.from('buy_bands').update(patch).eq('symbol', sym)
      })
    )
    await revalidateBuyBands()
  }

  async function refreshAllCMP() {
    setRefreshingAll(true)
    setActionError('')
    try {
      await fetchAndSaveCmp(rows.map(r => r.symbol))
    } catch {
      setActionError('Failed to refresh CMP for all stocks')
    } finally {
      setRefreshingAll(false)
    }
  }

  async function regenAllBands() {
    setRegeneratingAll(true)
    setActionError('')

    const nextBands = new Map(bands.map(b => [b.symbol, b]))
    const failed: string[] = []

    for (const { symbol } of rows) {
      try {
        const res = await fetch(`/api/bands/generate/${encodeURIComponent(symbol)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fyId, action: 'bands' }),
        })
        const json = await res.json()
        if (!res.ok || !json.band) {
          failed.push(symbol)
          continue
        }
        nextBands.set(symbol, json.band as BuyBand)
      } catch {
        failed.push(symbol)
      }
    }

    setBands(prev => {
      const merged = prev.map(b => nextBands.get(b.symbol) ?? b)
      const knownSymbols = new Set(merged.map(b => b.symbol))
      for (const { symbol } of rows) {
        const nextBand = nextBands.get(symbol)
        if (nextBand && !knownSymbols.has(symbol)) merged.push(nextBand)
      }
      return merged
    })
    await revalidateBuyBands()
    router.refresh()

    if (failed.length > 0) {
      setActionError(
        failed.length === 1
          ? `Failed to regen bands for ${failed[0]}`
          : `Failed to regen bands for ${failed.length} stocks`
      )
    }

    setRegeneratingAll(false)
  }

  async function openYieldSheet() {
    setShowYieldSheet(true)
    setRiskFreeError('')
    try {
      const res = await fetch('/api/settings/gemini-key')
      const json = await res.json()
      if (json.riskFree != null) setRiskFree(String(json.riskFree))
    } catch {
      // keep current value
    }
  }

  async function saveRiskFree() {
    setSavingRiskFree(true)
    setRiskFreeError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riskFree: riskFree.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRiskFreeError(json.error ?? 'Failed to save')
      } else {
        if (json.riskFree != null) setRiskFree(String(json.riskFree))
        setShowYieldSheet(false)
      }
    } catch {
      setRiskFreeError('Network error')
    }
    setSavingRiskFree(false)
  }

  const activeRows    = useMemo(() => rows.filter(r => r.remaining > 0).sort((a, b) => a.symbol.localeCompare(b.symbol)), [rows])
  const completedRows = useMemo(() => rows.filter(r => r.remaining <= 0).sort((a, b) => a.symbol.localeCompare(b.symbol)), [rows])

  const fyParam = selectedFY ? `?fy=${encodeURIComponent(selectedFY.label)}` : ''

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-display font-bold">Buy Bands</h1>
          <div className="flex items-center gap-2">
            <FYPicker
              fiscalYears={fiscalYears}
              selectedFY={selectedFY}
              onSelect={fy => router.push(`/bands?fy=${encodeURIComponent(fy.label)}`)}
            />
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Global actions */}
      <div className="px-4 border-b"
        style={{ borderColor: 'var(--border-faint)' }}>
        <div className="flex flex-wrap items-center justify-end gap-2 py-2">
          <button onClick={refreshAllCMP} disabled={refreshingAll || regeneratingAll}
            className="flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 text-accent text-subheadline rounded-xl px-3 py-2"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 44 }}>
            <RefreshIcon className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
            {refreshingAll ? 'Refreshing…' : 'Refresh CMP'}
          </button>
          <button onClick={regenAllBands} disabled={regeneratingAll || refreshingAll}
            className="flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 text-accent text-subheadline rounded-xl px-3 py-2"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 44 }}>
            <SparkleIcon className={`w-3.5 h-3.5 ${regeneratingAll ? 'animate-spin' : ''}`} />
            {regeneratingAll ? 'Regenerating…' : 'Regen Bands'}
          </button>
          <button onClick={openYieldSheet} disabled={refreshingAll || regeneratingAll}
            className="flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 text-accent text-subheadline rounded-xl px-3 py-2"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 44 }}>
            <YieldIcon className="w-3.5 h-3.5" />
            Set 10Y Yield
          </button>
        </div>
        {actionError && (
          <p className="pb-3 text-subheadline text-negative text-right">{actionError}</p>
        )}
      </div>

      {/* Stock rows */}
      <div>
        {[...activeRows, ...completedRows].map((row) => {
          const band      = bands.find(b => b.symbol === row.symbol)
          const isDone    = row.remaining <= 0
          const buyLow    = band?.buy_low    ?? null
          const buyHigh   = band?.buy_high   ?? null
          const midHigh   = band?.mid_high   ?? null
          const trimPrice = band?.trim_price ?? null
          const cmp       = band?.manual_cmp ?? null
          const hasBands  = buyLow != null && trimPrice != null

          return (
            <div key={row.symbol}>
              <button
                onClick={() => router.push(`/bands/${encodeURIComponent(row.symbol)}${fyParam}`)}
                className="w-full flex items-center gap-3 px-4 border-b text-left"
                style={{ borderColor: 'var(--divider)', minHeight: 66, opacity: isDone ? 0.35 : 1 }}>

                {/* Ticker */}
                <div className="flex-shrink-0 overflow-hidden" style={{ width: 112 }}>
                  <p className="font-bold text-headline truncate">{row.symbol}</p>
                </div>

                {/* Mini bar */}
                <div className="flex-1 min-w-0">
                  {hasBands ? (
                    <MiniBar
                      buyLow={buyLow!} buyHigh={buyHigh!}
                      midHigh={midHigh!}
                      cmp={cmp}
                    />
                  ) : (
                    <div style={{ height: 7, borderRadius: 4, background: 'var(--bg-tertiary)' }} />
                  )}
                </div>

                {/* CMP */}
                {cmp != null ? (
                  <p className="text-headline font-bold tabnum flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {formatPriceNum(cmp)}
                  </p>
                ) : (
                  <p className="text-subheadline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>No CMP</p>
                )}

                <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
              </button>
            </div>
          )
        })}
      </div>

      {showYieldSheet && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowYieldSheet(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
            style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setShowYieldSheet(false)} className="text-accent text-headline" style={{ minHeight: 44 }}>
                Cancel
              </button>
              <p className="font-semibold text-headline">Set 10Y Yield</p>
              <button
                onClick={saveRiskFree}
                disabled={savingRiskFree || !riskFree.trim()}
                className="text-accent text-headline font-semibold disabled:opacity-40"
                style={{ minHeight: 44 }}>
                {savingRiskFree ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="px-5 pt-4">
              <p className="text-footnote uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                India 10Y yield
              </p>
              <input
                type="number"
                step="0.0001"
                inputMode="decimal"
                value={riskFree}
                onChange={e => setRiskFree(e.target.value)}
                className="w-full px-4 py-3.5 rounded-2xl text-headline outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                autoFocus
              />
              <p className="text-subheadline mt-2" style={{ color: 'var(--text-muted)' }}>
                Enter as a decimal, for example `0.07` for 7%.
              </p>
              {riskFreeError && <p className="text-subheadline text-negative mt-2">{riskFreeError}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function YieldIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17l5-10 5 10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v10" />
    </svg>
  )
}
