'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, getBandSignal, trancheSuggestion } from '@/lib/band-calculator'
import { BandSignalBadge, TradeTypeBadge, GateSignalIcon, InvestableBadge } from '@/components/SignalBadge'
import BandRangeBar from '@/components/BandRangeBar'
import { formatINR, formatPnL, formatPct, formatDate, todayISO } from '@/lib/formatter'
import { type StockCategory } from '@/lib/types'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, GateSignal } from '@/lib/types'

interface Props {
  symbol: string
  fiscalYear: FiscalYear | null
  allocation: StockAllocation | null
  transactions: Transaction[]
  allTransactions: Transaction[]
  band: BuyBand | null
  investability: Investability | null
  userId: string
  initialTab: string
}

type Tab = 'overview' | 'bands' | 'transactions' | 'investability'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'bands',         label: 'Bands' },
  { id: 'transactions',  label: 'Txns' },
  { id: 'investability', label: 'Gates' },
]

export default function StockDetailClient({
  symbol, fiscalYear, allocation, transactions, allTransactions, band: initialBand,
  investability: initialInv, userId, initialTab
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>(initialTab as Tab ?? 'overview')
  const [band, setBand]           = useState(initialBand)
  const [inv, setInv]             = useState(initialInv)

  // Holdings
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
  const pnl       = cmp !== null ? (cmp - avgCost) * qty : null
  const pnlPct    = (cmp !== null && avgCost > 0) ? (cmp - avgCost) / avgCost * 100 : null
  const signal    = band ? getBandSignal(band) : 'unknown'

  return (
    <div className="pt-[env(safe-area-inset-top,0px)]">
      {/* Back + header */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <button onClick={() => router.back()} className="text-white/40 mt-0.5">
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
            <p className="text-white/40 text-sm tabnum mt-0.5">
              {Math.round(qty)} shares · avg ₹{Math.round(avgCost)}
              {pnl !== null && (
                <span className={pnl >= 0 ? ' text-green-400' : ' text-red-400'}>
                  {' '}· {formatPnL(pnl)}
                  {pnlPct !== null && ` (${formatPct(pnlPct)})`}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/10 px-4 gap-1">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-white text-white'
                : 'border-transparent text-white/40'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto">
        {activeTab === 'overview'      && <OverviewTab {...{ budget, spent, remaining, qty, avgCost, cmp, pnl, pnlPct, allocation, fiscalYear }} />}
        {activeTab === 'bands'         && <BandsTab symbol={symbol} band={band} allocation={allocation} fiscalYear={fiscalYear} remaining={remaining} onBandSaved={setBand} />}
        {activeTab === 'transactions'  && <TxnsTab symbol={symbol} transactions={transactions} userId={userId} fiscalYear={fiscalYear} onAdded={() => router.refresh()} />}
        {activeTab === 'investability' && <InvestabilityTab symbol={symbol} inv={inv} onSaved={setInv} />}
      </div>
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ budget, spent, remaining, qty, avgCost, cmp, pnl, pnlPct, allocation, fiscalYear }: {
  budget: number; spent: number; remaining: number; qty: number; avgCost: number
  cmp: number | null; pnl: number | null; pnlPct: number | null
  allocation: StockAllocation | null; fiscalYear: FiscalYear | null
}) {
  const pctSpent = budget > 0 ? (spent / budget) * 100 : 0

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Budget */}
      <div className="p-4 rounded-2xl bg-white/5">
        <p className="text-white/40 text-xs mb-3 uppercase tracking-widest">Budget</p>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
          <div className="h-full rounded-full bg-green-500"
               style={{ width: `${Math.min(100, pctSpent)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <M label="Budget"    value={formatINR(budget)} />
          <M label="Spent"     value={formatINR(spent)} />
          <M label="Remaining" value={formatINR(remaining)}
             color={remaining < 0 ? 'text-red-400' : 'text-white'} />
        </div>
        {allocation && fiscalYear && (
          <p className="text-white/30 text-xs mt-2 tabnum">
            {formatPct(allocation.allocation_pct)} of {formatINR(fiscalYear.total_budget_inr)} total
          </p>
        )}
      </div>

      {/* Holdings */}
      {qty > 0 && (
        <div className="p-4 rounded-2xl bg-white/5">
          <p className="text-white/40 text-xs mb-3 uppercase tracking-widest">Holdings</p>
          <div className="grid grid-cols-2 gap-3">
            <M label="Shares"    value={`${Math.round(qty)}`} />
            <M label="Avg Cost"  value={avgCost > 0 ? `₹${Math.round(avgCost)}` : '—'} />
            {cmp !== null && <M label="CMP" value={`₹${Math.round(cmp)}`} />}
            {pnl !== null && (
              <M label="Unrealised P&L"
                 value={`${formatPnL(pnl)}${pnlPct !== null ? ` (${formatPct(pnlPct)})` : ''}`}
                 color={pnl >= 0 ? 'text-green-400' : 'text-red-400'} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function M({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`font-semibold tabnum ${color}`}>{value}</p>
      <p className="text-white/40 text-xs">{label}</p>
    </div>
  )
}

// ── Bands tab ─────────────────────────────────────────────────────────────────

function BandsTab({ symbol, band, allocation, fiscalYear, remaining, onBandSaved }: {
  symbol: string; band: BuyBand | null; allocation: StockAllocation | null
  fiscalYear: FiscalYear | null; remaining: number
  onBandSaved: (b: BuyBand) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [cmpInput, setCmpInput] = useState(band?.manual_cmp?.toString() ?? '')
  const [saving, setSaving]     = useState(false)
  const signal = band ? getBandSignal(band) : 'unknown'
  const totalCapital = fiscalYear?.total_budget_inr ?? 0
  const tranche = band?.buy_low != null ? trancheSuggestion(remaining, totalCapital) : null

  async function saveCMP() {
    if (!band || !cmpInput) return
    setSaving(true)
    const sb = getSupabaseBrowser()
    const cmp = parseFloat(cmpInput)
    const { data } = await sb.from('buy_bands')
      .upsert({ ...band, manual_cmp: cmp })
      .select().single()
    if (data) onBandSaved(data)
    setSaving(false)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {band?.buy_low != null ? (
        <>
          {/* Signal + CMP input */}
          <div className="p-4 rounded-2xl bg-white/5">
            <div className="flex items-center justify-between mb-3">
              <BandSignalBadge signal={signal} />
              <div className="flex items-center gap-2">
                <input
                  type="number" inputMode="decimal"
                  placeholder="Set CMP"
                  value={cmpInput}
                  onChange={e => setCmpInput(e.target.value)}
                  className="w-24 px-2 py-1.5 rounded-lg bg-white/10 text-white text-sm tabnum
                             border border-white/10 outline-none text-right"
                />
                <button onClick={saveCMP} disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-white/15 text-white text-sm font-medium
                             disabled:opacity-40">
                  {saving ? '…' : 'Set'}
                </button>
              </div>
            </div>

            <BandRangeBar
              buyLow={band.buy_low!} buyHigh={band.buy_high!}
              midLow={band.mid_low!} midHigh={band.mid_high!}
              trimPrice={band.trim_price!}
              cmp={band.manual_cmp}
              height={28}
            />

            <div className="grid grid-cols-3 gap-2 mt-3">
              <BandCell label="Buy"  lo={band.buy_low!} hi={band.buy_high!} color="text-green-400" />
              <BandCell label="Mid"  lo={band.mid_low!} hi={band.mid_high!} color="text-orange-400" />
              <div>
                <p className="text-xs tabnum text-red-400 font-semibold">≥₹{Math.round(band.trim_price!)}</p>
                <p className="text-white/30 text-[10px]">Trim</p>
              </div>
            </div>

            <p className="text-white/30 text-xs mt-2">Anchor: {band.anchor_type} · {new Date(band.last_updated_at).toLocaleDateString()}</p>
          </div>

          {/* Tranche suggestion */}
          {signal === 'buy' && tranche !== null && (
            <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
              <p className="text-green-400 text-sm font-semibold">Tranche suggestion</p>
              <p className="text-white/70 text-sm mt-1">
                Add <span className="font-bold text-white">{formatINR(tranche)}</span> near ₹{Math.round(band.buy_low!)} (low end)
              </p>
              <p className="text-white/30 text-xs mt-1">
                1–2% of {formatINR(totalCapital)} · Remaining: {formatINR(remaining)}
              </p>
            </div>
          )}

          {/* Input values */}
          {(band.eps || band.ebitda || band.bvps || band.embedded_value) && (
            <div className="p-4 rounded-2xl bg-white/5">
              <p className="text-white/40 text-xs mb-2 uppercase tracking-widest">Anchor Inputs</p>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                {band.eps           && <InputRow k="EPS"            v={`₹${band.eps}`} />}
                {band.bvps          && <InputRow k="BVPS"           v={`₹${band.bvps}`} />}
                {band.ebitda        && <InputRow k="EBITDA"         v={`${band.ebitda} Cr`} />}
                {band.net_debt      && <InputRow k="Net Debt"       v={`${band.net_debt} Cr`} />}
                {band.shares        && <InputRow k="Shares"         v={`${band.shares} Cr`} />}
                {band.embedded_value && <InputRow k="Embedded Value" v={`${band.embedded_value} Cr`} />}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <p className="text-white/40 mb-4">No bands set yet</p>
        </div>
      )}

      <button onClick={() => setShowForm(v => !v)}
        className="w-full py-3 rounded-xl border border-white/20 text-white/70 text-sm font-medium">
        {showForm ? 'Cancel' : band ? 'Recalculate Bands' : 'Set Bands'}
      </button>

      {showForm && <BandForm symbol={symbol} band={band} allocation={allocation} onSaved={b => { onBandSaved(b); setShowForm(false) }} />}
    </div>
  )
}

function BandCell({ label, lo, hi, color }: { label: string; lo: number; hi: number; color: string }) {
  return (
    <div>
      <p className={`text-xs tabnum font-semibold ${color}`}>₹{Math.round(lo)}–{Math.round(hi)}</p>
      <p className="text-white/30 text-[10px]">{label}</p>
    </div>
  )
}

function InputRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/40">{k}</span>
      <span className="tabnum">{v}</span>
    </div>
  )
}

// ── Band form ─────────────────────────────────────────────────────────────────

const ANCHOR_TYPES = ['PE', 'PB', 'EV_EBITDA', 'P_EV'] as const

function BandForm({ symbol, band, allocation, onSaved }: {
  symbol: string; band: BuyBand | null; allocation: StockAllocation | null
  onSaved: (b: BuyBand) => void
}) {
  const [anchor, setAnchor]       = useState<typeof ANCHOR_TYPES[number]>(band?.anchor_type ?? 'PE')
  const [eps, setEps]             = useState(band?.eps?.toString() ?? '')
  const [bvps, setBvps]           = useState(band?.bvps?.toString() ?? '')
  const [ebitda, setEbitda]       = useState(band?.ebitda?.toString() ?? '')
  const [netDebt, setNetDebt]     = useState(band?.net_debt?.toString() ?? '')
  const [shares, setShares]       = useState(band?.shares?.toString() ?? '')
  const [ev, setEv]               = useState(band?.embedded_value?.toString() ?? '')
  const [cmp, setCmp]             = useState(band?.manual_cmp?.toString() ?? '')
  const [notes, setNotes]         = useState(band?.notes ?? '')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function calculate() {
    if (!allocation) { setError('No allocation found for this stock'); return }
    const category = allocation.category as StockCategory

    const result = calculateBands({
      category,
      twoWeakQuarters:    allocation.two_weak_quarters,
      isHospitalRampPhase: allocation.is_hospital_ramp_phase,
      eps:            parseFloat(eps) || null,
      bvps:           parseFloat(bvps) || null,
      ebitda:         parseFloat(ebitda) || null,
      netDebt:        parseFloat(netDebt) || null,
      shares:         parseFloat(shares) || null,
      embeddedValue:  parseFloat(ev) || null,
    })

    if (!result) { setError('Insufficient inputs for this category. Check anchor type and inputs.'); return }

    setSaving(true)
    setError(null)
    const sb = getSupabaseBrowser()
    const upsertData = {
      ...(band ?? {}),
      symbol,
      anchor_type:    anchor,
      eps:            parseFloat(eps) || null,
      bvps:           parseFloat(bvps) || null,
      ebitda:         parseFloat(ebitda) || null,
      net_debt:       parseFloat(netDebt) || null,
      shares:         parseFloat(shares) || null,
      embedded_value: parseFloat(ev) || null,
      manual_cmp:     parseFloat(cmp) || null,
      buy_low:        result.buyLow,
      buy_high:       result.buyHigh,
      mid_low:        result.midLow,
      mid_high:       result.midHigh,
      trim_price:     result.trimPrice,
      last_updated_at: new Date().toISOString(),
      notes,
    }

    const { data, error } = await sb.from('buy_bands').upsert(upsertData, { onConflict: 'user_id,symbol' }).select().single()
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved(data)
  }

  const F = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <div>
      <label className="text-xs text-white/40 mb-1 block">{label}</label>
      <input type="number" inputMode="decimal" placeholder={placeholder ?? '0'} value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg bg-white/10 text-white text-sm tabnum border border-white/10 outline-none" />
    </div>
  )

  return (
    <div className="space-y-4 p-4 rounded-2xl bg-white/5">
      <p className="text-white/40 text-xs uppercase tracking-widest">
        Category: {allocation?.category ?? '—'}
      </p>

      {/* Anchor type */}
      <div>
        <label className="text-xs text-white/40 mb-1 block">Anchor</label>
        <div className="flex gap-1 flex-wrap">
          {ANCHOR_TYPES.map(a => (
            <button key={a} type="button" onClick={() => setAnchor(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                anchor === a ? 'bg-white text-black' : 'bg-white/10 text-white/60'
              }`}>{a}</button>
          ))}
        </div>
      </div>

      {(anchor === 'PE') && <F label="TTM EPS (₹)"        value={eps}     onChange={setEps}     />}
      {(anchor === 'PB') && <F label="BVPS (₹)"           value={bvps}    onChange={setBvps}    />}
      {(anchor === 'EV_EBITDA' || anchor === 'PE') && (
        <div className="grid grid-cols-3 gap-2">
          <F label="EBITDA (₹Cr)"   value={ebitda}  onChange={setEbitda}  />
          <F label="Net Debt (₹Cr)" value={netDebt} onChange={setNetDebt} placeholder="-ve=cash" />
          <F label="Shares (Cr)"    value={shares}  onChange={setShares}  />
        </div>
      )}
      {anchor === 'P_EV' && (
        <div className="grid grid-cols-2 gap-2">
          <F label="Embedded Value (₹Cr)" value={ev}     onChange={setEv}     />
          <F label="Shares (Cr)"          value={shares} onChange={setShares} />
        </div>
      )}
      <F label="Current CMP (₹) — optional" value={cmp} onChange={setCmp} />

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button onClick={calculate} disabled={saving}
        className="w-full py-3 rounded-xl bg-white text-black font-bold text-sm disabled:opacity-40">
        {saving ? 'Calculating…' : 'Calculate & Save'}
      </button>
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
      {/* Quick add link */}
      <Link href={`/add?symbol=${symbol}`}
        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 text-white
                   font-medium text-sm mb-4 active:bg-white/20">
        <span className="text-lg">+</span> Add transaction for {symbol}
      </Link>

      {transactions.length === 0 ? (
        <p className="text-white/30 text-center py-8">No transactions yet</p>
      ) : (
        <div className="space-y-2">
          {transactions.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
              <TradeTypeBadge type={t.trade_type} />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="text-sm tabnum">{Math.round(t.quantity)} × ₹{Math.round(t.price)}</span>
                  <span className="font-semibold tabnum text-sm">{formatINR(t.amount)}</span>
                </div>
                <p className="text-white/40 text-xs">{formatDate(t.trade_date)}{t.notes ? ` · ${t.notes}` : ''}</p>
              </div>
              <button onClick={() => del(t.id)} disabled={deleting === t.id}
                className="text-white/20 text-lg disabled:opacity-40 px-1">
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
  { key: 'sector_winds',        noteKey: 'sector_winds_note',         label: '0 · Sector Winds' },
  { key: 'circle_of_competence', noteKey: 'circle_note',             label: '1 · Circle of Competence' },
  { key: 'moat',                noteKey: 'moat_note',                 label: '2 · Moat' },
  { key: 'owner_earnings',      noteKey: 'owner_earnings_note',       label: '3 · Owner Earnings' },
  { key: 'capital_efficiency',  noteKey: 'capital_efficiency_note',   label: '4 · Capital Efficiency' },
  { key: 'innovation_velocity', noteKey: 'innovation_note',           label: '5 · Innovation Velocity' },
  { key: 'governance',          noteKey: 'governance_note',           label: '6 · Governance' },
  { key: 'execution_track',     noteKey: 'execution_note',            label: '7 · Execution Track' },
  { key: 'supply_chain_risk',   noteKey: 'supply_chain_note',         label: '8 · Supply Chain Risk' },
  { key: 'regulatory_signal',   noteKey: 'regulatory_note',           label: '9 · Regulatory Signal' },
  { key: 'thesis_breaker',      noteKey: 'thesis_breaker_note',       label: '10 · Thesis Breaker' },
  { key: 'capital_discipline',  noteKey: 'capital_discipline_note',   label: '11 · Capital Discipline' },
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
      <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5">
        <InvestableBadge investable={editing ? draft.investable : (inv?.investable ?? true)} />
        <div className="text-right text-sm">
          <span className="text-green-400">{passes} ✅</span>
          {cautions > 0 && <span className="text-orange-400 ml-2">{cautions} ⚠️</span>}
          {fails > 0    && <span className="text-red-400 ml-2">{fails} ❌</span>}
        </div>
      </div>

      {editing ? (
        <>
          {/* Edit mode */}
          <div className="space-y-1">
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
              <span className="text-sm">Investable?</span>
              <div className="flex gap-1">
                {[true, false].map(v => (
                  <button key={String(v)} onClick={() => setDraft(d => ({ ...d, investable: v }))}
                    className={`px-3 py-1 rounded-lg text-xs font-bold ${
                      draft.investable === v
                        ? v ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                        : 'bg-white/10 text-white/40'
                    }`}>{v ? 'YES' : 'NO'}</button>
                ))}
              </div>
            </div>

            {GATES.map(gate => (
              <div key={gate.key} className="p-3 rounded-xl bg-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{gate.label}</span>
                  <div className="flex gap-1">
                    {(['pass', 'caution', 'fail'] as GateSignal[]).map(sig => (
                      <button key={sig} onClick={() => setDraft(d => ({ ...d, [gate.key]: sig }))}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          (draft as Record<string, unknown>)[gate.key] === sig
                            ? sig === 'pass' ? 'bg-green-500 text-white'
                            : sig === 'caution' ? 'bg-orange-500 text-white'
                            : 'bg-red-500 text-white'
                            : 'bg-white/10 text-white/30'
                        }`}>
                        {sig === 'pass' ? '✅' : sig === 'caution' ? '⚠️' : '❌'}
                      </button>
                    ))}
                  </div>
                </div>
                <input type="text" placeholder="Note (optional)"
                  value={((draft as Record<string, unknown>)[gate.noteKey] as string) ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [gate.noteKey]: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded bg-white/5 text-white/60 text-xs border border-white/10 outline-none" />
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditing(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 text-white/60 text-sm">Cancel</button>
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-white text-black font-bold text-sm disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Read mode */}
          <div className="space-y-1">
            {GATES.map(gate => {
              const rec    = (inv ?? draft) as unknown as Record<string, unknown>
              const signal = rec[gate.key] as GateSignal
              const note   = rec[gate.noteKey] as string
              return (
                <div key={gate.key} className="flex items-start gap-3 py-2 border-b border-white/5">
                  <GateSignalIcon signal={signal} compact />
                  <div className="flex-1">
                    <p className="text-sm text-white/80">{gate.label}</p>
                    {note && <p className="text-xs text-white/40 mt-0.5">{note}</p>}
                  </div>
                </div>
              )
            })}
          </div>
          {inv && (
            <p className="text-white/30 text-xs">Last assessed: {formatDate(inv.assessed_at)}</p>
          )}
          <button onClick={() => setEditing(true)}
            className="w-full py-3 rounded-xl border border-white/20 text-white/60 text-sm">
            Edit Assessment
          </button>
        </>
      )}
    </div>
  )
}
