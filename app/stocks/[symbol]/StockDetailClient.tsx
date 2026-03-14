'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, getBandSignal, trancheSuggestion } from '@/lib/band-calculator'
import { BandSignalBadge, TradeTypeBadge, GateSignalIcon, InvestableBadge } from '@/components/SignalBadge'
import { formatINR, formatPnL, formatPct, formatDate } from '@/lib/formatter'
import { type StockCategory } from '@/lib/types'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, GateSignal, BuyTranche } from '@/lib/types'

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

      <div className="overflow-y-auto pb-24">
        {activeTab === 'overview'     && <OverviewTab {...{ symbol, budget, spent, remaining, qty, avgCost, cmp, pnl, pnlPct, allocation, fiscalYear, band, onBandSaved: setBand }} />}
        {activeTab === 'bands'        && <BandsTab symbol={symbol} band={band} tranches={tranches} allocation={allocation} fiscalYear={fiscalYear} remaining={remaining} onBandSaved={setBand} />}
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
      const res = await fetch(`/api/cmp/${symbol}`)
      if (!res.ok) throw new Error()
      const { price } = await res.json()
      if (band) {
        const sb = getSupabaseBrowser()
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        onBandSaved({ ...band, manual_cmp: price })
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

function BandsTab({ symbol, band, tranches, allocation, fiscalYear, remaining, onBandSaved }: {
  symbol: string; band: BuyBand | null; tranches: BuyTranche[]
  allocation: StockAllocation | null; fiscalYear: FiscalYear | null; remaining: number
  onBandSaved: (b: BuyBand) => void
}) {
  const [cmpInput, setCmpInput] = useState(band?.manual_cmp?.toString() ?? '')
  const [saving, setSaving]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const signal = band ? getBandSignal(band) : 'unknown'
  const totalCapital = fiscalYear?.total_budget_inr ?? 0
  const tranche = band?.buy_low != null ? trancheSuggestion(remaining, totalCapital) : null

  async function saveCMP() {
    if (!band || !cmpInput) return
    setSaving(true)
    const sb = getSupabaseBrowser()
    const cmp = parseFloat(cmpInput)
    await sb.from('buy_bands').update({ manual_cmp: cmp, last_updated_at: new Date().toISOString() }).eq('id', band.id)
    onBandSaved({ ...band, manual_cmp: cmp })
    setSaving(false)
  }

  async function refreshCMP() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/cmp/${symbol}`)
      if (!res.ok) throw new Error()
      const { price } = await res.json()
      setCmpInput(String(Math.round(price)))
      if (band) {
        const sb = getSupabaseBrowser()
        await sb.from('buy_bands').update({ manual_cmp: price, last_updated_at: new Date().toISOString() }).eq('id', band.id)
        onBandSaved({ ...band, manual_cmp: price })
      }
    } catch {}
    setRefreshing(false)
  }

  // Re-compute from stored inputs + allocation flags for display accuracy
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

  const hasBands = buyLow != null && trimPrice != null

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
                <button onClick={saveCMP} disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{ background: 'var(--border)', color: 'var(--text-2)' }}>
                  {saving ? '…' : 'Set'}
                </button>
              </div>
            </div>

            {/* Simple band bar */}
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

          {/* Anchor inputs */}
          {(band.eps || band.ebitda || band.bvps || band.embedded_value) && (
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <p className="text-xs mb-2 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Anchor Inputs</p>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                {band.eps            && <InputRow k="EPS"            v={`₹${band.eps}`} />}
                {band.bvps           && <InputRow k="BVPS"           v={`₹${band.bvps}`} />}
                {band.ebitda         && <InputRow k="EBITDA"         v={`${band.ebitda} Cr`} />}
                {band.net_debt       && <InputRow k="Net Debt"       v={`${band.net_debt} Cr`} />}
                {band.shares         && <InputRow k="Shares"         v={`${band.shares} Cr`} />}
                {band.embedded_value && <InputRow k="Embedded Value" v={`${band.embedded_value} Cr`} />}
              </div>
            </div>
          )}

          {/* Tranches */}
          {tranches.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
              <p className="text-xs px-4 pt-3 pb-2 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Tranches</p>
              {[...tranches].sort((a, b) => b.price - a.price).map((t, i) => (
                <div key={t.id}
                     className={`flex items-center justify-between px-4 py-2.5 ${i < tranches.length - 1 ? 'border-b' : ''}`}
                     style={{ borderColor: 'var(--border-faint)', opacity: t.allocated ? 0.5 : 1 }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                         style={{ background: t.allocated ? 'var(--text-faint)' : '#34C759' }} />
                    <span className="text-[13px] tabnum">{Math.round(t.qty)} × ₹{Math.round(t.price)}</span>
                  </div>
                  <span className="text-[13px] tabnum font-medium" style={{ color: 'var(--text-2)' }}>
                    {formatINR(t.qty * t.price)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
          <p className="mb-1">No bands computed yet</p>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Use "Generate Bands" in Buy Bands tab</p>
        </div>
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
    if (data) { onSaved(data); setEditing(false) }
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
