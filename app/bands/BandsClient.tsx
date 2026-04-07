'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, CATEGORIES_WITHOUT_QUARTERS } from '@/lib/band-calculator'
import { formatINR, formatPriceNum } from '@/lib/formatter'
import type { StockRow, BuyBand, BuyTranche, StockAllocation, StockCategory, FiscalYear } from '@/lib/types'
import { getBandSignal } from '@/lib/compute'
import TrancheSection from '@/components/TrancheSection'
import BandBar from '@/components/BandBar'
import FYPicker from '@/components/FYPicker'
import UserMenu from '@/components/UserMenu'
import { ChevronDownIcon, SparkleIcon, RefreshIcon, CheckIcon } from '@/components/icons'
import { formatPrice } from '@/lib/formatter'
import { revalidateBuyBands } from '@/app/actions'
import type { BandSignal } from '@/lib/types'

function signalLabel(signal: BandSignal | null): string {
  if (signal === 'deep') return 'Deep'
  if (signal === 'buy')  return 'Buy'
  if (signal === 'hold') return 'Hold'
  if (signal === 'trim') return 'Trim'
  return '—'
}
function signalPillStyle(signal: BandSignal | null): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
    padding: '4px 9px', borderRadius: 20, flexShrink: 0, display: 'inline-block',
  }
  if (signal === 'deep') return { ...base, color: '#30D158', background: 'rgba(48,209,88,0.13)' }
  if (signal === 'buy')  return { ...base, color: '#34C759', background: 'rgba(52,199,89,0.11)' }
  if (signal === 'hold') return { ...base, color: '#FF9F0A', background: 'rgba(255,159,10,0.11)' }
  if (signal === 'trim') return { ...base, color: '#FF453A', background: 'rgba(255,69,58,0.11)' }
  return { ...base, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.07)' }
}
function signalColor(signal: BandSignal | null): string {
  if (signal === 'deep') return '#30D158'
  if (signal === 'buy')  return '#34C759'
  return 'var(--text-primary)'
}

// Mini 4-zone band bar for collapsed rows
function MiniBar({ buyLow, buyHigh, midHigh, trimPrice, cmp }: {
  buyLow: number; buyHigh: number; midHigh: number; trimPrice: number; cmp: number | null
}) {
  const min = buyLow * 0.85
  const max = trimPrice * 1.1
  const range = max - min
  const p = (v: number) => Math.min(100, Math.max(0, ((v - min) / range) * 100))

  const dW = p(buyLow)
  const bW = p(buyHigh) - dW
  const hW = p(trimPrice) - dW - bW
  const tW = 100 - dW - bW - hW
  const cmpX = cmp != null ? p(cmp) : null

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', gap: 1.5 }}>
        <div style={{ width: `${dW}%`, background: '#30D158', opacity: 0.65 }} />
        <div style={{ width: `${bW}%`, background: '#34C759' }} />
        <div style={{ width: `${hW}%`, background: '#FF9500' }} />
        <div style={{ width: `${tW}%`, background: '#FF3B30', opacity: 0.65 }} />
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
  initialTranches: BuyTranche[]
  fyId: string
  fiscalYears: FiscalYear[]
  selectedFY: FiscalYear | null
  initialHasKey: boolean
  initialAiProvider: 'gemini' | 'claude'
}

