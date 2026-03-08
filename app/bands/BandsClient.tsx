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
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [generating, setGenerating]             = useState<Record<string, boolean>>({})
  const [generatingAll, setGeneratingAll]       = useState(false)
  const [genError, setGenError]                 = useState<Record<string, string>>({})
  const [generatingTranches, setGeneratingTranches] = useState<Record<string, boolean>>({})
  const [hasKey, setHasKey]               = useState<boolean | null>(null)
  const [aiProvider, setAiProvider]       = useState<'gemini' | 'claude'>('gemini')
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)

  useEffect(() => {
    fetch('/api/settings/gemini-key')
      .then(r => r.json())
      .then(d => {
        setHasKey(d.hasKey ?? false)
        setAiProvider(d.provider ?? 'gemini')
      })
      .catch(() => setHasKey(false))
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
        }
        if (json.tranches?.length > 0) {
          setTranches(prev => [
            ...prev.filter(t => t.symbol !== symbol),
            ...json.tranches,
          ])
        }
      }
    } catch {
      setGenError(prev => ({ ...prev, [symbol]: 'Network error' }))
    }
    setGenerating(prev => ({ ...prev, [symbol]: false }))
  }

  async function generateAllBands() {
    if (!hasKey) { setShowKeyPrompt(true); return }
    setGeneratingAll(true)
    await Promise.all(rows.map(r => generateBands(r.symbol)))
    setGeneratingAll(false)
  }

  async function refreshAllCMPs() {
    setRefreshingAll(true)
    await Promise.all(rows.map(r => refreshCMP(r.symbol)))
    setRefreshingAll(false)
  }

  async function toggleQuarters(symbol: string, field: 'two_weak_quarters' | 'two_strong_quarters', value: boolean) {
    const alloc = allocState.find(a => a.symbol === symbol)
    if (!alloc) return
    const sb = getSupabaseBrowser()
    // Mutually exclusive: turning one on turns the other off
    const patch: Record<string, boolean> = { [field]: value }
    if (value) patch[field === 'two_weak_quarters' ? 'two_strong_quarters' : 'two_weak_quarters'] = false
    await sb.from('stock_allocations').update(patch).eq('id', alloc.id)
    const updated = { ...alloc, ...patch }
    setAllocState(prev => prev.map(a => a.symbol === symbol ? updated : a))

    const twoWeakQuarters   = field === 'two_weak_quarters'   ? value : (value ? false : alloc.two_weak_quarters)
    const twoStrongQuarters = field === 'two_strong_quarters' ? value : (value ? false : alloc.two_strong_quarters)

    // Recalculate bands if financial data exists
    const band = bands.find(b => b.symbol === symbol)
    if (band && (band.eps || band.bvps || band.ebitda)) {
      const result = calculateBands({
        category: alloc.category as StockCategory,
        twoWeakQuarters,
        twoStrongQuarters,
        isHospitalRampPhase: alloc.is_hospital_ramp_phase,
        eps: band.eps, bvps: band.bvps, ebitda: band.ebitda,
        netDebt: band.net_debt, shares: band.shares, embeddedValue: band.embedded_value,
      })
      if (result) {
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          // Mark old as not current
          await sb.from('buy_bands').update({ is_current: false }).eq('user_id', user.id).eq('symbol', symbol).eq('is_current', true)
          const now = new Date().toISOString()
          const { data } = await sb.from('buy_bands').insert({
            user_id: user.id, symbol,
            anchor_type: result.anchorUsed.startsWith('PE') ? 'PE' : result.anchorUsed.startsWith('PB') ? 'PB' : 'EV_EBITDA',
            eps: band.eps, bvps: band.bvps, ebitda: band.ebitda,
            net_debt: band.net_debt, shares: band.shares, embedded_value: band.embedded_value,
            buy_low: result.buyLow, buy_high: result.buyHigh,
            mid_low: result.midLow, mid_high: result.midHigh,
            trim_price: result.trimPrice,
            manual_cmp: band.manual_cmp,
            is_current: true, generated_at: now, last_updated_at: now,
          }).select().single()
          if (data) {
            setBands(prev => prev.map(b => b.symbol === symbol ? data : b))

            // Regenerate tranches client-side — no AI, all data already here
            const cmp       = band.manual_cmp ?? null
            const remaining = rows.find(r => r.symbol === symbol)?.remaining ?? 0
            const prices    = computeTrancheprices(result.buyLow, result.buyHigh, cmp)
            const amtPerTranche = prices.length > 0 ? remaining / prices.length : 0

            await sb.from('buy_tranches')
              .delete().eq('user_id', user.id).eq('symbol', symbol).eq('fy_id', fyId)

            const { data: newTranches } = await sb.from('buy_tranches').insert(
              prices.map((price, i) => ({
                user_id: user.id, symbol, price,
                qty:        amtPerTranche > 0 ? Math.max(1, Math.round(amtPerTranche / price)) : 0,
                allocated:  false,
                sort_order: i + 1,
                fy_id:      fyId,
              }))
            ).select()
            if (newTranches) {
              setTranches(prev => [...prev.filter(t => t.symbol !== symbol), ...newTranches])
            }
          }
        }
      }
    }
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

  return (
    <div>
      {showKeyPrompt && (
        <KeyPromptSheet
          initialProvider={aiProvider}
          onClose={() => setShowKeyPrompt(false)}
          onSaved={(provider) => { setHasKey(true); setAiProvider(provider) }}
        />
      )}

      {/* Header actions */}
      <div className="px-4 pt-3 pb-2 flex justify-end gap-2 flex-wrap items-center">
        <button
          onClick={generateAllBands}
          disabled={generatingAll || refreshingAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50"
          style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.3)' }}>
          <SparkleIcon className={`w-3.5 h-3.5 ${generatingAll ? 'spin' : ''}`} />
          {generatingAll ? 'Generating…' : 'Generate All Bands'}
        </button>
        <button
          onClick={refreshAllCMPs}
          disabled={refreshingAll || generatingAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${refreshingAll ? 'spin' : ''}`} />
          Refresh All CMPs
        </button>
      </div>

      {/* Two independent columns on md+ — avoids row-height coupling when expanding */}
      <div className="md:flex md:gap-3 md:px-4 md:pb-4">
        {[rows.filter((_, i) => i % 2 === 0), rows.filter((_, i) => i % 2 !== 0)].map((col, ci) => (
          <div key={ci} className="md:flex-1 md:space-y-3">
        {col.map(row => {
          const band      = bands.find(b => b.symbol === row.symbol)
          const alloc     = allocState.find(a => a.symbol === row.symbol)
          const isExp     = expanded.has(row.symbol)
          const isRefresh = refreshing[row.symbol]
          const stockTranches = tranches
            .filter(t => t.symbol === row.symbol)
            .sort((a, b) => a.sort_order - b.sort_order)

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

          return (
            <div key={row.symbol}
                 className="border-b md:border md:rounded-2xl md:overflow-hidden"
                 style={{ borderColor: 'var(--border-faint)' }}>
              {/* Collapsed header — always visible */}
              <button
                onClick={() => toggle(row.symbol)}
                className="w-full flex items-center gap-3 px-4 py-4 text-left tap-row">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[17px]">{row.symbol}</span>
                    {(() => {
                      const pending = stockTranches.filter(t => !t.allocated).length
                      if (pending > 0) return (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ background: 'rgba(10,132,255,0.15)', color: '#0A84FF' }}>
                          {pending} to buy
                        </span>
                      )
                      if (stockTranches.length > 0) return (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                              style={{ background: 'rgba(52,199,89,0.15)', color: '#34C759' }}>
                          Done
                        </span>
                      )
                      return null
                    })()}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {cmp ? (
                      <span className="text-[13px] tabnum" style={{ color: 'var(--text-2)' }}>
                        CMP ₹{Math.round(cmp).toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No CMP</span>
                    )}
                    {hasBands && (
                      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                        · Buy ₹{Math.round(buyLow!)}–{Math.round(buyHigh!)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-faint)' }}>
                    <ChevronIcon className={`w-4 h-4 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                  </span>
                </div>
              </button>

              {/* Expanded content */}
              {isExp && (
                <div className="border-t" style={{ borderColor: 'var(--border-faint)' }}>
                  {hasBands ? (
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

                  {/* Controls row */}
                  <div className="px-4 pb-3 flex items-center justify-between flex-wrap gap-2 mt-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      {alloc && (
                        <>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[13px]"
                                 style={{ color: 'var(--text-2)' }}>
                            <input type="checkbox"
                              checked={alloc.two_weak_quarters}
                              onChange={e => toggleQuarters(row.symbol, 'two_weak_quarters', e.target.checked)}
                              className="w-4 h-4 rounded accent-orange-400"
                            />
                            2 Weak Qtrs
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[13px]"
                                 style={{ color: 'var(--text-2)' }}>
                            <input type="checkbox"
                              checked={alloc.two_strong_quarters}
                              onChange={e => toggleQuarters(row.symbol, 'two_strong_quarters', e.target.checked)}
                              className="w-4 h-4 rounded accent-blue-400"
                            />
                            2 Strong Qtrs
                          </label>
                        </>
                      )}
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

                    {/* Per-stock buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => generateBands(row.symbol)}
                        disabled={generating[row.symbol]}
                        className="flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
                        <SparkleIcon className={`w-3.5 h-3.5 ${generating[row.symbol] ? 'spin' : ''}`} />
                        {generating[row.symbol] ? '…' : 'Bands'}
                      </button>
                      <button
                        onClick={() => refreshCMP(row.symbol)}
                        disabled={isRefresh}
                        className="flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ background: 'var(--border)', color: 'var(--text-2)' }}>
                        <RefreshIcon className={`w-3.5 h-3.5 ${isRefresh ? 'spin' : ''}`} />
                        {isRefresh ? '…' : 'CMP'}
                      </button>
                      {hasBands && (
                        <button
                          onClick={() => generateTranches(row.symbol)}
                          disabled={generatingTranches[row.symbol]}
                          className="flex items-center gap-1 text-[13px] px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                          style={{ background: 'rgba(52,199,89,0.10)', color: '#34C759', border: '1px solid rgba(52,199,89,0.25)' }}>
                          <SparkleIcon className={`w-3.5 h-3.5 ${generatingTranches[row.symbol] ? 'spin' : ''}`} />
                          {generatingTranches[row.symbol] ? '…' : 'Tranches'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tranches */}
                  <TrancheSection
                    symbol={row.symbol}
                    tranches={stockTranches}
                    remaining={row.remaining}
                    onToggle={toggleTranche}
                    onAdd={addTranche}
                    onDelete={deleteTranche}
                  />
                </div>
              )}
            </div>
          )
        })}
          </div>
        ))}
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
  symbol, tranches, remaining, onToggle, onAdd, onDelete,
}: {
  symbol: string
  tranches: BuyTranche[]
  remaining: number
  onToggle: (id: string, allocated: boolean) => void
  onAdd: (symbol: string, qty: number, price: number) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [qty, setQty]         = useState('')
  const [price, setPrice]     = useState('')
  const [adding, setAdding]   = useState(false)

  const pendingTotal = tranches.filter(t => !t.allocated).reduce((s, t) => s + t.qty * t.price, 0)

  async function submit() {
    if (!qty || !price) return
    setAdding(true)
    await onAdd(symbol, parseFloat(qty), parseFloat(price))
    setQty(''); setPrice(''); setShowAdd(false); setAdding(false)
  }

  return (
    <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border-faint)' }}>
      <div className="flex items-center justify-between mt-3 mb-2">
        <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-faint)' }}>
          Tranches
        </p>
        <div className="flex items-center gap-3">
          {pendingTotal > 0 && (
            <span className="text-[11px] tabnum" style={{ color: 'var(--text-muted)' }}>
              {formatINR(pendingTotal)} pending
            </span>
          )}
          <button onClick={() => setShowAdd(v => !v)} className="text-[#0A84FF] text-[13px]">
            {showAdd ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="flex gap-2 mb-2">
          <input type="number" inputMode="decimal" placeholder="Qty" value={qty}
            onChange={e => setQty(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-[14px] tabnum outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          <input type="number" inputMode="decimal" placeholder="Price ₹" value={price}
            onChange={e => setPrice(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl text-[14px] tabnum outline-none"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          <button onClick={submit} disabled={adding || !qty || !price}
            className="px-3 py-2 rounded-xl text-[14px] font-semibold text-[#0A84FF] disabled:opacity-40"
            style={{ background: 'rgba(10,132,255,0.15)' }}>
            {adding ? '…' : 'Add'}
          </button>
        </div>
      )}

      {tranches.length > 0 && (
        <div className="rounded-2xl divide-y overflow-hidden"
             style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-faint)' }}>
          {tranches.map(t => (
            <TrancheRow key={t.id} tranche={t} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </div>
      )}

      {tranches.length === 0 && !showAdd && (
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>No tranches — tap + Add to plan buys</p>
      )}
    </div>
  )
}

function TrancheRow({ tranche, onToggle, onDelete }: {
  tranche: BuyTranche
  onToggle: (id: string, allocated: boolean) => void
  onDelete: (id: string) => void
}) {
  const amount = tranche.qty * tranche.price
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>Remove tranche?</p>
        <div className="flex gap-4">
          <button onClick={() => setConfirming(false)} className="text-[#0A84FF] text-[13px]">Keep</button>
          <button onClick={() => onDelete(tranche.id)} className="text-red-400 text-[13px] font-semibold">Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center px-4 py-3 gap-3">
      <button
        onClick={() => onToggle(tranche.id, !tranche.allocated)}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors`}
        style={tranche.allocated
          ? { background: '#30D158', borderColor: '#30D158' }
          : { background: 'transparent', borderColor: 'var(--border)' }}>
        {tranche.allocated && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <p className="flex-1 text-[13px] tabnum"
         style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-2)',
                  textDecoration: tranche.allocated ? 'line-through' : 'none' }}>
        {Math.round(tranche.qty)} × ₹{tranche.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>

      <div className="flex items-center gap-3">
        <p className="text-[13px] font-semibold tabnum"
           style={{ color: tranche.allocated ? 'var(--text-faint)' : 'var(--text-primary)' }}>
          {formatINR(amount)}
        </p>
        <button onClick={() => setConfirming(true)} className="text-[20px] leading-none px-1"
                style={{ color: 'var(--text-faint)' }}>×</button>
      </div>
    </div>
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

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  )
}
