'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands } from '@/lib/band-calculator'
import type { StockRow, BuyBand, StockAllocation, StockCategory, FiscalYear } from '@/lib/types'
import FYPicker from '@/components/FYPicker'
import UserMenu from '@/components/UserMenu'
import { RefreshIcon, ChevronRightIcon } from '@/components/icons'
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
  allocations: StockAllocation[]
  fyId: string
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
}

export default function BandsClient({ rows, bands: initialBands, allocations, fiscalYears, selectedFY }: Props) {
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
    const now = new Date().toISOString()
    const prices = data.prices as Record<string, number> | undefined
    const week52 = data.week52 as Record<string, { low: number | null; high: number | null }> | undefined
    const allSymbols = new Set([...Object.keys(prices ?? {}), ...Object.keys(week52 ?? {})])
    await Promise.all(
      Array.from(allSymbols).map(sym => {
        const patch: Record<string, unknown> = {}
        if (prices?.[sym] != null)                                  { patch.manual_cmp = prices[sym]; patch.last_updated_at = now }
        if (week52?.[sym]?.low != null || week52?.[sym]?.high != null) { patch.week_52_low = week52![sym].low; patch.week_52_high = week52![sym].high }
        if (Object.keys(patch).length === 0) return Promise.resolve()
        return sb.from('buy_bands').update(patch).eq('symbol', sym)
      })
    )
    await revalidateBuyBands()
  }

  async function refreshAllCMP() {
    setRefreshingAll(true)
    try {
      await fetchAndSaveCmp(rows.map(r => r.symbol))
    } catch {
      // silently fail
    } finally {
      setRefreshingAll(false)
    }
  }

  const computedBandsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBands>>()
    for (const band of bands) {
      const alloc = allocations.find(a => a.symbol === band.symbol)
      if (alloc) map.set(band.symbol, calculateBands({
        category: alloc.category as StockCategory,
        quality:  alloc.quality  ?? 0,
        stress:   alloc.stress   ?? 0,
        eps:      band.eps,
      }))
    }
    return map
  }, [bands, allocations])

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

      {/* Refresh All CMP strip */}
      <div className="flex items-center justify-end px-4 border-b"
        style={{ borderColor: 'var(--border-faint)', minHeight: 44 }}>
        <button onClick={refreshAllCMP} disabled={refreshingAll}
          className="flex items-center gap-1.5 disabled:opacity-40 text-accent text-subheadline rounded-lg px-2.5 py-1.5"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', minHeight: 32 }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
          {refreshingAll ? 'Refreshing…' : 'Refresh CMP'}
        </button>
      </div>

      {/* Stock rows */}
      <div>
        {[...activeRows, ...completedRows].map((row) => {
          const band      = bands.find(b => b.symbol === row.symbol)
          const isDone    = row.remaining <= 0
          const computed  = computedBandsMap.get(row.symbol)
          const buyLow    = computed?.buyLow    ?? band?.buy_low    ?? null
          const buyHigh   = computed?.buyHigh   ?? band?.buy_high   ?? null
          const midHigh   = computed?.midHigh   ?? band?.mid_high   ?? null
          const trimPrice = computed?.trimPrice ?? band?.trim_price ?? null
          const cmp       = band?.manual_cmp ?? null
          const hasBands  = buyLow != null && trimPrice != null

          return (
            <div key={row.symbol}>
              <button
                onClick={() => router.push(`/bands/${encodeURIComponent(row.symbol)}${fyParam}`)}
                className="w-full flex items-center gap-3 px-4 border-b text-left"
                style={{ borderColor: 'var(--divider)', minHeight: 66, opacity: isDone ? 0.35 : 1 }}>

                {/* Ticker */}
                <span className="font-bold text-headline flex-shrink-0" style={{ width: 96 }}>{row.symbol}</span>

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
    </div>
  )
}