export default function BandsClient({ rows, bands: initialBands, allocations, initialTranches, fyId, fiscalYears, selectedFY, initialHasKey, initialAiProvider }: Props) {
  const router = useRouter()
  const [bands, setBands]           = useState(initialBands)
  const [allocState, setAllocState] = useState(allocations)
  const [tranches, setTranches]     = useState(initialTranches)
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing]       = useState<Record<string, boolean>>({})
  const [generating, setGenerating]             = useState<Record<string, boolean>>({})
  const [genError, setGenError]                 = useState<Record<string, string>>({})
  const [genWarning, setGenWarning]             = useState<Record<string, string>>({})
  const [generatingTranches, setGeneratingTranches] = useState<Record<string, boolean>>({})
  const [week52, setWeek52] = useState<Record<string, { low: number | null; high: number | null }>>(() => {
    const init: Record<string, { low: number | null; high: number | null }> = {}
    for (const b of initialBands) {
      if (b.week_52_low != null || b.week_52_high != null)
        init[b.symbol] = { low: b.week_52_low, high: b.week_52_high }
    }
    return init
  })
  const [hasKey, setHasKey]               = useState(initialHasKey)
  const [aiProvider, setAiProvider]       = useState(initialAiProvider)
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const [showQuartersInfo, setShowQuartersInfo] = useState(false)
  const [qSheetSymbol, setQSheetSymbol] = useState<string | null>(null)
  const [userId, setUserId]               = useState<string | null>(null)

  useEffect(() => {
    // getSession() reads from localStorage — no network call
    getSupabaseBrowser().auth.getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

  // Fetch fresh 52W low/high for all symbols on mount
  useEffect(() => {
    if (rows.length === 0) return
    const symbols = rows.map(r => r.symbol).join(',')
    fetch(`/api/cmp/batch?symbols=${encodeURIComponent(symbols)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.week52) setWeek52(data.week52)
      })
      .catch(() => {})
  }, [rows])

  function toggle(symbol: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(symbol) ? next.delete(symbol) : next.add(symbol)
      return next
    })
  }

  async function refreshCMP(symbol: string) {
    setRefreshing(prev => ({ ...prev, [symbol]: true }))
    try {
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error('fetch failed')
      const { price, week52Low, week52High } = await res.json()
      if (week52Low != null || week52High != null)
        setWeek52(prev => ({ ...prev, [symbol]: { low: week52Low ?? null, high: week52High ?? null } }))

      const sb = getSupabaseBrowser()
      const band = bands.find(b => b.symbol === symbol)

      if (band) {
        await sb.from('buy_bands').update({
          manual_cmp: price,
          week_52_low: week52Low ?? null,
          week_52_high: week52High ?? null,
          last_updated_at: new Date().toISOString(),
        }).eq('id', band.id)
        setBands(prev => prev.map(b => b.symbol === symbol ? { ...b, manual_cmp: price, week_52_low: week52Low ?? null, week_52_high: week52High ?? null } : b))
        // Invalidate server cache so next page load reflects updated values
        revalidateBuyBands()
      } else {
        // No band record yet — create a minimal one
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          const { data } = await sb.from('buy_bands').insert({
            user_id: user.id, symbol, anchor_type: 'PE',
            manual_cmp: price, is_current: true,
          }).select().single()
          if (data) setBands(prev => [...prev, data])
        }
      }
    } catch {
      // silently fail
    }
    setRefreshing(prev => ({ ...prev, [symbol]: false }))
  }

  async function generateBands(symbol: string) {
    if (!hasKey) { setShowKeyPrompt(true); return }
    setGenerating(prev => ({ ...prev, [symbol]: true }))
    setGenError(prev => ({ ...prev, [symbol]: '' }))
    try {
      const res = await fetch(`/api/bands/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setGenError(prev => ({ ...prev, [symbol]: json.error ?? 'Generation failed' }))
      } else {
        if (json.band) {
          setBands(prev => [...prev.filter(b => b.symbol !== symbol), json.band])
          setTranches(prev => [
            ...prev.filter(t => t.symbol !== symbol),
            ...(json.tranches ?? []),
          ])
        }
      }
    } catch {
      setGenError(prev => ({ ...prev, [symbol]: 'Network error' }))
    }
    setGenerating(prev => ({ ...prev, [symbol]: false }))
  }

  async function toggleQuarters(symbol: string, field: 'two_weak_quarters' | 'two_strong_quarters', value: boolean) {
    const alloc = allocState.find(a => a.symbol === symbol)
    if (!alloc) return

    const patch: Record<string, boolean> = { [field]: value }
    if (value) patch[field === 'two_weak_quarters' ? 'two_strong_quarters' : 'two_weak_quarters'] = false
    const updated = { ...alloc, ...patch }

    setAllocState(prev => prev.map(a => a.symbol === symbol ? updated : a))

    const sb = getSupabaseBrowser()
    const band = bands.find(b => b.symbol === symbol)

    if (band && band.eps) {
      const result = calculateBands({
        category: updated.category as StockCategory,
        twoWeakQuarters:   updated.two_weak_quarters,
        twoStrongQuarters: updated.two_strong_quarters,
        eps: band.eps,
      })
      if (result) {
        const cmp        = band.manual_cmp ?? null
        const deployable = rows.find(r => r.symbol === symbol)?.remaining ?? 0
        const prices     = computeTrancheprices(result.buyLow, result.buyHigh, cmp, result.midLow, result.midHigh)

        const sortedPrices = [...prices].sort((a, b) => b - a)
        const amounts = computeTrancheAmounts(deployable, sortedPrices.length)

        setBands(prev => prev.map(b => b.symbol === symbol ? {
          ...b,
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
        } : b))
        setTranches(prev => [
          ...prev.filter(t => t.symbol !== symbol),
          ...sortedPrices.map((price, i) => {
            const amt = amounts[i] ?? 0
            return {
              id: `opt-${symbol}-${i}`, symbol, price,
              qty:       amt > 0 ? Math.max(1, Math.round(amt / price)) : 0,
              sort_order: i + 1, fy_id: fyId,
            } as BuyTranche
          }),
        ])

        await Promise.all([
          sb.from('stock_allocations').update(patch).eq('id', alloc.id),
          sb.from('buy_bands').update({
            buy_low: result.buyLow, buy_high: result.buyHigh,
            mid_low: result.midLow, mid_high: result.midHigh,
            trim_price: result.trimPrice,
            last_updated_at: new Date().toISOString(),
          }).eq('symbol', symbol).eq('is_current', true),
        ])

        if (userId) {
          await sb.from('buy_tranches').delete().eq('symbol', symbol).eq('fy_id', fyId)
          const { data: newTranches } = await sb.from('buy_tranches').insert(
            sortedPrices.map((price, i) => {
              const amt = amounts[i] ?? 0
              return {
                user_id: userId, symbol, price,
                qty:       amt > 0 ? Math.max(1, Math.round(amt / price)) : 0,
                sort_order: i + 1, fy_id: fyId,
              }
            })
          ).select()
          if (newTranches) setTranches(prev => [...prev.filter(t => t.symbol !== symbol), ...newTranches])
        }
        return
      }
    }

    sb.from('stock_allocations').update(patch).eq('id', alloc.id)
  }

  async function addTranche(symbol: string, qty: number, price: number) {
    if (!userId) return
    const existing = tranches.filter(t => t.symbol === symbol)
    const { data } = await getSupabaseBrowser().from('buy_tranches').insert({
      user_id: userId, symbol, qty, price,
      sort_order: existing.length + 1, fy_id: fyId,
    }).select().single()
    if (data) setTranches(prev => [...prev, data])
  }

  async function deleteTranche(id: string) {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('id', id)
    setTranches(prev => prev.filter(t => t.id !== id))
  }

  async function updateTranche(id: string, qty: number, price: number) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, qty, price } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ qty, price }).eq('id', id)
  }

  async function clearTranches(symbol: string) {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('symbol', symbol).eq('fy_id', fyId)
    setTranches(prev => prev.filter(t => t.symbol !== symbol))
  }

  async function generateTranches(symbol: string) {
    setGeneratingTranches(prev => ({ ...prev, [symbol]: true }))
    try {
      const res = await fetch(`/api/tranches/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fyId,
          remainingInr:   rows.find(r => r.symbol === symbol)?.remaining ?? 0,
          userLiquidInr:  selectedFY?.deploy_capital_inr ?? rows.reduce((s, r) => s + Math.max(0, r.remaining), 0),
        }),
      })
      const json = await res.json()
      if (res.ok && json.tranches?.length > 0) {
        setTranches(prev => [
          ...prev.filter(t => t.symbol !== symbol),
          ...json.tranches,
        ])
        if (json.warning) setGenWarning(prev => ({ ...prev, [symbol]: json.warning }))
        else setGenWarning(prev => { const n = { ...prev }; delete n[symbol]; return n })
      }
    } catch {
      // silently fail
    }
    setGeneratingTranches(prev => ({ ...prev, [symbol]: false }))
  }

  const computedBandsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBands>>()
    for (const band of bands) {
      const alloc = allocState.find(a => a.symbol === band.symbol)
      if (alloc) map.set(band.symbol, calculateBands({
        category: alloc.category as StockCategory,
        twoWeakQuarters: alloc.two_weak_quarters,
        twoStrongQuarters: alloc.two_strong_quarters,
        eps: band.eps,
      }))
    }
    return map
  }, [bands, allocState])

  const activeRows    = useMemo(() => rows.filter(r => r.remaining > 0).sort((a, b) => a.symbol.localeCompare(b.symbol)), [rows])
  const completedRows = useMemo(() => rows.filter(r => r.remaining <= 0).sort((a, b) => a.symbol.localeCompare(b.symbol)), [rows])

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
        <div className="flex items-center justify-between">
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

      {showKeyPrompt && (
        <KeyPromptSheet
          initialProvider={aiProvider}
          onClose={() => setShowKeyPrompt(false)}
          onSaved={(provider) => { setHasKey(true); setAiProvider(provider) }}
        />
      )}
      {showQuartersInfo && (
        <QuartersInfoSheet onClose={() => setShowQuartersInfo(false)} />
      )}
      {qSheetSymbol && (() => {
        const qAlloc = allocState.find(a => a.symbol === qSheetSymbol)
        const curMode = qAlloc?.two_weak_quarters ? 'bear' : qAlloc?.two_strong_quarters ? 'bull' : 'normal'
        return (
          <QModeSheet
            currentMode={curMode}
            onSelect={m => {
              if (m === 'bear') toggleQuarters(qSheetSymbol, 'two_weak_quarters', true)
              else if (m === 'bull') toggleQuarters(qSheetSymbol, 'two_strong_quarters', true)
              else if (qAlloc?.two_weak_quarters) toggleQuarters(qSheetSymbol, 'two_weak_quarters', false)
              else toggleQuarters(qSheetSymbol, 'two_strong_quarters', false)
              setQSheetSymbol(null)
            }}
            onInfo={() => { setQSheetSymbol(null); setShowQuartersInfo(true) }}
            onClose={() => setQSheetSymbol(null)}
          />
        )
      })()}

      {/* Stock rows */}
      <div>
        {[...activeRows, ...completedRows].map((row, idx) => {
          const showDivider = idx === activeRows.length && completedRows.length > 0
          const band      = bands.find(b => b.symbol === row.symbol)
          const alloc     = allocState.find(a => a.symbol === row.symbol)
          const isExp     = expanded.has(row.symbol)
          const isRefresh = refreshing[row.symbol]
          const stockTranches = tranches
            .filter(t => t.symbol === row.symbol)
            .sort((a, b) => b.price - a.price)

          const computed = computedBandsMap.get(row.symbol)
          const buyLow   = computed?.buyLow   ?? band?.buy_low   ?? null
          const buyHigh  = computed?.buyHigh  ?? band?.buy_high  ?? null
          const midLow   = computed?.midLow   ?? band?.mid_low   ?? null
          const midHigh  = computed?.midHigh  ?? band?.mid_high  ?? null
          const trimPrice= computed?.trimPrice ?? band?.trim_price ?? null
          const cmp      = band?.manual_cmp ?? null

          const hasBands = buyLow != null && trimPrice != null
          const isDone = row.remaining <= 0
          const signal = getBandSignal(cmp, buyLow, buyHigh, midHigh, trimPrice)

          // Quarter mode for this row
          const qMode = alloc?.two_weak_quarters ? 'bear' : alloc?.two_strong_quarters ? 'bull' : 'normal'
          const hasQuarters = alloc && !CATEGORIES_WITHOUT_QUARTERS.has(alloc.category as StockCategory)

          function onQClick(m: 'bear' | 'normal' | 'bull') {
            if (m === qMode) return
            if (m === 'bear') toggleQuarters(row.symbol, 'two_weak_quarters', true)
            else if (m === 'bull') toggleQuarters(row.symbol, 'two_strong_quarters', true)
            else if (alloc?.two_weak_quarters) toggleQuarters(row.symbol, 'two_weak_quarters', false)
            else toggleQuarters(row.symbol, 'two_strong_quarters', false)
          }

          return (
            <div key={row.symbol}>
            <div className="border-b"
                 style={{ borderColor: 'var(--border-faint)', opacity: isDone ? 0.45 : 1 }}>
              {/* Collapsed header */}
              <div
                onClick={() => toggle(row.symbol)}
                className="w-full flex items-center gap-3 px-4 text-left tap-row cursor-pointer"
                style={{ minHeight: 66 }}>

                {/* Ticker */}
                <span className="font-bold text-headline flex-shrink-0" style={{ minWidth: 68 }}>{row.symbol}</span>

                {/* Signal badge */}
                <span style={signalPillStyle(hasBands ? signal : null)}>
                  {hasBands ? signalLabel(signal) : '—'}
                </span>

                {/* Mini bar */}
                <div className="flex-1 min-w-0">
                  {hasBands ? (
                    <MiniBar
                      buyLow={buyLow!} buyHigh={buyHigh!}
                      midHigh={midHigh!} trimPrice={trimPrice!}
                      cmp={cmp}
                    />
                  ) : (
                    <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }} />
                  )}
                </div>

                {/* CMP + remaining */}
                <div className="text-right flex-shrink-0">
                  {cmp != null ? (
                    <p className="text-headline font-bold tabnum" style={{ color: signalColor(hasBands ? signal : null) }}>
                      {formatPrice(cmp)}
                    </p>
                  ) : (
                    <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No CMP</p>
                  )}
                  <p className="tabnum" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                    {formatINR(Math.max(0, row.remaining))} left
                  </p>
                </div>

                <ChevronDownIcon className={`w-4 h-4 flex-shrink-0 transition-transform ${isExp ? 'rotate-180' : ''}`}
                  style={{ color: 'var(--text-faint)' }} />
              </div>

              {/* Expanded content */}
              {isExp && (
                <div className="border-t" style={{ borderColor: 'var(--border-faint)' }}>
                  {generating[row.symbol] ? (
                    <div className="px-4 pt-4 pb-2">
                      <div className="h-7 rounded-lg animate-pulse" style={{ background: 'var(--bg-tertiary)' }} />
                      <div className="flex justify-between mt-2 gap-2">
                        {[...Array(4)].map((_, i) => (
                          <div key={i} className="h-8 flex-1 rounded-lg animate-pulse"
                               style={{ background: 'var(--bg-tertiary)' }} />
                        ))}
                      </div>
                    </div>
                  ) : hasBands ? (
                    <div className="px-4 pt-4 pb-2">
                      <BandBar
                        buyLow={buyLow!} buyHigh={buyHigh!}
                        midLow={midLow!} midHigh={midHigh!}
                        trimPrice={trimPrice!} cmp={cmp}
                      />
                      {/* 4-col price grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, marginTop: 12 }}>
                        {[
                          { label: 'DEEP', range: `<${formatPrice(buyLow!)}`,                       bg: 'rgba(48,209,88,0.09)',  color: '#30D158' },
                          { label: 'BUY',  range: `${formatPrice(buyLow!)}–${formatPriceNum(buyHigh!)}`,  bg: 'rgba(52,199,89,0.07)',  color: '#34C759' },
                          { label: 'HOLD', range: `${formatPrice(buyHigh!)}–${formatPriceNum(trimPrice!)}`, bg: 'rgba(255,159,10,0.07)', color: '#FF9F0A' },
                          { label: 'TRIM', range: `>${formatPrice(trimPrice!)}`,                     bg: 'rgba(255,69,58,0.07)',  color: '#FF453A' },
                        ].map(({ label, range, bg, color }) => (
                          <div key={label} style={{ borderRadius: 10, padding: '8px 9px', background: bg }}>
                            <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color, marginBottom: 3 }}>{label}</p>
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums' }}>{range}</p>
                          </div>
                        ))}
                      </div>
                      {/* 52W range — Low anchored left, High anchored right */}
                      {(week52[row.symbol]?.low != null || week52[row.symbol]?.high != null) && (
                        <div className="flex justify-between mt-3">
                          <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)' }}>
                            {week52[row.symbol]?.low != null ? `52W Low ${formatPrice(week52[row.symbol].low!)}` : ''}
                          </p>
                          <p className="text-footnote tabnum" style={{ color: 'var(--text-muted)' }}>
                            {week52[row.symbol]?.high != null ? `52W High ${formatPrice(week52[row.symbol].high!)}` : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-4 pt-4 pb-2">
                      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>No bands yet — tap Regenerate Bands to generate</p>
                    </div>
                  )}
                  {genError[row.symbol] && (
                    <p className="px-4 pb-2 text-subheadline text-negative">{genError[row.symbol]}</p>
                  )}
                  {genWarning[row.symbol] && (
                    <p className="px-4 pb-2 text-subheadline text-warning">{genWarning[row.symbol]}</p>
                  )}

                  {/* Action row: quarter pill (left) + Regen Bands + Refresh CMP (right) */}
                  <div className="px-4 border-t flex items-center justify-between gap-3"
                    style={{ borderColor: 'var(--border-faint)', minHeight: 44 }}>
                    {hasQuarters ? (
                      <button onClick={() => setQSheetSymbol(row.symbol)}
                        className="flex items-center gap-1.5 text-body font-medium flex-shrink-0 rounded-lg"
                        style={{ padding: '6px 11px', background: 'rgba(120,120,128,0.12)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>
                        {qMode === 'bear' ? 'Bear' : qMode === 'bull' ? 'Bull' : 'Normal'}
                        <ChevronDownIcon className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    ) : <div />}
                    <div className="flex items-center gap-4">
                      <button onClick={() => generateBands(row.symbol)} disabled={generating[row.symbol]}
                        className="flex items-center gap-1.5 text-body disabled:opacity-40"
                        style={{ color: 'var(--accent)' }}>
                        <SparkleIcon className="w-3.5 h-3.5" />
                        {generating[row.symbol] ? 'Generating…' : 'Regen Bands'}
                      </button>
                      <button onClick={() => refreshCMP(row.symbol)} disabled={isRefresh}
                        className="flex items-center gap-1.5 text-body disabled:opacity-40"
                        style={{ color: 'var(--accent)' }}>
                        <RefreshIcon className="w-3.5 h-3.5" />
                        {isRefresh ? 'Refreshing…' : 'Refresh CMP'}
                      </button>
                    </div>
                  </div>

                  {/* Tranches */}
                  <TrancheSection
                    symbol={row.symbol}
                    tranches={stockTranches}
                    remaining={row.remaining}
                    budget={row.budget}
                    hasBands={hasBands}
                    cmp={cmp}
                    onAdd={addTranche}
                    onDelete={deleteTranche}
                    onUpdate={updateTranche}
                    onGenerate={() => generateTranches(row.symbol)}
                    onClear={() => clearTranches(row.symbol)}
                    generating={generatingTranches[row.symbol] ?? false}
                  />
                </div>
              )}
            </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Quarter Mode Sheet (Bear / Normal / Bull picker) ─────────────────────────

function QModeSheet({ currentMode, onSelect, onInfo, onClose }: {
  currentMode: 'bear' | 'normal' | 'bull'
  onSelect: (mode: 'bear' | 'normal' | 'bull') => void
  onInfo: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 8px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <p className="text-center text-footnote font-semibold uppercase tracking-wider pb-2"
           style={{ color: 'var(--text-faint)', letterSpacing: '0.04em' }}>
          Recent Quarters
        </p>
        {(['Bear', 'Normal', 'Bull'] as const).map(label => {
          const mode = label.toLowerCase() as 'bear' | 'normal' | 'bull'
          const active = currentMode === mode
          return (
            <button key={mode}
              onClick={() => onSelect(mode)}
              className="flex items-center justify-between w-full px-5 border-t"
              style={{ minHeight: 52, borderColor: 'var(--border-faint)' }}>
              <span className="text-headline">{label}</span>
              {active && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--accent)' }}>
                  <CheckIcon className="w-3 h-3 text-white" />
                </span>
              )}
            </button>
          )
        })}
        <button onClick={onInfo}
          className="flex items-center justify-center w-full border-t"
          style={{ minHeight: 44, borderColor: 'var(--border-faint)', color: 'var(--accent)' }}>
          <span className="text-body">About Recent Quarters…</span>
        </button>
      </div>
    </>
  )
}

// ── Quarters Info Sheet ───────────────────────────────────────────────────────

function QuartersInfoSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-headline">Recent Quarters</p>
          <button onClick={onClose} className="text-accent text-headline w-14 text-right">Done</button>
        </div>

        <div className="px-5 pt-4">
          <p className="text-body leading-relaxed mb-5" style={{ color: 'var(--text-2)' }}>
            Adjusts buy band multiples based on the last 2 quarters of reported results.
          </p>

          {[
            {
              mode: 'Bear',
              desc: 'Two recent weak quarters. Buy range compresses to the lower half of standard multiples — you demand deeper discounts before committing.',
            },
            {
              mode: 'Normal',
              desc: 'Base case. Full standard multiples apply. Use when recent quarters are in line with expectations.',
            },
            {
              mode: 'Bull',
              desc: 'Two recent strong quarters. Buy range shifts to premium multiples (where defined) or the upper half of the standard range.',
            },
          ].map(({ mode, desc }, i, arr) => (
            <div key={mode}>
              <p className="text-body font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{mode}</p>
              <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
              {i < arr.length - 1 && (
                <div className="my-4" style={{ height: 1, background: 'var(--border-faint)' }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── AI Key Prompt Sheet ───────────────────────────────────────────────────────

function KeyPromptSheet({ initialProvider, onClose, onSaved }: {
  initialProvider: 'gemini' | 'claude'
  onClose: () => void
  onSaved: (provider: 'gemini' | 'claude') => void
}) {
  const [provider, setProvider] = useState<'gemini' | 'claude'>(initialProvider)
  const [key, setKey]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim(), provider }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save'); setSaving(false); return }
      onSaved(provider)
      onClose()
    } catch {
      setError('Network error')
    }
    setSaving(false)
  }

  const placeholder = provider === 'claude' ? 'sk-ant-…' : 'AIzaSy…'
  const keyLink     = provider === 'claude' ? 'console.anthropic.com' : 'aistudio.google.com'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-accent text-headline">Cancel</button>
          <p className="font-semibold text-headline">AI API Key</p>
          <button onClick={save} disabled={saving || !key.trim()}
            className="text-accent text-headline font-semibold disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="px-5 pt-4 space-y-4">
          {/* Provider selector */}
          <div className="flex rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['gemini', 'claude'] as const).map(p => (
              <button key={p} type="button" onClick={() => { setProvider(p); setKey(''); setError('') }}
                className="flex-1 py-3 text-body font-medium transition-colors"
                style={provider === p
                  ? { background: '#0A84FF', color: '#fff' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {p === 'gemini' ? 'Google Gemini' : 'Claude'}
              </button>
            ))}
          </div>

          {provider === 'gemini' && (
            <p className="text-subheadline text-center text-positive">
              ★ Recommended — best accuracy for live financial data
            </p>
          )}

          <input
            type="password"
            placeholder={placeholder}
            value={key}
            onChange={e => setKey(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl text-headline outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            autoFocus
          />

          {error && <p className="text-negative text-subheadline">{error}</p>}

          <div className="rounded-2xl p-3.5"
               style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.18)' }}>
            <p className="text-subheadline leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="font-semibold text-accent">Stored securely.</span>{' '}
              Your API key lives in your database (Supabase) and is locked to your login via row-level security.
              Band generation runs entirely on the server — your browser never sees the key again after you save it.
              Only your session can retrieve it, and only to call the AI provider.
            </p>
          </div>

          <p className="text-subheadline text-center" style={{ color: 'var(--text-muted)' }}>
            Get a key at{' '}
            <span className="text-accent">{keyLink}</span>
          </p>
        </div>
      </div>
    </>
  )
}
