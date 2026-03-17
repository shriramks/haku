'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, getBandSignal, trancheSuggestion } from '@/lib/band-calculator'
import { BandSignalBadge, TradeTypeBadge, GateSignalIcon, InvestableBadge } from '@/components/SignalBadge'
import { formatINR, formatPnL, formatPct, formatDate } from '@/lib/formatter'
import { type StockCategory } from '@/lib/types'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, GateSignal, BuyTranche } from '@/lib/types'
import TrancheSection from '@/components/TrancheSection'
import { getStockName } from '@/lib/stock-names'
import { revalidateTags } from '@/lib/revalidate-client'

interface Props {
  symbol: string
  fiscalYear: FiscalYear | null
  allocation: StockAllocation | null
  transactions: Transaction[]
  allTransactions: Transaction[]
  band: BuyBand | null
  tranches: BuyTranche[]
  investability: Investability | null
  userId: string
  initialTab: string
}

type Tab = 'overview' | 'bands' | 'transactions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',     label: 'Overview' },
  { id: 'bands',        label: 'Bands' },
  { id: 'transactions', label: 'Transactions' },
]

export default function StockDetailClient({
  symbol, fiscalYear, allocation, transactions, allTransactions, band: initialBand,
  tranches, investability: initialInv, userId, initialTab,
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab as Tab ?? 'overview')
  const [band, setBand] = useState(initialBand)
  const [inv, setInv]   = useState(initialInv)

  const buys  = transactions.filter(t => t.trade_type === 'buy')
  const sells = transactions.filter(t => t.trade_type === 'sell')
  const totalBought   = buys.reduce((s, t) => s + t.quantity, 0)
  const totalBuyValue = buys.reduce((s, t) => s + t.amount, 0)
  const totalSold     = sells.reduce((s, t) => s + t.quantity, 0)
  const qty     = Math.max(0, totalBought - totalSold)
  const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
  const spent   = buys.reduce((s, t) => s + t.amount, 0) - sells.reduce((s, t) => s + t.amount, 0)

  const budget    = allocation && fiscalYear ? (allocation.allocation_pct / 100) * fiscalYear.total_budget_inr : 0
  const remaining = budget - spent
  const cmp       = band?.manual_cmp ?? null
  const pnl       = cmp !== null && qty > 0 ? (cmp - avgCost) * qty : null
  const pnlPct    = (cmp !== null && avgCost > 0) ? (cmp - avgCost) / avgCost * 100 : null
  const signal    = band ? getBandSignal(band) : 'unknown'

  return (
    <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Back + header */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <button onClick={() => router.back()} style={{ color: 'var(--text-muted)' }} className="mt-0.5 p-2 -ml-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{symbol}</h1>
            <BandSignalBadge signal={signal} />
          </div>
          {getStockName(symbol) && (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{getStockName(symbol)}</p>
          )}
          {qty > 0 && (
            <p className="text-sm tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {Math.round(qty)} shares · avg ₹{Math.round(avgCost)}
              {pnl !== null && (
                <span className={pnl >= 0 ? ' text-green-500' : ' text-red-400'}>
                  {' '}· {formatPnL(pnl)}
                  {pnlPct !== null && ` (${formatPct(pnlPct)})`}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b px-4 gap-1" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="px-3 py-3 text-[15px] font-medium border-b-2 -mb-px transition-colors"
            style={{
              borderColor: activeTab === tab.id ? '#0A84FF' : 'transparent',
              color: activeTab === tab.id ? '#0A84FF' : 'var(--text-muted)',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {activeTab === 'overview'     && <OverviewTab {...{ symbol, budget, spent, remaining, qty, avgCost, cmp, pnl, pnlPct, allocation, fiscalYear, band, onBandSaved: setBand }} />}
        {activeTab === 'bands'        && <BandsTab symbol={symbol} band={band} initialTranches={tranches} allocation={allocation} fiscalYear={fiscalYear} remaining={remaining} onBandSaved={setBand} userId={userId} />}
        {activeTab === 'transactions' && <TxnsTab symbol={symbol} transactions={transactions} userId={userId} fiscalYear={fiscalYear} onAdded={() => router.refresh()} />}
      </div>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ symbol, budget, spent, remaining, qty, avgCost, cmp, pnl, pnlPct, allocation, fiscalYear, band, onBandSaved }: {
  symbol: string; budget: number; spent: number; remaining: number; qty: number; avgCost: number
  cmp: number | null; pnl: number | null; pnlPct: number | null
  allocation: StockAllocation | null; fiscalYear: FiscalYear | null
  band: BuyBand | null; onBandSaved: (b: BuyBand) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const pctSpent = budget > 0 ? (spent / budget) * 100 : 0

  async function refreshCMP() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error()
      const { price } = await res.json()
      if (band) {
        const sb = getSupabaseBrowser()
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        onBandSaved({ ...band, manual_cmp: price })
        revalidateTags('buy_bands')
      }
    } catch {}
    setRefreshing(false)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <p className="text-xs mb-3 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Budget</p>
        <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, pctSpent)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <M label="Budget"    value={formatINR(budget)} />
          <M label="Spent"     value={formatINR(spent)} />
          <M label="Remaining" value={formatINR(remaining)} color={remaining < 0 ? 'text-red-400' : undefined} />
        </div>
        {allocation && fiscalYear && (
          <p className="text-xs mt-2 tabnum" style={{ color: 'var(--text-faint)' }}>
            {formatPct(allocation.allocation_pct)} of {formatINR(fiscalYear.total_budget_inr)} total
          </p>
        )}
      </div>

      {qty > 0 && (
        <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Holdings</p>
            <button onClick={refreshCMP} disabled={refreshing}
              className="text-[14px] px-2.5 py-2 rounded-lg disabled:opacity-40"
              style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
              {refreshing ? '…' : '↻ CMP'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <M label="Shares"   value={`${Math.round(qty)}`} />
            <M label="Avg Cost" value={avgCost > 0 ? `₹${Math.round(avgCost)}` : '—'} />
            {cmp !== null && <M label="CMP" value={`₹${Math.round(cmp)}`} />}
            {pnl !== null && (
              <M label="Unrealised P&L"
                 value={`${formatPnL(pnl)}${pnlPct !== null ? ` (${formatPct(pnlPct)})` : ''}`}
                 color={pnl >= 0 ? 'text-green-500' : 'text-red-400'} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function M({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`font-semibold tabnum ${color ?? ''}`}
         style={color ? undefined : { color: 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}

// ── Bands tab ─────────────────────────────────────────────────────────────────

function BandsTab({ symbol, band, initialTranches, allocation, fiscalYear, remaining, onBandSaved, userId }: {
  symbol: string; band: BuyBand | null; initialTranches: BuyTranche[]
  allocation: StockAllocation | null; fiscalYear: FiscalYear | null; remaining: number
  onBandSaved: (b: BuyBand) => void; userId: string
}) {
  const fyId = fiscalYear?.id ?? ''
  const [cmpInput, setCmpInput]                     = useState(band?.manual_cmp?.toString() ?? '')
  const [savingCmp, setSavingCmp]                   = useState(false)
  const [refreshing, setRefreshing]                 = useState(false)
  const [tranches, setTranches]                     = useState(initialTranches)
  const [generatingTranches, setGeneratingTranches] = useState(false)
  const [hasKey, setHasKey]                         = useState<boolean | null>(null)
  const signal = band ? getBandSignal(band) : 'unknown'
  const totalCapital = fiscalYear?.total_budget_inr ?? 0
  const tranche = band?.buy_low != null ? trancheSuggestion(remaining, totalCapital) : null

  useEffect(() => {
    fetch('/api/settings/gemini-key')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false))
  }, [])

  async function saveCMP() {
    if (!band || !cmpInput) return
    setSavingCmp(true)
    const sb = getSupabaseBrowser()
    const cmp = parseFloat(cmpInput)
    await sb.from('buy_bands').update({ manual_cmp: cmp, last_updated_at: new Date().toISOString() }).eq('id', band.id)
    onBandSaved({ ...band, manual_cmp: cmp })
    revalidateTags('buy_bands')
    setSavingCmp(false)
  }

  async function refreshCMP() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/cmp/${encodeURIComponent(symbol)}`)
      if (!res.ok) throw new Error()
      const { price } = await res.json()
      setCmpInput(String(Math.round(price)))
      if (band) {
        const sb = getSupabaseBrowser()
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        onBandSaved({ ...band, manual_cmp: price })
        revalidateTags('buy_bands')
      }
    } catch {}
    setRefreshing(false)
  }

  // ── Tranche operations ──────────────────────────────────────────────────────
  async function toggleTranche(id: string, allocated: boolean) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, allocated } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ allocated }).eq('id', id)
    revalidateTags('buy_tranches')
  }

  async function addTranche(sym: string, qty: number, price: number) {
    const sb = getSupabaseBrowser()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data } = await sb.from('buy_tranches').insert({
      user_id: user.id, symbol: sym, qty, price, allocated: false,
      sort_order: tranches.length + 1, fy_id: fyId,
    }).select().single()
    if (data) setTranches(prev => [...prev, data])
    revalidateTags('buy_tranches')
  }

  async function deleteTranche(id: string) {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('id', id)
    setTranches(prev => prev.filter(t => t.id !== id))
    revalidateTags('buy_tranches')
  }

  async function updateTranche(id: string, qty: number, price: number) {
    setTranches(prev => prev.map(t => t.id === id ? { ...t, qty, price } : t))
    await getSupabaseBrowser().from('buy_tranches').update({ qty, price }).eq('id', id)
    revalidateTags('buy_tranches')
  }

  async function clearTranches() {
    await getSupabaseBrowser().from('buy_tranches').delete().eq('symbol', symbol).eq('fy_id', fyId)
    setTranches([])
    revalidateTags('buy_tranches')
  }

  async function generateTranches() {
    setGeneratingTranches(true)
    try {
      const res = await fetch(`/api/tranches/generate/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fyId }),
      })
      const json = await res.json()
      if (res.ok && json.tranches?.length > 0) setTranches(json.tranches)
    } catch {}
    setGeneratingTranches(false)
  }

  // ── Computed bands ──────────────────────────────────────────────────────────
  const computed = (band && allocation) ? calculateBands({
    category: allocation.category as StockCategory,
    twoWeakQuarters: allocation.two_weak_quarters,
    twoStrongQuarters: allocation.two_strong_quarters,
    isHospitalRampPhase: allocation.is_hospital_ramp_phase,
    eps: band.eps, bvps: band.bvps, ebitda: band.ebitda,
    netDebt: band.net_debt, shares: band.shares, embeddedValue: band.embedded_value,
  }) : null

  const buyLow    = computed?.buyLow    ?? band?.buy_low    ?? null
  const buyHigh   = computed?.buyHigh   ?? band?.buy_high   ?? null
  const midLow    = computed?.midLow    ?? band?.mid_low    ?? null
  const midHigh   = computed?.midHigh   ?? band?.mid_high   ?? null
  const trimPrice = computed?.trimPrice ?? band?.trim_price ?? null
  const hasBands  = buyLow != null && trimPrice != null

  const sortedTranches = [...tranches].sort((a, b) => b.price - a.price)

  return (
    <div className="px-4 py-4 space-y-4">
      {hasBands && band ? (
        <>
          {/* Signal + CMP */}
          <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BandSignalBadge signal={signal} />
                {computed?.isPremium && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold"
                        style={{ background: 'rgba(10,132,255,0.15)', color: '#0A84FF' }}>
                    Premium
                  </span>
                )}
                {computed?.isTightened && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold"
                        style={{ background: 'rgba(255,159,10,0.15)', color: '#FF9F0A' }}>
                    Tightened
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={refreshCMP} disabled={refreshing}
                  className="text-[14px] px-2.5 py-2 rounded-lg disabled:opacity-40"
                  style={{ color: 'var(--text-muted)', background: 'var(--border)' }}>
                  {refreshing ? '…' : '↻'}
                </button>
                <input
                  type="number" inputMode="decimal" placeholder="CMP ₹"
                  value={cmpInput} onChange={e => setCmpInput(e.target.value)}
                  className="w-24 px-2 py-1.5 rounded-lg text-sm tabnum outline-none text-right"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                <button onClick={saveCMP} disabled={savingCmp}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{ background: 'var(--border)', color: 'var(--text-2)' }}>
                  {savingCmp ? '…' : 'Set'}
                </button>
              </div>
            </div>

            <BandBarSimple buyLow={buyLow!} buyHigh={buyHigh!} midLow={midLow!} midHigh={midHigh!} trimPrice={trimPrice!} cmp={band.manual_cmp} />

            <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
              Anchor: {band.anchor_type} · {new Date(band.last_updated_at).toLocaleDateString('en-IN')}
            </p>
          </div>

          {/* Tranche suggestion */}
          {signal === 'buy' && tranche !== null && (
            <div className="p-4 rounded-2xl border border-green-500/20" style={{ background: 'rgba(52,199,89,0.08)' }}>
              <p className="text-green-500 text-sm font-semibold">Tranche suggestion</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                Add <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatINR(tranche)}</span> near ₹{Math.round(buyLow!)} (low end)
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                1–2% of {formatINR(totalCapital)} · Remaining: {formatINR(remaining)}
              </p>
            </div>
          )}

          {/* Financials */}
          <FinancialsCard
            symbol={symbol} band={band} allocation={allocation} fyId={fyId}
            hasKey={hasKey}
            onBandSaved={(b) => { onBandSaved(b); setTranches([]) }}
            onTranchesUpdated={setTranches}
          />

          {/* Tranches — same component as Buy Bands page */}
          <TrancheSection
            card
            symbol={symbol}
            tranches={sortedTranches}
            remaining={remaining}
            hasBands={hasBands}
            onToggle={toggleTranche}
            onAdd={addTranche}
            onDelete={deleteTranche}
            onUpdate={updateTranche}
            onGenerate={generateTranches}
            onClear={clearTranches}
            generating={generatingTranches}
          />
        </>
      ) : (
        <>
          <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
            <p className="text-[17px] font-medium mb-1">No bands yet</p>
            <p className="text-[14px]" style={{ color: 'var(--text-faint)' }}>Add financials below, then tap Generate</p>
          </div>

          <FinancialsCard
            symbol={symbol} band={band} allocation={allocation} fyId={fyId}
            hasKey={hasKey}
            onBandSaved={(b) => { onBandSaved(b); setTranches([]) }}
            onTranchesUpdated={setTranches}
          />

          <TrancheSection
            card
            symbol={symbol}
            tranches={sortedTranches}
            remaining={remaining}
            hasBands={hasBands}
            onToggle={toggleTranche}
            onAdd={addTranche}
            onDelete={deleteTranche}
            onUpdate={updateTranche}
            onGenerate={generateTranches}
            onClear={clearTranches}
            generating={generatingTranches}
          />
        </>
      )}
    </div>
  )
}

// ── Financials card ────────────────────────────────────────────────────────────

function FinancialsCard({ symbol, band, allocation, fyId, hasKey, onBandSaved, onTranchesUpdated }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyId: string
  hasKey: boolean | null
  onBandSaved: (b: BuyBand) => void
  onTranchesUpdated: (t: BuyTranche[]) => void
}) {
  // Derive anchor from stored band.anchor_type first (most accurate),
  // then fall back to allocation.category if no band yet
  const anchor: 'PE' | 'EV' | 'PB' | 'PEV' =
    band?.anchor_type === 'EV_EBITDA' ? 'EV'
    : band?.anchor_type === 'PB'      ? 'PB'
    : band?.anchor_type === 'P_EV'    ? 'PEV'
    : band?.anchor_type === 'PE'      ? 'PE'
    : allocation?.category === 'Capital Goods'       ? 'EV'
    : allocation?.category === 'Hospitals' && allocation.is_hospital_ramp_phase ? 'EV'
    : allocation?.category === 'Insurance — Life'    ? 'PEV'
    : (allocation?.category === 'Banks' || allocation?.category === 'Insurance — General') ? 'PB'
    : 'PE'

  const category = allocation?.category

  const [editing, setEditing]   = useState(false)
  const [generating, setGen]    = useState(false)
  const [genError, setGenError] = useState('')
  const [saving, setSaving]     = useState(false)

  // form state (strings for inputs)
  const [eps,   setEps]   = useState(band?.eps?.toString()            ?? '')
  const [bvps,  setBvps]  = useState(band?.bvps?.toString()           ?? '')
  const [ebitda,setEbitda]= useState(band?.ebitda?.toString()         ?? '')
  const [netDebt,setNetDebt]=useState(band?.net_debt?.toString()      ?? '')
  const [shares,setShares]= useState(band?.shares?.toString()         ?? '')
  const [ev,    setEv]    = useState(band?.embedded_value?.toString() ?? '')

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
          // Sync form inputs with fresh data
          setEps(json.band.eps?.toString()            ?? '')
          setBvps(json.band.bvps?.toString()          ?? '')
          setEbitda(json.band.ebitda?.toString()      ?? '')
          setNetDebt(json.band.net_debt?.toString()   ?? '')
          setShares(json.band.shares?.toString()      ?? '')
          setEv(json.band.embedded_value?.toString()  ?? '')
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
      eps:             parseFloat(eps)     || null,
      bvps:            parseFloat(bvps)    || null,
      ebitda:          parseFloat(ebitda)  || null,
      net_debt:        parseFloat(netDebt) || null,
      shares:          parseFloat(shares)  || null,
      embedded_value:  parseFloat(ev)      || null,
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

    if (savedBand) {
      onBandSaved(savedBand)
      revalidateTags('buy_bands')
    }
    setSaving(false)
    setEditing(false)
  }

  const hasData = !!(band?.eps || band?.bvps || band?.ebitda || band?.embedded_value)

  return (
    <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-muted)' }}>Financials</p>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[14px] font-medium disabled:opacity-40"
              style={{ background: 'rgba(10,132,255,0.12)', color: '#0A84FF', border: '1px solid rgba(10,132,255,0.25)' }}>
              <SparkleIcon className={`w-3.5 h-3.5 ${generating ? 'spin' : ''}`} />
              {generating ? '…' : 'Generate'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <PencilIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {genError && <p className="text-[12px] text-red-400 mb-2">{genError}</p>}

      {editing ? (
        <>
          <p className="text-[12px] mb-3" style={{ color: 'var(--text-faint)' }}>
            {category ? `${category} · ` : ''}{anchor === 'EV' ? 'EV/EBITDA' : anchor === 'PB' ? 'P/B' : anchor === 'PEV' ? 'P/EV' : 'PE'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(anchor === 'PE') && (
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>EPS (₹)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 18" value={eps}
                  onChange={e => setEps(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            )}
            {(anchor === 'EV') && (<>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>EBITDA (₹Cr)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 1200" value={ebitda}
                  onChange={e => setEbitda(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Net Debt (₹Cr)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 500" value={netDebt}
                  onChange={e => setNetDebt(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Shares (Cr)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 3.8" value={shares}
                  onChange={e => setShares(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </>)}
            {(anchor === 'PB') && (
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Book Value per Share (₹)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 250" value={bvps}
                  onChange={e => setBvps(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            )}
            {(anchor === 'PEV') && (<>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Embedded Value (₹Cr)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 92400" value={ev}
                  onChange={e => setEv(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Shares (Cr)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 10" value={shares}
                  onChange={e => setShares(e.target.value)}
                  className="w-full px-3.5 py-3.5 rounded-2xl text-[17px] tabnum outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </>)}
          </div>
          <button onClick={save} disabled={saving}
            className="w-full mt-4 py-4 rounded-2xl text-[17px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)}
            className="w-full mt-2 py-3 rounded-2xl text-[15px]"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
        </>
      ) : hasData ? (
        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[13px]">
          {band?.eps            && <InputRow k="EPS"            v={`₹${band.eps}`} />}
          {band?.bvps           && <InputRow k="BVPS"           v={`₹${band.bvps}`} />}
          {band?.ebitda         && <InputRow k="EBITDA"         v={`${band.ebitda} Cr`} />}
          {band?.net_debt       && <InputRow k="Net Debt"       v={`${band.net_debt} Cr`} />}
          {band?.shares         && <InputRow k="Shares"         v={`${band.shares} Cr`} />}
          {band?.embedded_value && <InputRow k="Embedded Value" v={`${band.embedded_value} Cr`} />}
        </div>
      ) : (
        <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>No data — tap pencil to enter, or Generate to auto-fill</p>
      )}
    </div>
  )
}

function BandBarSimple({ buyLow, buyHigh, midLow, midHigh, trimPrice, cmp }: {
  buyLow: number; buyHigh: number; midLow: number; midHigh: number; trimPrice: number; cmp: number | null
}) {
  const min = buyLow * 0.9
  const max = trimPrice * 1.1
  const range = max - min
  const pct = (v: number) => ((v - min) / range) * 100
  const buyW  = pct(buyHigh) - pct(buyLow)
  const midW  = pct(midHigh) - pct(midLow)
  const cmpPct = cmp ? pct(cmp) : null

  return (
    <div>
      <div className="relative h-7 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full" style={{ width: `${pct(buyLow)}%` }} />
        <div className="h-full flex items-center justify-center" style={{ width: `${buyW}%`, background: 'rgba(52,199,89,0.35)' }}>
          <span className="text-[11px] font-bold text-green-500">BUY</span>
        </div>
        <div className="h-full flex items-center justify-center" style={{ width: `${midW}%`, background: 'rgba(255,149,0,0.30)' }}>
          <span className="text-[11px] font-bold text-orange-400">MID</span>
        </div>
        <div className="h-full flex items-center justify-center flex-1" style={{ background: 'rgba(255,59,48,0.25)' }}>
          <span className="text-[11px] font-bold text-red-400">TRIM</span>
        </div>
        {cmpPct !== null && cmpPct >= 0 && cmpPct <= 100 && (
          <div className="absolute top-0 bottom-0 w-0.5 rounded-full"
               style={{ left: `${cmpPct}%`, background: 'var(--text-primary)' }} />
        )}
      </div>
      <div className="flex justify-between mt-2 text-[11px] tabnum">
        <div><p className="font-semibold text-green-500">₹{Math.round(buyLow)}–{Math.round(buyHigh)}</p><p style={{ color: 'var(--text-faint)' }}>Buy</p></div>
        <div className="text-center"><p className="font-semibold text-orange-400">₹{Math.round(midLow)}–{Math.round(midHigh)}</p><p style={{ color: 'var(--text-faint)' }}>Mid</p></div>
        <div className="text-right"><p className="font-semibold text-red-400">≥₹{Math.round(trimPrice)}</p><p style={{ color: 'var(--text-faint)' }}>Trim</p></div>
      </div>
      {cmp && <p className="text-center text-[11px] mt-1 tabnum" style={{ color: 'var(--text-muted)' }}>CMP ₹{Math.round(cmp).toLocaleString('en-IN')}</p>}
    </div>
  )
}

function InputRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span className="tabnum" style={{ color: 'var(--text-primary)' }}>{v}</span>
    </div>
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

// ── Transactions tab ──────────────────────────────────────────────────────────

function TxnsTab({ symbol, transactions, userId, fiscalYear, onAdded }: {
  symbol: string; transactions: Transaction[]; userId: string
  fiscalYear: FiscalYear | null; onAdded: () => void
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)

  async function del(id: string) {
    setDeleting(id)
    await getSupabaseBrowser().from('transactions').delete().eq('id', id)
    revalidateTags('transactions', 'transactions_all')
    setDeleting(null)
    router.refresh()
  }

  return (
    <div className="px-4 py-4">
      <button
        onClick={() => document.dispatchEvent(new CustomEvent('open-add-txn'))}
        className="flex items-center justify-center gap-2 py-3 rounded-xl w-full font-medium text-sm mb-4"
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
        <span className="text-lg">+</span> Add transaction for {symbol}
      </button>

      {transactions.length === 0 ? (
        <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No transactions yet</p>
      ) : (
        <div className="space-y-2">
          {transactions.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl border"
                 style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-faint)' }}>
              <TradeTypeBadge type={t.trade_type} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="text-sm tabnum">{Math.round(t.quantity)} × ₹{Math.round(t.price)}</span>
                  <span className="font-semibold tabnum text-sm">{formatINR(t.amount)}</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(t.trade_date)}{t.notes ? ` · ${t.notes}` : ''}
                </p>
              </div>
              <button onClick={() => del(t.id)} disabled={deleting === t.id}
                className="text-[15px] px-3 py-2 rounded-lg disabled:opacity-40"
                style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.08)' }}>
                {deleting === t.id ? '…' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Investability tab ─────────────────────────────────────────────────────────

const GATES: { key: keyof Investability; noteKey: keyof Investability; label: string }[] = [
  { key: 'sector_winds',         noteKey: 'sector_winds_note',         label: '0 · Sector Winds' },
  { key: 'circle_of_competence', noteKey: 'circle_note',               label: '1 · Circle of Competence' },
  { key: 'moat',                 noteKey: 'moat_note',                 label: '2 · Moat' },
  { key: 'owner_earnings',       noteKey: 'owner_earnings_note',       label: '3 · Owner Earnings' },
  { key: 'capital_efficiency',   noteKey: 'capital_efficiency_note',   label: '4 · Capital Efficiency' },
  { key: 'innovation_velocity',  noteKey: 'innovation_note',           label: '5 · Innovation Velocity' },
  { key: 'governance',           noteKey: 'governance_note',           label: '6 · Governance' },
  { key: 'execution_track',      noteKey: 'execution_note',            label: '7 · Execution Track' },
  { key: 'supply_chain_risk',    noteKey: 'supply_chain_note',         label: '8 · Supply Chain Risk' },
  { key: 'regulatory_signal',    noteKey: 'regulatory_note',           label: '9 · Regulatory Signal' },
  { key: 'thesis_breaker',       noteKey: 'thesis_breaker_note',       label: '10 · Thesis Breaker' },
  { key: 'capital_discipline',   noteKey: 'capital_discipline_note',   label: '11 · Capital Discipline' },
]

const defaultInv = (symbol: string): Omit<Investability, 'id' | 'user_id'> => ({
  symbol, assessed_at: new Date().toISOString(),
  sector_winds: 'pass', sector_winds_note: '',
  circle_of_competence: 'pass', circle_note: '',
  moat: 'pass', moat_note: '',
  owner_earnings: 'pass', owner_earnings_note: '',
  capital_efficiency: 'pass', capital_efficiency_note: '',
  innovation_velocity: 'pass', innovation_note: '',
  governance: 'pass', governance_note: '',
  execution_track: 'pass', execution_note: '',
  supply_chain_risk: 'pass', supply_chain_note: '',
  regulatory_signal: 'pass', regulatory_note: '',
  thesis_breaker: 'pass', thesis_breaker_note: '',
  capital_discipline: 'pass', capital_discipline_note: '',
  investable: true, notes: '',
})

function InvestabilityTab({ symbol, inv, onSaved }: {
  symbol: string; inv: Investability | null; onSaved: (i: Investability) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState<Omit<Investability, 'id' | 'user_id'>>(inv ?? defaultInv(symbol))
  const [saving, setSaving]   = useState(false)

  async function save() {
    setSaving(true)
    const sb = getSupabaseBrowser()
    const { data } = await sb.from('investability')
      .upsert({ ...draft, assessed_at: new Date().toISOString() }, { onConflict: 'user_id,symbol' })
      .select().single()
    setSaving(false)
    if (data) {
      onSaved(data)
      revalidateTags('investability')
      setEditing(false)
    }
  }

  const record   = (inv ?? draft) as unknown as Partial<Record<keyof Investability, unknown>>
  const passes   = GATES.filter(g => record[g.key] === 'pass').length
  const cautions = GATES.filter(g => record[g.key] === 'caution').length
  const fails    = GATES.filter(g => record[g.key] === 'fail').length

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Verdict */}
      <div className="flex items-center justify-between p-4 rounded-2xl border"
           style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <InvestableBadge investable={editing ? draft.investable : (inv?.investable ?? true)} />
        <div className="text-right text-sm">
          <span className="text-green-500">{passes} ✅</span>
          {cautions > 0 && <span className="text-orange-400 ml-2">{cautions} ⚠️</span>}
          {fails > 0    && <span className="text-red-400 ml-2">{fails} ❌</span>}
        </div>
      </div>

      {editing ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between p-3 rounded-xl border"
               style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
            <span className="text-sm">Investable?</span>
            <div className="flex gap-1">
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setDraft(d => ({ ...d, investable: v }))}
                  className="px-3 py-1 rounded-lg text-xs font-bold"
                  style={draft.investable === v
                    ? { background: v ? '#34C759' : '#FF3B30', color: '#fff' }
                    : { background: 'var(--border)', color: 'var(--text-muted)' }}>
                  {v ? 'YES' : 'NO'}
                </button>
              ))}
            </div>
          </div>

          {GATES.map(gate => (
            <div key={gate.key} className="p-3 rounded-xl border space-y-2"
                 style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-faint)' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm">{gate.label}</span>
                <div className="flex gap-1">
                  {(['pass', 'caution', 'fail'] as GateSignal[]).map(sig => (
                    <button key={sig} onClick={() => setDraft(d => ({ ...d, [gate.key]: sig }))}
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={(draft as Record<string, unknown>)[gate.key] === sig
                        ? { background: sig === 'pass' ? '#34C759' : sig === 'caution' ? '#FF9500' : '#FF3B30', color: '#fff' }
                        : { background: 'var(--border)', color: 'var(--text-muted)' }}>
                      {sig === 'pass' ? '✅' : sig === 'caution' ? '⚠️' : '❌'}
                    </button>
                  ))}
                </div>
              </div>
              <input type="text" placeholder="Note (optional)"
                value={((draft as Record<string, unknown>)[gate.noteKey] as string) ?? ''}
                onChange={e => setDraft(d => ({ ...d, [gate.noteKey]: e.target.value }))}
                className="w-full px-2 py-1.5 rounded text-xs outline-none"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }} />
            </div>
          ))}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditing(false)}
              className="flex-1 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40"
              style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {GATES.map(gate => {
            const rec    = (inv ?? draft) as unknown as Record<string, unknown>
            const sig    = rec[gate.key] as GateSignal
            const note   = rec[gate.noteKey] as string
            return (
              <div key={gate.key} className="flex items-start gap-3 py-2 border-b"
                   style={{ borderColor: 'var(--border-faint)' }}>
                <GateSignalIcon signal={sig} compact />
                <div className="flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>{gate.label}</p>
                  {note && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{note}</p>}
                </div>
              </div>
            )
          })}
          {inv && (
            <p className="text-xs pt-1" style={{ color: 'var(--text-faint)' }}>
              Last assessed: {formatDate(inv.assessed_at)}
            </p>
          )}
          <button onClick={() => setEditing(true)}
            className="w-full py-3 rounded-xl border text-sm mt-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            Edit Assessment
          </button>
        </div>
      )}
    </div>
  )
}
