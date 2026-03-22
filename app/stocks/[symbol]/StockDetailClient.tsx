'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { calculateBands, getBandSignal, trancheSuggestion } from '@/lib/band-calculator'
import { BandSignalBadge, TradeTypeBadge, GateSignalIcon, InvestableBadge } from '@/components/SignalBadge'
import { formatINR, formatPnL, formatPct, formatDate, shortMonthYear } from '@/lib/formatter'
import { type StockCategory } from '@/lib/types'
import type { FiscalYear, StockAllocation, Transaction, BuyBand, Investability, GateSignal, BuyTranche } from '@/lib/types'
import TrancheSection from '@/components/TrancheSection'
import { getStockName } from '@/lib/stock-names'

interface Props {
  symbol: string
  fiscalYear: FiscalYear | null
  allocation: StockAllocation | null
  transactions: Transaction[]
  allTransactions: Transaction[]
  allFYBudget: number
  carryoverInr: number
  band: BuyBand | null
  investability: Investability | null
  userId: string
}

export default function StockDetailClient({
  symbol, fiscalYear, allocation, transactions, allTransactions, allFYBudget, carryoverInr,
  band: initialBand, investability: initialInv, userId,
}: Props) {
  const router = useRouter()
  const [band, setBand] = useState(initialBand)
  const [inv, setInv]   = useState(initialInv)

  // Filter out advance buys tagged for a different FY — mirrors computeStockRows logic
  const fyTxns = fiscalYear
    ? transactions.filter(t => t.advance_fy_id == null || t.advance_fy_id === fiscalYear.id)
    : transactions
  const buys  = fyTxns.filter(t => t.trade_type === 'buy')
  const sells = fyTxns.filter(t => t.trade_type === 'sell')
  const totalBought   = buys.reduce((s, t) => s + t.quantity, 0)
  const totalBuyValue = buys.reduce((s, t) => s + t.amount, 0)
  const totalSold     = sells.reduce((s, t) => s + t.quantity, 0)
  const qty     = Math.max(0, totalBought - totalSold)
  const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
  const totalSellValue = sells.reduce((s, t) => s + t.amount, 0)
  const spent   = totalBuyValue - totalSellValue

  const budget    = allocation && fiscalYear
    ? (allocation.allocation_pct / 100) * (fiscalYear.total_budget_inr + (fiscalYear.unallocated_carryover_inr ?? 0)) + carryoverInr
    : 0
  const remaining = budget - spent

  // All-FY aggregates — net capital (buys minus sells across all FYs)
  const allFYBuys  = allTransactions.filter(t => t.trade_type === 'buy').reduce((s, t)  => s + t.amount, 0)
  const allFYSells = allTransactions.filter(t => t.trade_type === 'sell').reduce((s, t) => s + t.amount, 0)
  const allFYSpent = allFYBuys - allFYSells
  const cmp       = band?.manual_cmp ?? null
  const pnl       = cmp !== null && qty > 0 ? (cmp - avgCost) * qty : null
  const pnlPct    = (cmp !== null && avgCost > 0) ? (cmp - avgCost) / avgCost * 100 : null
  const signal    = band ? getBandSignal(band) : 'unknown'

  return (
    <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Back + header */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <button onClick={() => router.back()} style={{ color: 'var(--text-muted)' }} className="mt-0.5 p-3 -ml-3">
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

      {/* Budget + holdings — always visible flat section */}
      <div className="px-4 pt-3 pb-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <M label="Total Budget" value={formatINR(allFYBudget)} />
          <M label="Total Spent"  value={formatINR(allFYSpent)} />
          <M label={`${fiscalYear?.label ?? 'This Year'} Budget`}    value={formatINR(budget)} />
          <M label={`${fiscalYear?.label ?? 'This Year'} Remaining`} value={formatINR(remaining)}
             color={remaining < 0 ? 'text-red-400' : undefined} />
          {carryoverInr !== 0 && (
            <M label="Carryover"
               value={`${carryoverInr > 0 ? '+' : '−'}${formatINR(Math.abs(carryoverInr))}`}
               color={carryoverInr > 0 ? 'text-green-500' : 'text-red-400'} />
          )}
        </div>

        {qty > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-faint)' }}>
            <M label="Shares"   value={`${Math.round(qty)}`} />
            <M label="Avg Cost" value={avgCost > 0 ? `₹${Math.round(avgCost)}` : '—'} />
            {cmp !== null && <M label="CMP" value={`₹${Math.round(cmp)}`} />}
            {pnl !== null && (
              <M label="Unrealised P&L"
                 value={`${formatPnL(pnl)}${pnlPct !== null ? ` (${formatPct(pnlPct)})` : ''}`}
                 color={pnl >= 0 ? 'text-green-500' : 'text-red-400'} />
            )}
          </div>
        )}
      </div>

      <div className="overflow-y-auto" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>
        {/* Financials */}
        <Collapsible title="Financials">
          <FinancialsCard
            symbol={symbol} band={band} allocation={allocation}
            fyId={fiscalYear?.id ?? ''} hasKey={null}
            onBandSaved={setBand} onTranchesUpdated={() => {}} flat
          />
        </Collapsible>

        {/* Transactions */}
        <Collapsible title="Transactions">
          <TxnsTab symbol={symbol} transactions={transactions} userId={userId} fiscalYear={fiscalYear} onAdded={() => router.refresh()} />
        </Collapsible>
      </div>
    </div>
  )
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b" style={{ borderColor: 'var(--border-faint)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4"
        style={{ minHeight: '44px' }}>
        <span className="text-[15px] font-semibold">{title}</span>
        <svg className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
             style={{ color: 'var(--text-faint)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && children}
    </div>
  )
}


