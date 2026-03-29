'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices, computeTrancheAmounts, CATEGORIES_WITHOUT_QUARTERS } from '@/lib/band-calculator'
import { formatINR } from '@/lib/formatter'
import type { StockRow, BuyBand, BuyTranche, StockAllocation, StockCategory, FiscalYear } from '@/lib/types'
import { getBandSignal } from '@/lib/compute'
import TrancheSection from '@/components/TrancheSection'
import BandBar from '@/components/BandBar'
import FYPicker from '@/components/FYPicker'
import UserMenu from '@/components/UserMenu'
import { getStockName } from '@/lib/stock-names'
import CmpBadge from '@/components/CmpBadge'
import QuartersToggle from '@/components/QuartersToggle'
import { RefreshIcon, SparkleIcon, ChevronDownIcon } from '@/components/icons'

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
  const [hasKey, setHasKey]               = useState(initialHasKey)
  const [aiProvider, setAiProvider]       = useState(initialAiProvider)
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const [showQuartersInfo, setShowQuartersInfo] = useState(false)
  const [userId, setUserId]               = useState<string | null>(null)

  useEffect(() => {
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
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
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

        // Conviction-weighted: sort highest→lowest, deeper tranches get more capital
        const sortedPrices = [...prices].sort((a, b) => b - a)
        const amounts = computeTrancheAmounts(deployable, sortedPrices.length)

        // ② Optimistic band + tranche update — instant UI
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
            sortedPrices.map((price, i) => {
              const amt = amounts[i] ?? 0
              return {
                user_id: userId, symbol, price,
                qty:       amt > 0 ? Math.max(1, Math.round(amt / price)) : 0,
                sort_order: i + 1, fy_id: fyId,
              }
            })
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
      // silently fail — tranches are non-critical
    }
    setGeneratingTranches(prev => ({ ...prev, [symbol]: false }))
  }

  // Pre-compute band calculations once per bands/allocState change — avoids calling calculateBands() in the render map
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
    <div style={{ flex: 1, overflowY: 'auto' }}>
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

          return (
            <div key={row.symbol}>
            <div className="border-b"
                 style={{ borderColor: 'var(--border-faint)', opacity: isDone ? 0.45 : 1 }}>
              {/* Collapsed header — always visible */}
              <div
                onClick={() => toggle(row.symbol)}
                className="w-full flex items-center gap-3 px-4 py-4 text-left tap-row cursor-pointer">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="font-bold text-headline" style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.symbol}</span>
                  {cmp != null && <CmpBadge cmp={cmp} signal={signal} />}

                </div>
                <div className="flex items-center gap-2">
                  {/* Bands button */}
                  <button
                    onClick={e => { e.stopPropagation(); generateBands(row.symbol) }}
                    disabled={generating[row.symbol]}
                    className="flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-subheadline font-medium disabled:opacity-40 text-accent"
                    style={{ background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.25)' }}>
                    <SparkleIcon className={`w-3.5 h-3.5 ${generating[row.symbol] ? 'spin' : ''}`} />
                    Bands
                  </button>
                  {/* CMP button */}
                  <button
                    onClick={e => { e.stopPropagation(); refreshCMP(row.symbol) }}
                    disabled={refreshing[row.symbol]}
                    className="flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-subheadline font-medium disabled:opacity-40"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                    <RefreshIcon className={`w-3.5 h-3.5 ${refreshing[row.symbol] ? 'spin' : ''}`} />
                    CMP
                  </button>
                  <span style={{ color: 'var(--text-faint)' }}>
                    <ChevronDownIcon className={`w-4 h-4 transition-transform ${isExp ? 'rotate-180' : ''}`} />
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
                      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>No bands yet</p>
                    </div>
                  )}
                  {genError[row.symbol] && (
                    <p className="px-4 pb-2 text-subheadline text-negative">{genError[row.symbol]}</p>
                  )}
                  {genWarning[row.symbol] && (
                    <p className="px-4 pb-2 text-subheadline" style={{ color: '#FF9500' }}>{genWarning[row.symbol]}</p>
                  )}

                  {/* Controls: Bear/Normal/Bull + ⓘ — hidden for index/commodity */}
                  {alloc && !CATEGORIES_WITHOUT_QUARTERS.has(alloc.category as StockCategory) && (
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center gap-2">
                      <QuartersToggle
                        twoWeakQuarters={alloc.two_weak_quarters}
                        twoStrongQuarters={alloc.two_strong_quarters}
                        onChange={(field, value) => toggleQuarters(row.symbol, field, value)}
                      />
                      <button onClick={() => setShowQuartersInfo(true)}
                        className="w-5 h-5 rounded-full flex items-center justify-center text-footnote font-semibold flex-shrink-0"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}>
                        i
                      </button>
                    </div>
                  </div>
                  )}

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


