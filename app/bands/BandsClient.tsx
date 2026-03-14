'use client'
import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices } from '@/lib/band-calculator'
import { getBandSignal } from '@/lib/band-calculator'
import { formatINR } from '@/lib/formatter'
import type { StockRow, BuyBand, BuyTranche, StockAllocation, StockCategory } from '@/lib/types'

interface Props {
  rows: StockRow[]
  bands: BuyBand[]
  allocations: StockAllocation[]
  initialTranches: BuyTranche[]
  fyId: string
  fyLabel?: string
}

export default function BandsClient({ rows, bands: initialBands, allocations, initialTranches, fyId, fyLabel }: Props) {
  const [bands, setBands]           = useState(initialBands)
  const [allocState, setAllocState] = useState(allocations)
  const [tranches, setTranches]     = useState(initialTranches)
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing]       = useState<Record<string, boolean>>({})
  const [generating, setGenerating]             = useState<Record<string, boolean>>({})
  const [genError, setGenError]                 = useState<Record<string, string>>({})
  const [generatingTranches, setGeneratingTranches] = useState<Record<string, boolean>>({})
  const [hasKey, setHasKey]               = useState<boolean | null>(null)
  const [aiProvider, setAiProvider]       = useState<'gemini' | 'claude'>('gemini')
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const [showQuartersInfo, setShowQuartersInfo] = useState(false)
  const [userId, setUserId]               = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/gemini-key')
      .then(r => r.json())
      .then(d => {
        setHasKey(d.hasKey ?? false)
        setAiProvider(d.provider ?? 'gemini')
      })
      .catch(() => setHasKey(false))
    // getSession() reads from localStorage — no network call
    getSupabaseBrowser().auth.getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

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
      const res = await fetch(`/api/cmp/${symbol}`)
      if (!res.ok) throw new Error('fetch failed')
      const { price } = await res.json()

      const sb = getSupabaseBrowser()
      const band = bands.find(b => b.symbol === symbol)

      if (band) {
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        setBands(prev => prev.map(b => b.symbol === symbol ? { ...b, manual_cmp: price } : b))
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
      const res = await fetch(`/api/bands/generate/${symbol}`, {
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
          // Always clear stale tranches when bands regenerate; add new ones if returned
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

    // Mutually exclusive: turning one on turns the other off
    const patch: Record<string, boolean> = { [field]: value }
    if (value) patch[field === 'two_weak_quarters' ? 'two_strong_quarters' : 'two_weak_quarters'] = false
    const updated = { ...alloc, ...patch }

    // ① Optimistic UI — update immediately, don't wait for DB
    setAllocState(prev => prev.map(a => a.symbol === symbol ? updated : a))

    const sb = getSupabaseBrowser()
    const band = bands.find(b => b.symbol === symbol)

    if (band && (band.eps || band.bvps || band.ebitda)) {
      const result = calculateBands({
        category: updated.category as StockCategory,
        twoWeakQuarters:     updated.two_weak_quarters,
        twoStrongQuarters:   updated.two_strong_quarters,
        isHospitalRampPhase: updated.is_hospital_ramp_phase,
        eps: band.eps, bvps: band.bvps, ebitda: band.ebitda,
        netDebt: band.net_debt, shares: band.shares, embeddedValue: band.embedded_value,
      })
      if (result) {
        const cmp       = band.manual_cmp ?? null
        const remaining = rows.find(r => r.symbol === symbol)?.remaining ?? 0
        const prices    = computeTrancheprices(result.buyLow, result.buyHigh, cmp, result.midLow, result.midHigh)
        const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

        // ② Optimistic band + tranche update — instant UI
        setBands(prev => prev.map(b => b.symbol === symbol ? {
          ...b,
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
        } : b))
        setTranches(prev => [
          ...prev.filter(t => t.symbol !== symbol),
          ...prices.map((price, i) => ({
            id: `opt-${symbol}-${i}`, symbol, price,
            qty:        amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
            allocated:  false, sort_order: i + 1, fy_id: fyId,
          } as BuyTranche)),
        ])

        // ③ Write to DB in background — 3 ops (was 5): alloc + band-in-place + tranches
        // RLS filters to current user, no auth.getUser() needed for updates
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
            prices.map((price, i) => ({
              user_id: userId, symbol, price,
              qty:        amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
              allocated:  false, sort_order: i + 1, fy_id: fyId,
            }))
          ).select()
          // Replace temp IDs with real DB IDs
          if (newTranches) setTranches(prev => [...prev.filter(t => t.symbol !== symbol), ...newTranches])
        }
        return
      }
    }

    // No band data — just write alloc
    sb.from('stock_allocations').update(patch).eq('id', alloc.id)
  }

  async function toggleTranche(id: string, allocated: boolean) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, allocated } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ allocated }).eq('id', id)
  }

  async function addTranche(symbol: string, qty: number, price: number) {
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const existing = tranches.filter(t => t.symbol === symbol)
    const { data } = await sb.from('buy_tranches').insert({
      user_id: user.id, symbol, qty, price, allocated: false,
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
      const res = await fetch(`/api/tranches/generate/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId }),
      })
      const json = await res.json()
      if (res.ok && json.tranches?.length > 0) {
        setTranches(prev => [
          ...prev.filter(t => t.symbol !== symbol),
          ...json.tranches,
        ])
      }
    } catch {
      // silently fail — tranches are non-critical
    }
    setGeneratingTranches(prev => ({ ...prev, [symbol]: false }))
  }

  const isDone = (symbol: string) => {
    const st = tranches.filter(t => t.symbol === symbol)
    return st.length > 0 && st.every(t => t.allocated)
  }
  const activeRows    = rows.filter(r => !isDone(r.symbol))
  const completedRows = rows.filter(r => isDone(r.symbol))

  return (
    <div>
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

          // Re-compute band result from stored financial inputs (for tightening display)
          const computed = (band && alloc) ? calculateBands({
            category: alloc.category as StockCategory,
            twoWeakQuarters: alloc.two_weak_quarters,
            twoStrongQuarters: alloc.two_strong_quarters,
            isHospitalRampPhase: alloc.is_hospital_ramp_phase,
            eps: band.eps, bvps: band.bvps, ebitda: band.ebitda,
            netDebt: band.net_debt, shares: band.shares, embeddedValue: band.embedded_value,
          }) : null

          const buyLow   = computed?.buyLow   ?? band?.buy_low   ?? null
          const buyHigh  = computed?.buyHigh  ?? band?.buy_high  ?? null
          const midLow   = computed?.midLow   ?? band?.mid_low   ?? null
          const midHigh  = computed?.midHigh  ?? band?.mid_high  ?? null
          const trimPrice= computed?.trimPrice ?? band?.trim_price ?? null
          const cmp      = band?.manual_cmp ?? null

          const hasBands = buyLow != null && trimPrice != null
          const isDone = stockTranches.length > 0 && stockTranches.every(t => t.allocated)

          return (
            <div key={row.symbol}>
              {showDivider && (
                <div className="px-4 py-2">
                  <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Completed</span>
                </div>
              )}
            <div className="border-b"
                 style={{ borderColor: 'var(--border-faint)', opacity: isDone ? 0.45 : 1 }}>
              {/* Collapsed header — always visible */}
              <div
                onClick={() => toggle(row.symbol)}
                className="w-full flex items-center gap-3 px-4 py-4 text-left tap-row cursor-pointer">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="font-bold text-[17px]">{row.symbol}</span>
                  {cmp && (
                    <span className="text-[13px] tabnum" style={{ color: 'var(--text-muted)' }}>
                      ₹{Math.round(cmp).toLocaleString('en-IN')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Bands button */}
                  <button
                    onClick={e => { e.stopPropagation(); generateBands(row.symbol) }}
                    disabled={generating[row.symbol]}
                    className="flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
                    style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
                    <SparkleIcon className={`w-3.5 h-3.5 ${generating[row.symbol] ? 'spin' : ''}`} />
                    Bands
                  </button>
                  {/* CMP button */}
                  <button
                    onClick={e => { e.stopPropagation(); refreshCMP(row.symbol) }}
                    disabled={refreshing[row.symbol]}
                    className="flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    <RefreshIcon className={`w-3.5 h-3.5 ${refreshing[row.symbol] ? 'spin' : ''}`} />
                    CMP
                  </button>
                  <span style={{ color: 'var(--text-faint)' }}>
                    <ChevronIcon className={`w-4 h-4 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                  </span>
                </div>
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
                    </div>
                  ) : (
                    <div className="px-4 pt-4 pb-2">
                      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No bands yet</p>
                    </div>
                  )}
                  {genError[row.symbol] && (
                    <p className="px-4 pb-2 text-[12px] text-red-400">{genError[row.symbol]}</p>
                  )}

                  {/* Controls: Bear/Normal/Bull + ⓘ */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center gap-2">
                      {alloc && (() => {
                        const mode = alloc.two_weak_quarters ? 'bear' : alloc.two_strong_quarters ? 'bull' : 'normal'
                        return (
                          <div className="flex flex-1 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                            {(['bear', 'normal', 'bull'] as const).map(m => (
                              <button key={m} type="button"
                                onClick={async () => {
                                  if (m === mode) return
                                  if (m === 'bear') {
                                    toggleQuarters(row.symbol, 'two_weak_quarters', true)
                                  } else if (m === 'bull') {
                                    toggleQuarters(row.symbol, 'two_strong_quarters', true)
                                    // For Hospitals, Bull also implies ramp phase
                                    if (alloc.category === 'Hospitals' && !alloc.is_hospital_ramp_phase) {
                                      const sb = getSupabaseBrowser()
                                      await sb.from('stock_allocations').update({ is_hospital_ramp_phase: true }).eq('id', alloc.id)
                                      setAllocState(prev => prev.map(a => a.id === alloc.id ? { ...a, is_hospital_ramp_phase: true } : a))
                                    }
                                  } else {
                                    if (alloc.two_weak_quarters)   toggleQuarters(row.symbol, 'two_weak_quarters', false)
                                    else if (alloc.two_strong_quarters) toggleQuarters(row.symbol, 'two_strong_quarters', false)
                                  }
                                }}
                                className="flex-1 px-2.5 py-2.5 text-[13px] font-medium capitalize transition-colors text-center"
                                style={mode === m
                                  ? m === 'bear'   ? { background: 'rgba(255,159,10,0.15)', color: '#FF9F0A', fontWeight: 600 }
                                  : m === 'bull'   ? { background: 'rgba(52,199,89,0.15)',  color: '#34C759', fontWeight: 600 }
                                  :                  { background: 'var(--bg-tertiary)',      color: 'var(--text-primary)', fontWeight: 600 }
                                  : { background: 'transparent', color: 'var(--text-faint)' }}>
                                {m === 'bear' ? 'Bear' : m === 'normal' ? 'Normal' : 'Bull'}
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                      <button onClick={() => setShowQuartersInfo(true)}
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}>
                        i
                      </button>
                      {alloc?.category === 'Hospitals' && (
                        <label className="flex items-center gap-1.5 cursor-pointer text-[13px]"
                               style={{ color: 'var(--text-2)' }}>
                          <input type="checkbox"
                            checked={alloc.is_hospital_ramp_phase}
                            onChange={async e => {
                              const sb = getSupabaseBrowser()
                              const updated = { ...alloc, is_hospital_ramp_phase: e.target.checked }
                              await sb.from('stock_allocations').update({ is_hospital_ramp_phase: e.target.checked }).eq('id', alloc.id)
                              setAllocState(prev => prev.map(a => a.id === alloc.id ? updated : a))
                            }}
                            className="w-4 h-4 rounded accent-blue-400"
                          />
                          Ramp Phase
                        </label>
                      )}
                    </div>

                  </div>

                  {/* Tranches */}
                  <TrancheSection
                    symbol={row.symbol}
                    tranches={stockTranches}
                    remaining={row.remaining}
                    hasBands={hasBands}
                    onToggle={toggleTranche}
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

// ── Band Bar ──────────────────────────────────────────────────────────────────

function BandBar({ buyLow, buyHigh, midLow, midHigh, trimPrice, cmp }: {
  buyLow: number; buyHigh: number
  midLow: number; midHigh: number
  trimPrice: number; cmp: number | null
}) {
  const min = buyLow * 0.9
  const max = trimPrice * 1.15
  const range = max - min

  function pct(v: number) { return ((v - min) / range) * 100 }

  const buyWidth = pct(buyHigh) - pct(buyLow)
  const midWidth = pct(midHigh) - pct(midLow)
  const trimWidth = 100 - pct(trimPrice)
  const cmpPct = cmp ? pct(cmp) : null

  return (
    <div>
      {/* Bar */}
      <div className="relative h-7 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-tertiary)' }}>
        {/* Deep value zone (below buyLow) */}
        <div className="h-full flex items-center justify-center"
             style={{ width: `${pct(buyLow)}%`, background: 'rgba(4,120,87,0.28)' }}>
          {pct(buyLow) > 8 && (
            <span className="text-[10px] font-semibold truncate px-1" style={{ color: '#34d399' }}>DEEP</span>
          )}
        </div>
        <div className="h-full flex items-center justify-center"
             style={{ width: `${buyWidth}%`, background: 'rgba(34,197,94,0.35)' }}>
          <span className="text-[10px] font-semibold text-green-500 truncate px-1">BUY</span>
        </div>
        {/* Mid zone */}
        <div className="h-full flex items-center justify-center"
             style={{ width: `${midWidth}%`, background: 'rgba(249,115,22,0.30)' }}>
          <span className="text-[10px] font-semibold text-orange-400 truncate px-1">MID</span>
        </div>
        {/* Trim zone */}
        <div className="h-full flex items-center justify-center flex-1"
             style={{ background: 'rgba(239,68,68,0.25)' }}>
          <span className="text-[10px] font-semibold text-red-400 truncate px-1">TRIM</span>
        </div>

        {/* CMP pin */}
        {cmpPct !== null && cmpPct >= 0 && cmpPct <= 100 && (
          <div className="absolute top-0 bottom-0 w-0.5 rounded-full"
               style={{ left: `${cmpPct}%`, background: 'var(--text-primary)' }} />
        )}
      </div>

      {/* Values row */}
      <div className="flex justify-between mt-2 text-[11px] tabnum">
        <div className="text-center">
          <p className="font-semibold" style={{ color: '#34d399' }}>&lt;₹{Math.round(buyLow)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Deep</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-green-500">₹{Math.round(buyLow)}–{Math.round(buyHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Buy</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-orange-400">₹{Math.round(midLow)}–{Math.round(midHigh)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Mid / Hold</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-red-400">≥₹{Math.round(trimPrice)}</p>
          <p style={{ color: 'var(--text-faint)' }}>Trim</p>
        </div>
      </div>
      {cmp && (
        <p className="text-center text-[11px] mt-1 tabnum" style={{ color: 'var(--text-muted)' }}>
          CMP ₹{Math.round(cmp).toLocaleString('en-IN')}
        </p>
      )}
    </div>
  )
}

// ── Tranche section ───────────────────────────────────────────────────────────

function TrancheSection({
  symbol, tranches, remaining, hasBands,
  onToggle, onAdd, onDelete, onUpdate, onGenerate, onClear, generating,
}: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  hasBands: boolean
  onToggle: (id: string, allocated: boolean) => void
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
  onUpdate: (id: string, qty: number, price: number) => Promise<void>
  onGenerate: () => void
  onClear: () => Promise<void>
  generating: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const plannedTotal = tranches.reduce((s, t) => s + t.qty * t.price, 0)

  return (
    <div className="border-t" style={{ borderColor: 'var(--border-faint)', padding: '6px 4px 4px 4px' }}>
      {/* Header: TRANCHES label left, ₹X / ₹Y Allocated right */}
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>Tranches</p>
        <span className="text-[11px] tabnum" style={{ color: 'var(--text-muted)' }}>
          {formatINR(plannedTotal)} / {formatINR(remaining)} Allocated
        </span>
      </div>

      {/* 3-button bar */}
      <div className="flex gap-1.5 px-2 mb-2">
        <button
          onClick={onGenerate}
          disabled={!hasBands || generating}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
          style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${generating ? 'spin' : ''}`} />
          {generating ? '…' : 'Generate'}
        </button>
        <button
          onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <PlusIcon className="w-3.5 h-3.5" />
          Add
        </button>
        <button
          onClick={() => onClear()}
          disabled={tranches.length === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[14px] font-medium disabled:opacity-40"
          style={{ background: 'rgba(255,59,48,0.10)', color: '#FF3B30', border: '1px solid rgba(255,59,48,0.20)' }}>
          <XIcon className="w-3.5 h-3.5" />
          Clear All
        </button>
      </div>

      {/* Tranche list */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
        {editingId === 'new' && (
          <TrancheInputRow
            onSave={async (qty, price) => { await onAdd(symbol, qty, price); setEditingId(null) }}
            onCancel={() => setEditingId(null)}
          />
        )}
        {tranches.map(t =>
          editingId === t.id
            ? <TrancheInputRow
                key={t.id}
                initialQty={String(Math.round(t.qty))}
                initialPrice={String(t.price)}
                onSave={async (qty, price) => { await onUpdate(t.id, qty, price); setEditingId(null) }}
                onDelete={() => { onDelete(t.id); setEditingId(null) }}
                onCancel={() => setEditingId(null)}
              />
            : <TrancheRow key={t.id} tranche={t} onToggle={onToggle} onEdit={() => setEditingId(editingId === t.id ? null : t.id)} />
        )}
        {tranches.length === 0 && editingId !== 'new' && (
          <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>No tranches yet — tap Add</p>
        )}
      </div>
    </div>
  )
}

function TrancheInputRow({ initialQty = '', initialPrice = '', onSave, onDelete, onCancel }: {
  initialQty?: string
  initialPrice?: string
  onSave: (qty: number, price: number) => Promise<void>
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [qty, setQty] = useState(initialQty)
  const [price, setPrice] = useState(initialPrice)
  const [saving, setSaving] = useState(false)

  async function save() {
    const q = parseFloat(qty), p = parseFloat(price)
    if (!q || !p) return
    setSaving(true)
    await onSave(q, p)
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-1.5 p-2 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <input type="text" inputMode="numeric" placeholder="Qty" value={qty}
        onChange={e => setQty(e.target.value)}
        style={{ width: 80, padding: '8px', borderRadius: 10, fontSize: 14, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
      <span style={{ fontSize: 12, color: 'var(--text-faint)', flexShrink: 0 }}>×</span>
      <input type="text" inputMode="decimal" placeholder="Price ₹" value={price}
        onChange={e => setPrice(e.target.value)}
        style={{ width: 150, padding: '8px', borderRadius: 10, fontSize: 14, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
        <button onClick={save} disabled={saving || !qty || !price}
          style={{ width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer', opacity: (saving || !qty || !price) ? 0.4 : 1 }}>
          <SaveIcon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
        </button>
        {onDelete && (
          <button onClick={onDelete}
            style={{ width: 50, height: 50, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <TrashIcon className="w-5 h-5" style={{ color: 'var(--text-2)' }} />
          </button>
        )}
      </div>
    </div>
  )
}

function TrancheRow({ tranche, onToggle, onEdit }: {
  tranche: BuyTranche
  onToggle: (id: string, allocated: boolean) => void
  onEdit: () => void
}) {
  const amount = tranche.qty * tranche.price
  return (
    <div className="flex items-center px-4 py-4 gap-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <button onClick={() => onToggle(tranche.id, !tranche.allocated)}
        className="w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
        style={tranche.allocated ? { background: '#30D158', borderColor: '#30D158' } : { background: 'transparent', borderColor: 'var(--border)' }}>
        {tranche.allocated && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
      </button>
      <p className="flex-1 text-[13px] tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-2)', textDecoration: tranche.allocated ? 'line-through' : 'none' }}>
        {Math.round(tranche.qty)} × ₹{tranche.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>
      <p className="text-[13px] font-semibold tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-primary)' }}>
        {formatINR(amount)}
      </p>
      <button onClick={onEdit} className="flex-shrink-0 p-2.5" style={{ color: 'var(--text-faint)' }}>
        <PencilIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Quarters Info Sheet ───────────────────────────────────────────────────────

function QuartersInfoSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-[28px]"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="font-semibold text-[17px]">Recent Quarters</p>
          <button onClick={onClose} className="text-[#0A84FF] text-[17px] w-14 text-right">Done</button>
        </div>

        <div className="px-5 pt-4 space-y-4">
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Adjusts band prices based on the last 2 quarters of reported results.
          </p>

          {[
            {
              mode: 'Bear',
              desc: 'Recent results have been soft. All band prices tighten by 10% — you demand a larger margin of safety before buying.',
            },
            {
              mode: 'Normal',
              desc: 'Base case. Standard multiples apply. Use this when recent quarters are in line with expectations.',
            },
            {
              mode: 'Bull',
              desc: 'Recent results have been strong. Premium multiples apply for eligible categories (Cap-Light Infra), reflecting improved earnings quality.',
            },
          ].map(({ mode, desc }) => (
            <div key={mode} className="rounded-2xl p-3.5"
                 style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
              <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{mode}</p>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>{desc}</p>
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
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up rounded-t-[28px]"
           style={{ background: 'var(--bg-secondary)', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="text-[#0A84FF] text-[17px]">Cancel</button>
          <p className="font-semibold text-[17px]">AI API Key</p>
          <button onClick={save} disabled={saving || !key.trim()}
            className="text-[#0A84FF] text-[17px] font-semibold disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="px-5 pt-4 space-y-4">
          {/* Provider selector */}
          <div className="flex rounded-2xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['gemini', 'claude'] as const).map(p => (
              <button key={p} type="button" onClick={() => { setProvider(p); setKey(''); setError('') }}
                className="flex-1 py-3 text-[14px] font-medium transition-colors"
                style={provider === p
                  ? { background: '#0A84FF', color: '#fff' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {p === 'gemini' ? 'Google Gemini' : 'Claude'}
              </button>
            ))}
          </div>

          {provider === 'gemini' && (
            <p className="text-[12px] text-center" style={{ color: '#34C759' }}>
              ★ Recommended — best accuracy for live financial data
            </p>
          )}

          <input
            type="password"
            placeholder={placeholder}
            value={key}
            onChange={e => setKey(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl text-[17px] outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            autoFocus
          />

          {error && <p className="text-red-400 text-[13px]">{error}</p>}

          <div className="rounded-2xl p-3.5"
               style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.18)' }}>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              <span className="font-semibold" style={{ color: '#0A84FF' }}>Stored securely.</span>{' '}
              Your API key lives in your database (Supabase) and is locked to your login via row-level security.
              Band generation runs entirely on the server — your browser never sees the key again after you save it.
              Only your session can retrieve it, and only to call the AI provider.
            </p>
          </div>

          <p className="text-[13px] text-center" style={{ color: 'var(--text-muted)' }}>
            Get a key at{' '}
            <span style={{ color: '#0A84FF' }}>{keyLink}</span>
          </p>
        </div>
      </div>
    </>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="12" height="2" rx="1"/>
      <rect x="2" y="6" width="9" height="2" rx="1"/>
      <rect x="2" y="10" width="11" height="2" rx="1"/>
      <rect x="2" y="14" width="7" height="2" rx="1"/>
    </svg>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function SaveIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function TrashIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