function M({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`font-semibold tabnum text-[17px] ${color ?? ''}`}
         style={color ? undefined : { color: 'var(--text-primary)' }}>
        {value}
      </p>
      <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
    </div>
  )
}

// ── Financials card ────────────────────────────────────────────────────────────

function FinancialsCard({ symbol, band, allocation, fyId, hasKey: hasKeyProp, onBandSaved, onTranchesUpdated, flat }: {
  symbol: string
  band: BuyBand | null
  allocation: StockAllocation | null
  fyId: string
  hasKey: boolean | null
  onBandSaved: (b: BuyBand) => void
  onTranchesUpdated: (t: BuyTranche[]) => void
  flat?: boolean
}) {
  const [hasKey, setHasKey] = useState(hasKeyProp)
  useEffect(() => {
    if (hasKeyProp !== null) { setHasKey(hasKeyProp); return }
    fetch('/api/settings/gemini-key')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false))
  }, [hasKeyProp])
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
    }
    setSaving(false)
    setEditing(false)
  }

  const hasData = !!(band?.eps || band?.bvps || band?.ebitda || band?.embedded_value)

  const inner = (
    <>
      {/* Header row: edit button only */}
      {!editing && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setEditing(true)}
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <PencilIcon className="w-4 h-4" />
          </button>
        </div>
      )}

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
        <div className="grid grid-cols-2 gap-y-4 gap-x-4">
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
    </>
  )

  return flat
    ? <div className="px-4 pb-4">{inner}</div>
    : <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>{inner}</div>
}


function InputRow({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{k}</p>
      <p className="font-semibold tabnum text-[15px]" style={{ color: 'var(--text-primary)' }}>{v}</p>
    </div>
  )
}

function SparkleIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  )
}

function PencilIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
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
    setDeleting(null)
    router.refresh()
  }

  return (
    <div>
      <div className="px-4 border-b" style={{ borderColor: 'var(--border-faint)' }}>
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('open-add-txn', { detail: { symbol } }))}
          className="flex items-center gap-2 font-medium text-[14px]"
          style={{ color: '#0A84FF', minHeight: '44px' }}>
          <span className="text-lg leading-none">+</span> Add transaction for {symbol}
        </button>
      </div>

      {transactions.length === 0 ? (
        <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No transactions yet</p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border-faint)' }}>
          {transactions.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
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
                className="text-[15px] px-3 rounded-lg disabled:opacity-40 flex items-center justify-center flex-shrink-0"
                style={{ color: '#FF3B30', background: 'rgba(255,59,48,0.08)', minWidth: '44px', minHeight: '44px' }}>
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
