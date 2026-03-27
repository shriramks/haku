'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, computeTrancheprices, CATEGORIES_WITHOUT_QUARTERS } from '@/lib/band-calculator'
import { BandSignalBadge } from '@/components/SignalBadge'
import { formatINR } from '@/lib/formatter'
import type { StockCategory, FiscalYear, StockAllocation, Transaction, BuyBand, BuyTranche } from '@/lib/types'
import TrancheSection from '@/components/TrancheSection'
import BandBar from '@/components/BandBar'
import { getStockName } from '@/lib/stock-names'
import CmpBadge from '@/components/CmpBadge'
import QuartersToggle from '@/components/QuartersToggle'
import { RefreshIcon, SparkleIcon, PencilIcon } from '@/components/icons'

interface Props {
  symbol: string
  fiscalYear: FiscalYear | null
  allocation: StockAllocation | null
  transactions: Transaction[]
  allTransactions: Transaction[]
  allFYBudget: number
  carryoverInr: number
  band: BuyBand | null
  userId: string
}

export default function StockDetailClient({
  symbol, fiscalYear, allocation, transactions, allTransactions, allFYBudget, carryoverInr,
  band: initialBand, userId,
}: Props) {
  const router = useRouter()
  const [band, setBand]                     = useState(initialBand)
  const [allocState, setAllocState]         = useState(allocation)
  const [tranches, setTranches]             = useState<BuyTranche[]>([])
  const [refreshing, setRefreshing]         = useState(false)
  const [showFinancials, setShowFinancials] = useState(false)
  const [generatingTranches, setGeneratingTranches] = useState(false)

  // Fetch tranches on mount
  useEffect(() => {
    if (!fiscalYear?.id) return
    getSupabaseBrowser()
      .from('buy_tranches')
      .select('*')
      .eq('symbol', symbol)
      .eq('fy_id', fiscalYear.id)
      .order('sort_order')
      .then(({ data }) => { if (data) setTranches(data) })
  }, [symbol, fiscalYear?.id])

  // ── FY spend calculations ────────────────────────────────────────────────────
  const fyTxns = fiscalYear
    ? transactions.filter(t => t.advance_fy_id == null || t.advance_fy_id === fiscalYear.id)
    : transactions
  const buys          = fyTxns.filter(t => t.trade_type === 'buy')
  const sells         = fyTxns.filter(t => t.trade_type === 'sell')
  const totalBought   = buys.reduce((s, t) => s + t.quantity, 0)
  const totalBuyValue = buys.reduce((s, t) => s + t.amount, 0)
  const totalSold     = sells.reduce((s, t) => s + t.quantity, 0)
  const qty           = Math.max(0, totalBought - totalSold)
  const avgCost       = totalBought > 0 ? totalBuyValue / totalBought : 0
  const spent         = totalBuyValue - sells.reduce((s, t) => s + t.amount, 0)

  const budget    = allocation && fiscalYear
    ? (allocation.allocation_pct / 100) * (fiscalYear.total_budget_inr + (fiscalYear.unallocated_carryover_inr ?? 0)) + carryoverInr
    : 0
  const remaining = budget - spent

  // All-FY aggregates
  const allFYBuys  = allTransactions.filter(t => t.trade_type === 'buy').reduce((s, t) => s + t.amount, 0)
  const allFYSells = allTransactions.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0)
  const allFYSpent = allFYBuys - allFYSells

  // ── Band computations ────────────────────────────────────────────────────────
  const computed = (band && allocState) ? calculateBands({
    category:          allocState.category as StockCategory,
    twoWeakQuarters:   allocState.two_weak_quarters,
    twoStrongQuarters: allocState.two_strong_quarters,
    eps: band.eps,
  }) : null

  const buyLow    = computed?.buyLow    ?? band?.buy_low    ?? null
  const buyHigh   = computed?.buyHigh   ?? band?.buy_high   ?? null
  const midLow    = computed?.midLow    ?? band?.mid_low    ?? null
  const midHigh   = computed?.midHigh   ?? band?.mid_high   ?? null
  const trimPrice = computed?.trimPrice ?? band?.trim_price ?? null
  const cmp       = band?.manual_cmp    ?? null
  const hasBands  = buyLow != null && trimPrice != null
  const signal = (cmp === null || buyLow === null || trimPrice === null) ? 'unknown'
    : cmp < buyLow               ? 'deep'
    : cmp <= (buyHigh ?? trimPrice) ? 'buy'
    : cmp <= (midHigh ?? trimPrice) ? 'hold'
    : 'trim'

  // ── CMP refresh ─────────────────────────────────────────────────────────────
  async function refreshCMP() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error('fetch failed')
      const { price } = await res.json()
      const sb = getSupabaseBrowser()
      if (band) {
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        setBand(prev => prev ? { ...prev, manual_cmp: price } : prev)
      } else {
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          const { data } = await sb.from('buy_bands').insert({
            user_id: user.id, symbol, anchor_type: 'PE', manual_cmp: price, is_current: true,
          }).select().single()
          if (data) setBand(data)
        }
      }
    } catch { /* silently fail */ }
    setRefreshing(false)
  }

  // ── Bear / Normal / Bull toggle ──────────────────────────────────────────────
  async function toggleQuarters(field: 'two_weak_quarters' | 'two_strong_quarters', value: boolean) {
    if (!allocState) return
    const patch: Record<string, boolean> = { [field]: value }
    if (value) patch[field === 'two_weak_quarters' ? 'two_strong_quarters' : 'two_weak_quarters'] = false
    const updated = { ...allocState, ...patch }
    setAllocState(updated)

    if (band && band.eps) {
      const result = calculateBands({
        category: updated.category as StockCategory,
        twoWeakQuarters:   updated.two_weak_quarters,
        twoStrongQuarters: updated.two_strong_quarters,
        eps: band.eps,
      })
      if (result) {
        setBand(prev => prev ? {
          ...prev,
          buy_low: result.buyLow, buy_high: result.buyHigh,
          mid_low: result.midLow, mid_high: result.midHigh,
          trim_price: result.trimPrice,
        } : prev)
        const sb = getSupabaseBrowser()
        await Promise.all([
          sb.from('stock_allocations').update(patch).eq('id', allocState.id),
          sb.from('buy_bands').update({
            buy_low: result.buyLow, buy_high: result.buyHigh,
            mid_low: result.midLow, mid_high: result.midHigh,
            trim_price: result.trimPrice,
            last_updated_at: new Date().toISOString(),
          }).eq('symbol', symbol).eq('is_current', true),
        ])
        return
      }
    }
    getSupabaseBrowser().from('stock_allocations').update(patch).eq('id', allocState.id)
  }

  // ── Tranche operations ───────────────────────────────────────────────────────
  async function toggleTranche(id: string, allocated: boolean) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, allocated } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ allocated }).eq('id', id)
  }

  async function addTranche(sym: string, qty: number, price: number) {
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const existing = tranches.filter(t => t.symbol === sym)
    const { data } = await sb.from('buy_tranches').insert({
      user_id: user.id, symbol: sym, qty, price, allocated: false,
      sort_order: existing.length + 1, fy_id: fiscalYear?.id ?? '',
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

  async function clearTranches() {
    const fyId = fiscalYear?.id ?? ''
    await getSupabaseBrowser().from('buy_tranches').delete().eq('symbol', symbol).eq('fy_id', fyId)
    setTranches([])
  }

  async function generateTranches() {
    if (!fiscalYear?.id) return
    setGeneratingTranches(true)
    try {
      const res = await fetch(`/api/tranches/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId: fiscalYear.id, remainingInr: remaining, userLiquidInr: fiscalYear.deploy_capital_inr ?? undefined }),
      })
      const json = await res.json()
      if (res.ok && json.tranches?.length > 0) {
        setTranches(prev => [...prev.filter(t => t.symbol !== symbol), ...json.tranches])
      }
    } catch { /* silently fail */ }
    setGeneratingTranches(false)
  }

  const fyLabel = fiscalYear?.label ?? 'This FY'

  return (
    <div style={{ minHeight: '100dvh' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 backdrop-blur-xl border-b px-4 pb-3"
        style={{
          background: 'var(--bg-nav)',
          borderColor: 'var(--border)',
          paddingTop: 'max(env(safe-area-inset-top,0px), 16px)',
        }}>
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-0.5 p-3 -ml-3 flex-shrink-0"
            style={{ color: 'var(--text-muted)', minHeight: 44, minWidth: 44 }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 pt-1">
            <div className="flex items-center gap-2">
              <h1 className="text-title-1 font-bold" style={{ color: 'var(--text-primary)' }}>{symbol}</h1>
              <BandSignalBadge signal={signal} />
            </div>
            {getStockName(symbol) && (
              <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>{getStockName(symbol)}</p>
            )}
          </div>
        </div>
      </div>

      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

        {/* ── Band bar + CMP ────────────────────────────────────────────────── */}
        <div className="px-4 pt-4 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
          {hasBands ? (
            <BandBar
              buyLow={buyLow!} buyHigh={buyHigh!}
              midLow={midLow!} midHigh={midHigh!}
              trimPrice={trimPrice!} cmp={cmp}
            />
          ) : (
            <div className="h-7 rounded-lg flex items-center px-3" style={{ background: 'var(--bg-tertiary)' }}>
              <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>
                No bands yet — set financials to generate
              </p>
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            <div>
              {cmp != null ? (
                <p className={`text-title-1 font-bold tabnum ${signal === 'buy' ? 'cmp-color-buy' : signal === 'deep' ? 'cmp-color-deep' : ''}`}
                   style={signal === 'buy' || signal === 'deep' ? undefined : { color: 'var(--text-primary)' }}>
                  ₹{Math.round(cmp)}
                </p>
              ) : (
                <p className="text-title-1 font-bold tabnum" style={{ color: 'var(--text-primary)' }}>—</p>
              )}
              <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>CMP</p>
            </div>
            <button
              onClick={refreshCMP}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 rounded-xl text-subheadline font-medium disabled:opacity-40"
              style={{
                minHeight: 44,
                background: 'var(--bg-secondary)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}>
              <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Bear / Normal / Bull ─────────────────────────────────────────────── */}
        {allocState && !CATEGORIES_WITHOUT_QUARTERS.has(allocState.category as StockCategory) && (
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-faint)' }}>
            <QuartersToggle
              twoWeakQuarters={allocState.two_weak_quarters}
              twoStrongQuarters={allocState.two_strong_quarters}
              onChange={(field, value) => toggleQuarters(field, value)}
            />
          </div>
        )}

        {/* ── FY Allocation ────────────────────────────────────────────────── */}
        <SectionHeader title={`${fyLabel} Allocation`} />
        <DetailRow
          label="Remaining"
          value={formatINR(Math.abs(remaining))}
          valueColor={remaining < 0 ? 'text-negative' : 'text-positive'}
          prefix={remaining < 0 ? '−' : undefined}
        />
        <DetailRow label="Allocated" value={formatINR(spent)} />
        <DetailRow label="Total Allocation" value={formatINR(budget)} muted />
        {carryoverInr !== 0 && (
          <DetailRow
            label="Carryover"
            value={`${carryoverInr > 0 ? '+' : '−'}${formatINR(Math.abs(carryoverInr))}`}
            valueColor={carryoverInr > 0 ? 'text-positive' : 'text-negative'}
          />
        )}

        {/* ── All-Time ─────────────────────────────────────────────────────── */}
        <SectionHeader title="All-Time" />
        <DetailRow
          label="Remaining"
          value={formatINR(Math.abs(allFYBudget - allFYSpent))}
          valueColor={allFYBudget - allFYSpent < 0 ? 'text-negative' : 'text-positive'}
          prefix={allFYBudget - allFYSpent < 0 ? '−' : undefined}
        />
        <DetailRow label="Allocated" value={formatINR(allFYSpent)} />
        <DetailRow label="Total Allocation" value={formatINR(allFYBudget)} muted />

        {/* ── Position ─────────────────────────────────────────────────────── */}
        {qty > 0 && (
          <>
            <SectionHeader title="Position" />
            <DetailRow label="Shares" value={Math.round(qty).toLocaleString('en-IN')} />
            <DetailRow label="Avg Cost" value={avgCost > 0 ? `₹${Math.round(avgCost).toLocaleString('en-IN')}` : '—'} />
          </>
        )}

        {/* ── Tranches ─────────────────────────────────────────────────────── */}
        <TrancheSection
          symbol={symbol}
          tranches={tranches}
          remaining={remaining}
          budget={budget}
          hasBands={hasBands}
          onToggle={toggleTranche}
          onAdd={addTranche}
          onDelete={deleteTranche}
          onUpdate={updateTranche}
          onGenerate={generateTranches}
          onClear={clearTranches}
          generating={generatingTranches}
        />

        {/* ── Financials edit ───────────────────────────────────────────────── */}
        <div className="border-t" style={{ borderColor: 'var(--border-faint)' }}>
          <button
            onClick={() => setShowFinancials(true)}
            className="flex items-center justify-between w-full px-4"
            style={{ minHeight: 44 }}>
            <span className="text-body" style={{ color: 'var(--text-2)' }}>Financials</span>
            <span className="text-body text-accent">Edit ›</span>
          </button>
        </div>

      </div>

      {/* ── Financials bottom sheet ───────────────────────────────────────── */}
      {showFinancials && (
        <FinancialsSheet
          symbol={symbol}
          band={band}
          allocation={allocation}
          fyId={fiscalYear?.id ?? ''}
          onBandSaved={b => { setBand(b); setShowFinancials(false) }}
          onClose={() => setShowFinancials(false)}
        />
      )}
    </div>
  )
}

// ── Detail row (label left, value right) ─────────────────────────────────────

function DetailRow({ label, value, valueColor, muted, prefix }: {
  label: string
  value: string
  valueColor?: string
  muted?: boolean
  prefix?: string
}) {
  return (
    <div
      className="flex items-center justify-between px-4 border-b"
      style={{ borderColor: 'var(--border-faint)', minHeight: 44 }}>
      <span className="text-body" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span
        className={`text-headline font-semibold tabnum ${valueColor ?? ''}`}
        style={valueColor ? undefined : { color: muted ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {prefix}{value}
      </span>
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <span
        className="text-footnote font-semibold uppercase tracking-widest"
        style={{ color: 'var(--text-faint)' }}>
        {title}
      </span>
    </div>
  )
}

// ── Financials bottom sheet ───────────────────────────────────────────────────

function FinancialsSheet({ symbol, band, allocation, fyId, onBandSaved, onClose }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyId: string
  onBandSaved: (b: BuyBand) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl animate-slide-up overflow-hidden"
        style={{
          background: 'var(--bg-secondary)',
          paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)',
        }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--bg-tertiary)' }} />
        </div>
        {/* Sheet header */}
        <div
          className="flex items-center justify-between px-5 pt-2 pb-3 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="w-14" />
          <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Financials</p>
          <button
            onClick={onClose}
            className="text-accent text-body w-14 text-right"
            style={{ minHeight: 44 }}>
            Done
          </button>
        </div>
        {/* Content */}
        <div className="overflow-y-auto px-5 pt-4" style={{ maxHeight: '70vh' }}>
          <FinancialsCard
            symbol={symbol}
            band={band}
            allocation={allocation}
            fyId={fyId}
            hasKey={null}
            onBandSaved={onBandSaved}
            onTranchesUpdated={() => {}}
          />
        </div>
      </div>
    </>
  )
}

// ── Financials card ───────────────────────────────────────────────────────────

function FinancialsCard({ symbol, band, allocation, fyId, hasKey: hasKeyProp, onBandSaved, onTranchesUpdated }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyId: string
  hasKey: boolean | null
  onBandSaved: (b: BuyBand) => void
  onTranchesUpdated: (t: BuyTranche[]) => void
}) {
  const [hasKey, setHasKey] = useState(hasKeyProp)
  useEffect(() => {
    if (hasKeyProp !== null) { setHasKey(hasKeyProp); return }
    fetch('/api/settings/gemini-key')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false))
  }, [hasKeyProp])

  const anchor = 'PE'

  const category = allocation?.category

  const [editing, setEditing]   = useState(false)
  const [generating, setGen]    = useState(false)
  const [genError, setGenError] = useState('')
  const [saving, setSaving]     = useState(false)

  const [eps,    setEps]    = useState(band?.eps?.toString()            ?? '')
  const [bvps,   setBvps]   = useState(band?.bvps?.toString()           ?? '')
  const [ebitda, setEbitda] = useState(band?.ebitda?.toString()         ?? '')
  const [netDebt,setNetDebt]= useState(band?.net_debt?.toString()       ?? '')
  const [shares, setShares] = useState(band?.shares?.toString()         ?? '')
  const [ev,     setEv]     = useState(band?.embedded_value?.toString() ?? '')

  async function generate() {
    if (!hasKey) { setGenError('No AI key set — add one in Settings (person icon)'); return }
    setGen(true)
    setGenError('')
    try {
      const res = await fetch(`/api/bands/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setGenError(json.error ?? 'Generation failed')
      } else {
        if (json.band) {
          onBandSaved(json.band)
          setEps(json.band.eps?.toString()           ?? '')
          setBvps(json.band.bvps?.toString()         ?? '')
          setEbitda(json.band.ebitda?.toString()     ?? '')
          setNetDebt(json.band.net_debt?.toString()  ?? '')
          setShares(json.band.shares?.toString()     ?? '')
          setEv(json.band.embedded_value?.toString() ?? '')
        }
        if (json.tranches?.length > 0) onTranchesUpdated(json.tranches)
      }
    } catch {
      setGenError('Network error')
    }
    setGen(false)
  }

  async function save() {
    setSaving(true)
    const sb = getSupabaseBrowser()
    const fields = {
      eps:            parseFloat(eps)     || null,
      bvps:           parseFloat(bvps)    || null,
      ebitda:         parseFloat(ebitda)  || null,
      net_debt:       parseFloat(netDebt) || null,
      shares:         parseFloat(shares)  || null,
      embedded_value: parseFloat(ev)      || null,
      last_updated_at: new Date().toISOString(),
    }

    let savedBand: BuyBand | null = null
    if (band) {
      const { data } = await sb.from('buy_bands').update(fields).eq('id', band.id).select().single()
      savedBand = data
    } else {
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data } = await sb.from('buy_bands').insert({
          user_id: user.id, symbol, anchor_type: 'PE', is_current: true, ...fields,
        }).select().single()
        savedBand = data
      }
    }
    if (savedBand) onBandSaved(savedBand)
    setSaving(false)
    setEditing(false)
  }

  const hasData = !!(band?.eps || band?.bvps || band?.ebitda || band?.embedded_value)

  return (
    <>
      {/* Generate button */}
      <button
        onClick={generate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-3 rounded-xl w-full mb-4 text-body font-medium disabled:opacity-40"
        style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
        <SparkleIcon className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
        {generating ? 'Generating…' : 'Generate from AI'}
      </button>

      {genError && <p className="text-subheadline text-negative mb-3">{genError}</p>}

      {editing ? (
        <>
          <p className="text-subheadline mb-3" style={{ color: 'var(--text-faint)' }}>
            {category ? `${category} · ` : ''}PE
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-subheadline" style={{ color: 'var(--text-muted)' }}>EPS (₹)</label>
              <input type="number" inputMode="decimal" placeholder="e.g. 18" value={eps}
                onChange={e => setEps(e.target.value)}
                className="w-full px-3.5 py-3.5 rounded-xl text-headline tabnum outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
            </div>
          </div>
          <button onClick={save} disabled={saving}
            className="w-full mt-4 py-4 rounded-xl text-headline font-semibold disabled:opacity-40"
            style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)}
            className="w-full mt-2 py-3 rounded-xl text-body"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
        </>
      ) : hasData ? (
        <>
          <div className="grid grid-cols-2 gap-y-4 gap-x-4 mb-4">
            {band?.eps            && <InputRow k="EPS"            v={`₹${band.eps}`} />}
            {band?.bvps           && <InputRow k="BVPS"           v={`₹${band.bvps}`} />}
            {band?.ebitda         && <InputRow k="EBITDA"         v={`${band.ebitda} Cr`} />}
            {band?.net_debt       && <InputRow k="Net Debt"       v={`${band.net_debt} Cr`} />}
            {band?.shares         && <InputRow k="Shares"         v={`${band.shares} Cr`} />}
            {band?.embedded_value && <InputRow k="Embedded Value" v={`${band.embedded_value} Cr`} />}
          </div>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-4 py-3 rounded-xl w-full text-body"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <PencilIcon className="w-4 h-4" />
            Edit values
          </button>
        </>
      ) : (
        <>
          <p className="text-subheadline mb-4" style={{ color: 'var(--text-faint)' }}>
            No data — tap Generate to auto-fill, or Edit to enter manually
          </p>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-2 px-4 py-3 rounded-xl w-full text-body"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <PencilIcon className="w-4 h-4" />
            Enter manually
          </button>
        </>
      )}
    </>
  )
}

function InputRow({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-subheadline" style={{ color: 'var(--text-muted)' }}>{k}</p>
      <p className="font-semibold tabnum text-body" style={{ color: 'var(--text-primary)' }}>{v}</p>
    </div>
  )
}

