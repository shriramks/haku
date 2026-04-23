'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatINRFine, todayISO } from '@/lib/formatter'
import { ChevronRightIcon, PencilIcon, SearchIcon } from '@/components/icons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { mfXirr, sgbXirr, ppfXirr, computePPFBalance } from '@/lib/xirr'
import { upsertMFund, addMFTransaction, addSGBTransaction, addPPFTransaction, setPPFBalanceOverride } from './actions'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, MFHolding, SGBBatch, EquitySummary, PPFSummary } from '@/lib/portfolio-types'
import type { Transaction, BuyBand } from '@/lib/types'

interface Props {
  allTransactions: Transaction[]
  bands: BuyBand[]
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  sgbTransactions: SGBTransaction[]
  ppfTransactions: PPFTransaction[]
  ppfOverride: PPFBalanceOverride | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeEquity(transactions: Transaction[], bands: BuyBand[]): EquitySummary {
  const map: Record<string, { qty: number; invested: number }> = {}
  for (const txn of transactions) {
    if (!map[txn.symbol]) map[txn.symbol] = { qty: 0, invested: 0 }
    const h = map[txn.symbol]
    if (txn.trade_type === 'buy') {
      h.qty      += txn.quantity
      h.invested += txn.amount
    } else {
      const avgCost = h.qty > 0 ? h.invested / h.qty : 0
      h.qty      -= txn.quantity
      h.invested -= txn.quantity * avgCost
    }
  }
  let invested = 0, currentValue = 0, holdingsCount = 0
  for (const [symbol, h] of Object.entries(map)) {
    if (h.qty <= 0.001) continue
    holdingsCount++
    const cost = Math.max(0, h.invested)
    invested     += cost
    const band    = bands.find(b => b.symbol === symbol)
    currentValue += band?.manual_cmp ? h.qty * band.manual_cmp : cost
  }
  return { holdingsCount, invested, currentValue }
}

function computeMFHoldings(
  funds: MFund[],
  transactions: MFTransaction[],
  navs: Record<string, number>,
): MFHolding[] {
  const byFund: Record<string, MFTransaction[]> = {}
  for (const t of transactions) {
    ;(byFund[t.fund_id] ??= []).push(t)
  }
  return funds.flatMap(fund => {
    const txns = byFund[fund.id] ?? []
    if (txns.length === 0) return []
    let units = 0, invested = 0
    for (const t of txns) {
      if (t.trade_type === 'buy') {
        units    += t.units
        invested += t.amount
      } else {
        const avgNav = units > 0 ? invested / units : 0
        units    -= t.units
        invested -= t.units * avgNav
      }
    }
    if (units < 0.001) return []
    const currentNav   = navs[fund.scheme_code] ?? null
    const currentValue = currentNav !== null ? units * currentNav : null
    const gain         = currentValue !== null ? currentValue - invested : null
    return [{
      fund, transactions: txns, units, invested,
      currentNav, currentValue, gain,
      xirr: currentValue !== null ? mfXirr(txns, currentValue) : null,
    }]
  })
}

function computeSGBBatches(transactions: SGBTransaction[], goldPrice: number | null): SGBBatch[] {
  const map = new Map<string, { transactions: SGBTransaction[]; grams: number; invested: number; maturityDate: string | null }>()
  for (const t of transactions) {
    const d   = new Date(t.trade_date)
    const key = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    const b   = map.get(key) ?? { transactions: [], grams: 0, invested: 0, maturityDate: null }
    b.transactions.push(t)
    if (t.trade_type === 'buy') {
      b.grams    += t.grams
      b.invested += t.amount
      if (!b.maturityDate) b.maturityDate = t.maturity_date
    } else {
      const avgPpg = b.grams > 0 ? b.invested / b.grams : 0
      b.grams    -= t.grams
      b.invested -= t.grams * avgPpg
    }
    map.set(key, b)
  }
  return Array.from(map.entries())
    .filter(([, b]) => b.grams > 0.001)
    .map(([key, b]) => {
      const inv          = Math.max(0, b.invested)
      const currentValue = goldPrice !== null ? b.grams * goldPrice : null
      const gain         = currentValue !== null ? currentValue - inv : null
      return {
        key,
        transactions: b.transactions,
        grams:        b.grams,
        invested:     inv,
        maturityDate: b.maturityDate,
        currentValue,
        gain,
        xirr: currentValue !== null ? sgbXirr(b.transactions, currentValue) : null,
      }
    })
}

function computePPF(transactions: PPFTransaction[], override: PPFBalanceOverride | null): PPFSummary {
  const totalDeposited = transactions
    .filter(t => t.trade_type === 'deposit')
    .reduce((s, t) => s + t.amount, 0)
  const computedBalance = computePPFBalance(transactions)
  const currentBalance  = override?.balance ?? computedBalance
  return {
    transactions,
    totalDeposited,
    computedBalance,
    currentBalance,
    override,
    xirr: ppfXirr(transactions, currentBalance),
  }
}

function assetClass(schemeType: string): 'equity' | 'debt' {
  const t = schemeType.toLowerCase()
  if (t.includes('debt') || t.includes('liquid') || t.includes('fixed') || t.includes('bond') || t.includes('overnight') || t.includes('duration')) return 'debt'
  return 'equity'
}

function fmtXirr(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(1)}% p.a.`
}

function fmtGain(gain: number | null): string {
  if (gain === null) return '—'
  return (gain >= 0 ? '+' : '') + formatINR(gain)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioClient({
  allTransactions, bands, mfFunds, mfTransactions,
  sgbTransactions, ppfTransactions, ppfOverride,
}: Props) {
  const [openSections, setOpenSections] = useState(new Set(['equity', 'mf', 'sgb', 'ppf']))
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const [addSheet, setAddSheet] = useState<'mf' | 'sgb' | 'ppf' | null>(null)
  const [navs, setNavs]         = useState<Record<string, number>>({})
  const [navsLoading, setNavsLoading] = useState(mfFunds.length > 0)
  const [goldPrice, setGoldPrice] = useState<number | null>(null)

  // Live gold price from IBJA via our proxy
  useEffect(() => {
    fetch('/api/gold-price')
      .then(r => r.json())
      .then(d => { if (d.pricePerGram) setGoldPrice(d.pricePerGram) })
      .catch(() => {})
  }, [])

  // Live NAV fetch from mfapi.in
  useEffect(() => {
    if (mfFunds.length === 0) return
    Promise.all(
      mfFunds.map(f =>
        fetch(`https://api.mfapi.in/mf/${f.scheme_code}`)
          .then(r => r.json())
          .then(d => [f.scheme_code, parseFloat(d.data?.[0]?.nav ?? '0')] as [string, number])
          .catch(() => [f.scheme_code, 0] as [string, number])
      )
    ).then(results => {
      const m: Record<string, number> = {}
      for (const [code, nav] of results) { if (nav > 0) m[code] = nav }
      setNavs(m)
      setNavsLoading(false)
    })
  }, [mfFunds])

  const equity     = useMemo(() => computeEquity(allTransactions, bands), [allTransactions, bands])
  const mfHoldings = useMemo(() => computeMFHoldings(mfFunds, mfTransactions, navs), [mfFunds, mfTransactions, navs])
  const sgbBatches = useMemo(() => computeSGBBatches(sgbTransactions, goldPrice), [sgbTransactions, goldPrice])
  const ppf        = useMemo(() => computePPF(ppfTransactions, ppfOverride), [ppfTransactions, ppfOverride])

  // Summary numbers
  const mfInvested      = mfHoldings.reduce((s, h) => s + h.invested, 0)
  const mfCurrentValue  = mfHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const sgbInvested     = sgbBatches.reduce((s, b) => s + b.invested, 0)
  const sgbCurrentValue = sgbBatches.reduce((s, b) => s + (b.currentValue ?? b.invested), 0)
  const totalInvested   = equity.invested + mfInvested + sgbInvested + ppf.totalDeposited
  const totalCurrent    = equity.currentValue + mfCurrentValue + sgbCurrentValue + ppf.currentBalance
  const totalGain       = totalCurrent - totalInvested

  // Asset allocation for donut
  const mfEquity  = mfHoldings.filter(h => assetClass(h.fund.scheme_type) === 'equity').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfDebt    = mfHoldings.filter(h => assetClass(h.fund.scheme_type) === 'debt').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const totalForAlloc = equity.currentValue + mfEquity + mfDebt + sgbInvested + ppf.currentBalance
  const eqPct  = totalForAlloc > 0 ? Math.round((equity.currentValue + mfEquity) / totalForAlloc * 100) : 0
  const debtPct = totalForAlloc > 0 ? Math.round((mfDebt + ppf.currentBalance) / totalForAlloc * 100) : 0
  const goldPct = 100 - eqPct - debtPct

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAdd(type: 'mf' | 'sgb' | 'ppf') {
    setTypePickerOpen(false)
    setTimeout(() => setAddSheet(type), 50)
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl border-b flex items-center px-2"
           style={{ background: 'var(--bg-nav)', borderColor: 'var(--border-faint)', paddingTop: 'max(env(safe-area-inset-top,0px), 14px)', paddingBottom: 12 }}>
        <Link href="/allocation"
              className="flex items-center justify-center min-w-[44px] min-h-[44px]"
              style={{ color: 'var(--accent)' }}>
          <svg width="11" height="19" viewBox="0 0 11 19" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 1.5L1.5 9.5L9 17.5" />
          </svg>
        </Link>
        <h1 className="text-display font-bold flex-1 pl-1">Portfolio</h1>
      </div>

      {/* Compact summary: 2×2 grid + donut */}
      <div className="flex items-center gap-3 px-4 py-3 border-b"
           style={{ borderColor: 'var(--border-faint)' }}>
        <div className="flex-1 grid grid-cols-2">
          {/* Row 1 */}
          <SCell label="Current Value" value={formatINRFine(totalCurrent)} />
          <SCell label="Invested" value={formatINRFine(totalInvested)} right />
          {/* Row 2 */}
          <SCell label="Gain" value={fmtGain(totalGain)} positive={totalGain > 0} negative={totalGain < 0} topBorder />
          <SCell label="XIRR p.a." value="—" topBorder right />
        </div>
        <DonutChart equity={eqPct} debt={debtPct} gold={goldPct} />
      </div>

      {/* Scrollable sections */}
      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

        {/* EQUITY */}
        <SectionHeader
          id="equity" label="Stocks"
          currentValue={formatINRFine(equity.currentValue)}
          gainPct={equity.invested > 0 ? ((equity.currentValue - equity.invested) / equity.invested * 100) : null}
          open={openSections.has('equity')}
          onToggle={() => toggleSection('equity')}
        />
        {openSections.has('equity') && (
          <Link href="/allocation"
                className="flex items-center px-4 border-t"
                style={{ minHeight: 52, borderColor: 'var(--divider)' }}>
            <div className="flex-1">
              <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>
                {equity.holdingsCount} holding{equity.holdingsCount !== 1 ? 's' : ''}
              </p>
              <p className="text-footnote mt-0.5" style={{ color: 'var(--text-faint)' }}>View in Allocation</p>
            </div>
            <div className="text-right mr-2">
              <p className="text-headline font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>{formatINRFine(equity.currentValue)}</p>
              <p className="text-footnote tabnum mt-0.5" style={{ color: equity.currentValue > equity.invested ? 'var(--c-positive)' : 'var(--text-faint)' }}>
                {fmtGain(equity.currentValue - equity.invested)}
              </p>
            </div>
            <ChevronRightIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
          </Link>
        )}

        {/* MUTUAL FUNDS */}
        <SectionHeader
          id="mf" label="Mutual Funds"
          currentValue={navsLoading ? '…' : formatINRFine(mfCurrentValue)}
          gainPct={mfInvested > 0 && !navsLoading ? ((mfCurrentValue - mfInvested) / mfInvested * 100) : null}
          open={openSections.has('mf')}
          onToggle={() => toggleSection('mf')}
        />
        {openSections.has('mf') && (
          <>
            {mfHoldings.length > 0 && (
              <>
                <ColHeaders c1="Fund" c2="Invested" c3="Current" c4="Return" />
                {mfHoldings.map(h => (
                  <FundRow key={h.fund.id}
                    name={h.fund.scheme_name}
                    meta={`${h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`}
                    invested={formatINRFine(h.invested)}
                    current={h.currentValue !== null ? formatINRFine(h.currentValue) : '—'}
                    gain={fmtGain(h.gain)}
                    xirr={fmtXirr(h.xirr)}
                    positive={(h.gain ?? 0) > 0}
                  />
                ))}
              </>
            )}
            {mfHoldings.length === 0 && (
              <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No mutual fund holdings yet.</p>
            )}
          </>
        )}

        {/* SGBs */}
        <SectionHeader
          id="sgb" label="SGBs"
          currentValue={formatINRFine(sgbCurrentValue)}
          gainPct={sgbInvested > 0 && goldPrice !== null ? ((sgbCurrentValue - sgbInvested) / sgbInvested * 100) : null}
          open={openSections.has('sgb')}
          onToggle={() => toggleSection('sgb')}
        />
        {openSections.has('sgb') && (
          <>
            {sgbBatches.length > 0 && (
              <>
                <ColHeaders c1="Batch" c2="Invested" c3="Current" c4="Return" />
                {sgbBatches.map(b => (
                  <FundRow key={b.key}
                    name={b.key}
                    meta={`${b.grams.toFixed(1)}g · ${b.maturityDate ? new Date(b.maturityDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}`}
                    invested={formatINRFine(b.invested)}
                    current={b.currentValue !== null ? formatINRFine(b.currentValue) : '—'}
                    gain={fmtGain(b.gain)}
                    xirr={fmtXirr(b.xirr)}
                    positive={(b.gain ?? 0) > 0}
                  />
                ))}
              </>
            )}
            {sgbBatches.length === 0 && (
              <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No SGB holdings yet.</p>
            )}
          </>
        )}

        {/* PPF */}
        <SectionHeader
          id="ppf" label="PPF"
          currentValue={formatINRFine(ppf.currentBalance)}
          gainPct={ppf.totalDeposited > 0 ? ((ppf.currentBalance - ppf.totalDeposited) / ppf.totalDeposited * 100) : null}
          open={openSections.has('ppf')}
          onToggle={() => toggleSection('ppf')}
        />
        {openSections.has('ppf') && (
          <PPFRow ppf={ppf} />
        )}

        {/* Single add button */}
        <button
          onClick={() => setTypePickerOpen(true)}
          className="flex items-center justify-center gap-2 mx-4 mt-3 border rounded-2xl text-accent font-semibold text-body"
          style={{ minHeight: 48, borderColor: 'var(--border)' }}>
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add transaction
        </button>
      </div>

      {/* Type picker sheet */}
      {typePickerOpen && (
        <TypePickerSheet onClose={() => setTypePickerOpen(false)} onSelect={openAdd} />
      )}

      {/* Add sheets */}
      {addSheet === 'mf' && (
        <AddMFSheet
          existingFunds={mfFunds}
          onClose={() => setAddSheet(null)}
        />
      )}
      {addSheet === 'sgb' && (
        <AddSGBSheet onClose={() => setAddSheet(null)} />
      )}
      {addSheet === 'ppf' && (
        <AddPPFSheet onClose={() => setAddSheet(null)} />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SCell({ label, value, right, topBorder, positive, negative }: {
  label: string; value: string; right?: boolean; topBorder?: boolean; positive?: boolean; negative?: boolean
}) {
  return (
    <div className={`flex flex-col gap-0.5 py-1.5 ${right ? 'items-end pl-3' : ''}`}
         style={topBorder ? { borderTop: '1px solid var(--border-faint)' } : {}}>
      <p className="text-footnote" style={{ color: 'var(--text-faint)', letterSpacing: '0.02em' }}>{label}</p>
      <p className={`text-headline font-bold tabnum`}
         style={{ color: positive ? 'var(--c-positive)' : negative ? 'var(--c-negative)' : 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}

function DonutChart({ equity, debt, gold }: { equity: number; debt: number; gold: number }) {
  const r   = 26
  const c   = 2 * Math.PI * r  // 163.36
  const eqLen   = (equity / 100) * c
  const debtLen = (debt   / 100) * c
  const goldLen = (gold   / 100) * c
  const eqAngle   = -90
  const debtAngle = eqAngle   + equity * 3.6
  const goldAngle = debtAngle + debt   * 3.6

  return (
    <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
      <svg width="64" height="64" viewBox="0 0 66 66">
        <circle cx="33" cy="33" r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth="8" />
        {eqLen > 0.5 && (
          <circle cx="33" cy="33" r={r} fill="none" stroke="var(--accent)" strokeWidth="8"
            strokeDasharray={`${eqLen} ${c}`} transform={`rotate(${eqAngle} 33 33)`} />
        )}
        {debtLen > 0.5 && (
          <circle cx="33" cy="33" r={r} fill="none" stroke="var(--c-warning)" strokeWidth="8"
            strokeDasharray={`${debtLen} ${c}`} transform={`rotate(${debtAngle} 33 33)`} />
        )}
        {goldLen > 0.5 && (
          <circle cx="33" cy="33" r={r} fill="none" stroke="#FFD60A" strokeWidth="8"
            strokeDasharray={`${goldLen} ${c}`} transform={`rotate(${goldAngle} 33 33)`} />
        )}
      </svg>
      <div className="flex flex-col gap-0.5">
        {[
          { label: 'Eq', pct: equity, color: 'var(--accent)' },
          { label: 'Debt', pct: debt, color: 'var(--c-warning)' },
          { label: 'Gold', pct: gold, color: '#FFD60A' },
        ].map(({ label, pct, color }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: color }} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
            <span className="text-[9px] font-bold tabnum" style={{ color: 'var(--text-2)' }}>{pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionHeader({ id, label, currentValue, gainPct, open, onToggle }: {
  id: string; label: string; currentValue: string; gainPct: number | null; open: boolean; onToggle: () => void
}) {
  return (
    <button onClick={onToggle}
            className="flex items-center w-full px-4"
            style={{ minHeight: 44, paddingTop: 14, paddingBottom: 6 }}>
      <span className="flex-1 text-left text-footnote font-bold uppercase"
            style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{label}</span>
      <div className="flex flex-col items-end gap-0.5 mr-2">
        <span className="text-footnote font-bold tabnum" style={{ color: 'var(--text-faint)' }}>{currentValue}</span>
        {gainPct !== null && (
          <span className="text-[10px] tabnum" style={{ color: gainPct >= 0 ? 'rgba(52,199,89,0.8)' : 'rgba(255,59,48,0.8)' }}>
            {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
          </span>
        )}
      </div>
      <ChevronRightIcon
        className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        style={{ color: 'var(--text-faint)' }} />
    </button>
  )
}

function ColHeaders({ c1, c2, c3, c4 }: { c1: string; c2: string; c3: string; c4: string }) {
  return (
    <div className="flex items-center px-4 py-1 border-t"
         style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'var(--divider)' }}>
      <span className="flex-1 text-[9px] font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c1}</span>
      <span className="text-[9px] font-bold uppercase text-right" style={{ width: 60, color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c2}</span>
      <span className="text-[9px] font-bold uppercase text-right" style={{ width: 60, color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c3}</span>
      <span className="text-[9px] font-bold uppercase text-right" style={{ width: 60, color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c4}</span>
    </div>
  )
}

function FundRow({ name, meta, invested, current, gain, xirr, positive }: {
  name: string; meta: string; invested: string; current: string;
  gain: string; xirr: string; positive: boolean
}) {
  return (
    <div className="flex items-center px-4 border-t"
         style={{ minHeight: 52, borderColor: 'var(--divider)' }}>
      <div className="flex-1 min-w-0 pr-2">
        <p className="text-subheadline font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
        <p className="text-[10px] mt-0.5 tabnum" style={{ color: 'var(--text-faint)' }}>{meta}</p>
      </div>
      <NumCol value={invested} />
      <NumCol value={current} />
      <div style={{ width: 60, textAlign: 'right', flexShrink: 0 }}>
        <p className="text-subheadline font-semibold tabnum"
           style={{ color: positive ? 'var(--c-positive)' : 'var(--text-primary)' }}>{gain}</p>
        {xirr && <p className="text-[10px] tabnum mt-0.5" style={{ color: positive ? 'var(--c-positive)' : 'var(--text-faint)' }}>{xirr}</p>}
      </div>
    </div>
  )
}

function NumCol({ value }: { value: string }) {
  return (
    <div style={{ width: 60, textAlign: 'right', flexShrink: 0 }}>
      <p className="text-subheadline font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function PPFRow({ ppf }: { ppf: PPFSummary }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [balStr, setBalStr]   = useState(ppf.currentBalance.toFixed(0))
  const [saving, setSaving]   = useState(false)

  async function saveOverride() {
    setSaving(true)
    await setPPFBalanceOverride(parseFloat(balStr), todayISO())
    setSaving(false)
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="flex items-center px-4 border-t" style={{ minHeight: 52, borderColor: 'var(--divider)' }}>
      <div className="flex-1">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>PPF Account</p>
        <p className="text-footnote mt-0.5 tabnum" style={{ color: 'var(--text-faint)' }}>
          {formatINRFine(ppf.totalDeposited)} deposited · {ppf.override ? 'manual balance' : 'est. 7.1% p.a.'}
        </p>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={balStr}
            onChange={e => setBalStr(e.target.value)}
            className="tabnum font-bold text-body outline-none text-right rounded-xl px-2"
            style={{ width: 100, height: 36, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          />
          <button onClick={saveOverride} disabled={saving}
            className="text-accent text-body font-semibold min-h-[44px] px-2 disabled:opacity-50">
            {saving ? '…' : 'Save'}
          </button>
        </div>
      ) : (
        <>
          <div className="text-right mr-2">
            <p className="text-headline font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
              {formatINRFine(ppf.currentBalance)}
            </p>
            <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--c-positive)' }}>
              +{formatINRFine(ppf.currentBalance - ppf.totalDeposited)}
            </p>
          </div>
          <button onClick={() => setEditing(true)}
            className="flex items-center justify-center min-w-[44px] min-h-[44px]"
            style={{ color: 'var(--text-faint)' }}>
            <PencilIcon className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )
}

// ── Type picker sheet ─────────────────────────────────────────────────────────

function TypePickerSheet({ onClose, onSelect }: {
  onClose: () => void
  onSelect: (type: 'mf' | 'sgb' | 'ppf') => void
}) {
  const kh = useKeyboardHeight()
  useBodyScrollLock()
  const types = [
    { id: 'mf'  as const, label: 'Mutual Fund',      Icon: IconMF  },
    { id: 'sgb' as const, label: 'SGB',               Icon: IconSGB },
    { id: 'ppf' as const, label: 'PPF',               Icon: IconPPF },
  ]
  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl"
           style={{ bottom: kh, background: 'var(--bg-secondary)' }}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <p className="px-5 pt-1 pb-3 text-footnote font-bold uppercase"
           style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>Add to Portfolio</p>
        {types.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => onSelect(id)}
            className="flex items-center w-full px-5 border-t"
            style={{ minHeight: 56, borderColor: 'var(--divider)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mr-4 flex-shrink-0"
                 style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)' }}>
              <Icon />
            </div>
            <span className="flex-1 text-left text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
            <ChevronRightIcon className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          </button>
        ))}
        <div style={{ height: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }} />
      </div>
    </>
  )
}

// ── Add MF Sheet ──────────────────────────────────────────────────────────────

function AddMFSheet({ existingFunds, onClose }: { existingFunds: MFund[]; onClose: () => void }) {
  const router     = useRouter()
  const kh         = useKeyboardHeight()
  const [type, setType]       = useState<'buy' | 'sell'>('buy')
  const [fund, setFund]       = useState<{ code: string; name: string; schemeType: string } | null>(null)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<{ schemeCode: number; schemeName: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [date, setDate]       = useState(todayISO())
  const [units, setUnits]     = useState('')
  const [nav, setNav]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)
  useBodyScrollLock()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    setSearching(true)
    clearTimeout(debounceRef.current ?? undefined)
    debounceRef.current = setTimeout(() => {
      fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(d => { setResults((d as { schemeCode: number; schemeName: string }[]).slice(0, 6)); setSearching(false) })
        .catch(() => setSearching(false))
    }, 300)
  }, [query])

  const amount = (parseFloat(units) || 0) * (parseFloat(nav) || 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!fund || !units || !nav) return
    setLoading(true); setError(null)

    const { fundId, error: fundErr } = await upsertMFund(fund.code, fund.name, fund.schemeType)
    if (fundErr || !fundId) { setError(fundErr ?? 'Failed to save fund'); setLoading(false); return }

    const { error: txnErr } = await addMFTransaction(
      fundId, date, type, parseFloat(units), parseFloat(nav)
    )
    setLoading(false)
    if (txnErr) { setError(txnErr); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  const signalColor = type === 'buy' ? '#34C759' : '#FF3B30'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', maxHeight: '92dvh' }}>
        <SheetHandle />
        <SheetHeader title="New MF Transaction" onCancel={onClose} />

        {/* Toggle */}
        <div className="px-4 flex-shrink-0">
          <ToggleBuySell type={type} onChange={setType} />
        </div>

        {/* Amount hero */}
        <AmountHero amount={amount} type={type}
          breakdown={amount > 0 ? `${units} units × ₹${nav}` : undefined} />

        <div className="flex-shrink-0 mx-4" style={{ height: 1, background: 'var(--border-faint)', marginBottom: 14 }} />

        <form onSubmit={submit} className="overflow-y-auto flex-1 px-4 space-y-3"
              style={{ paddingBottom: kh > 0 ? 8 : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>

          {/* Fund selection */}
          <div>
            <FieldLabel>Fund</FieldLabel>
            {fund ? (
              <div className="flex items-center gap-3 px-3 py-3 rounded-xl"
                   style={{ background: 'var(--bg-tertiary)' }}>
                <p className="flex-1 text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {fund.name}
                </p>
                <button type="button" onClick={() => setFund(null)}
                  className="text-subheadline flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                  Change
                </button>
              </div>
            ) : (
              <>
                {existingFunds.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {existingFunds.map(f => (
                      <button key={f.id} type="button"
                        onClick={() => { setFund({ code: f.scheme_code, name: f.scheme_name, schemeType: f.scheme_type }); setQuery('') }}
                        className="px-3 py-2 rounded-xl text-body font-medium"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
                        {f.scheme_name.split(' ').slice(0, 3).join(' ')}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
                  <input
                    type="text"
                    placeholder="Search fund name…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="w-full pl-9 pr-3 rounded-xl text-body outline-none"
                    style={{ height: 44, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  />
                </div>
                {searching && (
                  <p className="text-subheadline mt-2 px-1" style={{ color: 'var(--text-faint)' }}>Searching…</p>
                )}
                {results.length > 0 && (
                  <div className="mt-1 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    {results.map((r, i) => (
                      <button key={r.schemeCode} type="button"
                        onClick={() => { setFund({ code: String(r.schemeCode), name: r.schemeName, schemeType: '' }); setQuery(''); setResults([]) }}
                        className="flex items-center w-full px-3 py-3 text-left border-t first:border-t-0 text-subheadline"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--divider)' }}>
                        {r.schemeName}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Date */}
          <div>
            <FieldLabel>Date</FieldLabel>
            <DateInput value={date} onChange={setDate} />
          </div>

          {/* Units + NAV */}
          <div>
            <FieldLabel>Details</FieldLabel>
            <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <TwoColCell label="Units" value={units} onChange={setUnits} placeholder="124.589" decimal />
              <TwoColCell label="NAV ₹" value={nav} onChange={setNav} placeholder="472.35" decimal right />
            </div>
          </div>

          {error && <p className="text-negative text-subheadline text-center">{error}</p>}

          <SubmitButton type={type} done={done} loading={loading} disabled={!fund || !units || !nav} />
        </form>
      </div>
    </>
  )
}

// ── Add SGB Sheet ─────────────────────────────────────────────────────────────

function AddSGBSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const kh     = useKeyboardHeight()
  const [type, setType]         = useState<'buy' | 'sell'>('buy')
  const [date, setDate]         = useState(todayISO())
  const [grams, setGrams]       = useState('')
  const [ppg, setPpg]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)
  useBodyScrollLock()

  const amount      = (parseFloat(grams) || 0) * (parseFloat(ppg) || 0)
  const maturityDate = type === 'buy' && date
    ? (() => { const d = new Date(date); d.setFullYear(d.getFullYear() + 8); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) })()
    : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!grams || !ppg) return
    setLoading(true); setError(null)
    const { error: err } = await addSGBTransaction(date, type, parseFloat(grams), parseFloat(ppg))
    setLoading(false)
    if (err) { setError(err); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', maxHeight: '92dvh' }}>
        <SheetHandle />
        <SheetHeader title="New SGB" onCancel={onClose} />

        <div className="px-4 flex-shrink-0">
          <ToggleBuySell type={type} onChange={setType} />
        </div>
        <AmountHero amount={amount} type={type}
          breakdown={amount > 0 ? `${grams}g × ₹${ppg}/g` : undefined} />
        <div className="flex-shrink-0 mx-4" style={{ height: 1, background: 'var(--border-faint)', marginBottom: 14 }} />

        <form onSubmit={submit} className="overflow-y-auto flex-1 px-4 space-y-3"
              style={{ paddingBottom: kh > 0 ? 8 : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
          <div>
            <FieldLabel>{type === 'buy' ? 'Purchase date' : 'Sale date'}</FieldLabel>
            <DateInput value={date} onChange={setDate} />
          </div>

          <div>
            <FieldLabel>Details</FieldLabel>
            <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <TwoColCell label="Grams" value={grams} onChange={setGrams} placeholder="20" decimal />
              <TwoColCell label={type === 'buy' ? 'Issue price ₹/g' : 'Sale price ₹/g'}
                value={ppg} onChange={setPpg} placeholder="9241" decimal right />
            </div>
          </div>

          {/* Maturity info — buy only */}
          {type === 'buy' && maturityDate && (
            <div className="flex justify-between items-center px-3 py-3 rounded-xl"
                 style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-faint)' }}>
              <span className="text-subheadline" style={{ color: 'var(--text-muted)' }}>Matures on</span>
              <span className="text-body font-medium tabnum" style={{ color: 'var(--text-2)' }}>{maturityDate}</span>
            </div>
          )}

          {error && <p className="text-negative text-subheadline text-center">{error}</p>}
          <SubmitButton type={type} done={done} loading={loading} disabled={!grams || !ppg} sgbLabel />
        </form>
      </div>
    </>
  )
}

// ── Add PPF Sheet ─────────────────────────────────────────────────────────────

function AddPPFSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const kh     = useKeyboardHeight()
  const [type, setType]     = useState<'deposit' | 'withdrawal'>('deposit')
  const [date, setDate]     = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [done, setDone]     = useState(false)
  useBodyScrollLock()

  const amtNum = parseFloat(amount) || 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount) return
    setLoading(true); setError(null)
    const { error: err } = await addPPFTransaction(date, type, amtNum)
    setLoading(false)
    if (err) { setError(err); return }
    setDone(true)
    setTimeout(() => { router.refresh(); onClose() }, 700)
  }

  const isDeposit = type === 'deposit'
  const signalColor = isDeposit ? '#34C759' : '#FF3B30'

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed left-0 right-0 z-50 animate-slide-up rounded-t-3xl flex flex-col overflow-hidden sheet-kb"
           style={{ bottom: kh, background: 'var(--bg-secondary)', maxHeight: '92dvh' }}>
        <SheetHandle />
        <SheetHeader title="PPF Transaction" onCancel={onClose} />

        {/* Deposit / Withdrawal toggle */}
        <div className="px-4 flex-shrink-0">
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid var(--border)', height: 54 }}>
            {(['deposit', 'withdrawal'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className="flex-1 text-headline font-bold transition-colors"
                style={type === t
                  ? { background: t === 'deposit' ? '#34C759' : '#FF3B30', color: '#fff' }
                  : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {t === 'deposit' ? 'Deposit' : 'Withdrawal'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center py-4 flex-shrink-0">
          {amtNum > 0 ? (
            <p className="tabnum font-bold" style={{ fontSize: 30, letterSpacing: -0.5, color: signalColor }}>
              {formatINR(amtNum)}
            </p>
          ) : (
            <p className="font-bold" style={{ fontSize: 34, letterSpacing: -0.5, color: 'var(--text-faint)' }}>₹ —</p>
          )}
        </div>
        <div className="flex-shrink-0 mx-4" style={{ height: 1, background: 'var(--border-faint)', marginBottom: 14 }} />

        <form onSubmit={submit} className="overflow-y-auto flex-1 px-4 space-y-3"
              style={{ paddingBottom: kh > 0 ? 8 : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
          <div>
            <FieldLabel>Date</FieldLabel>
            <DateInput value={date} onChange={setDate} />
          </div>
          <div>
            <FieldLabel>Amount ₹</FieldLabel>
            <input type="number" inputMode="numeric" placeholder="150000" value={amount}
              onChange={e => setAmount(e.target.value)} required min="1"
              className="w-full px-3 rounded-xl text-headline font-bold tabnum outline-none"
              style={{ height: 52, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>

          {error && <p className="text-negative text-subheadline text-center">{error}</p>}

          <button type="submit" disabled={loading || !amount}
            className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
            style={{ background: done ? 'var(--border)' : signalColor }}>
            {done ? '✓ Added' : loading ? '…' : isDeposit ? 'Save Deposit' : 'Save Withdrawal'}
          </button>
        </form>
      </div>
    </>
  )
}

// ── Shared sheet primitives ───────────────────────────────────────────────────

function SheetHandle() {
  return (
    <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
      <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border)' }} />
    </div>
  )
}

function SheetHeader({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pt-1 pb-3 flex-shrink-0">
      <button onClick={onCancel}
        className="text-accent text-headline min-h-[44px] min-w-[44px] flex items-center">Cancel</button>
      <p className="font-semibold text-headline">{title}</p>
      <div className="w-16" />
    </div>
  )
}

function ToggleBuySell({ type, onChange }: { type: 'buy' | 'sell'; onChange: (t: 'buy' | 'sell') => void }) {
  return (
    <div className="flex rounded-xl overflow-hidden mb-0" style={{ border: '1.5px solid var(--border)', height: 54 }}>
      {(['buy', 'sell'] as const).map(t => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className="flex-1 text-headline font-bold transition-colors"
          style={type === t
            ? { background: t === 'buy' ? '#34C759' : '#FF3B30', color: '#fff' }
            : { background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          {t === 'buy' ? 'Buy' : 'Sell'}
        </button>
      ))}
    </div>
  )
}

function AmountHero({ amount, type, breakdown }: { amount: number; type: 'buy' | 'sell'; breakdown?: string }) {
  const color = type === 'buy' ? '#34C759' : '#FF3B30'
  return (
    <div className="flex flex-col items-center py-3 flex-shrink-0">
      {amount > 0 ? (
        <>
          <p className="tabnum font-bold" style={{ fontSize: 30, letterSpacing: -0.5, color }}>{formatINR(amount)}</p>
          {breakdown && <p className="text-subheadline tabnum mt-0.5" style={{ color: 'var(--text-muted)' }}>{breakdown}</p>}
        </>
      ) : (
        <p className="font-bold" style={{ fontSize: 34, letterSpacing: -0.5, color: 'var(--text-faint)' }}>₹ —</p>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-footnote mb-1.5 uppercase"
       style={{ color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.07em' }}>
      {children}
    </p>
  )
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)} required
      onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
      className="w-full px-3 py-2.5 rounded-xl text-body outline-none max-w-full"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', colorScheme: 'light dark', boxSizing: 'border-box' }} />
  )
}

function TwoColCell({ label, value, onChange, placeholder, decimal, right }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; decimal: boolean; right?: boolean
}) {
  return (
    <div className="p-3" style={right ? { borderLeft: '1px solid var(--border)' } : {}}>
      <p className="text-footnote uppercase mb-1"
         style={{ fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-faint)' }}>{label}</p>
      <input
        type="number" inputMode={decimal ? 'decimal' : 'numeric'}
        placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        min={decimal ? '0.001' : '1'} step={decimal ? 'any' : '1'}
        onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
        className="w-full bg-transparent tabnum font-bold outline-none"
        style={{ fontSize: 22, color: 'var(--text-primary)', textAlign: right ? 'right' : 'left' }}
      />
    </div>
  )
}

function SubmitButton({ type, done, loading, disabled, sgbLabel }: {
  type: 'buy' | 'sell'; done: boolean; loading: boolean; disabled: boolean; sgbLabel?: boolean
}) {
  const bg = done ? 'var(--border)' : type === 'buy' ? '#34C759' : '#FF3B30'
  const label = done ? '✓ Added' : loading ? '…' : sgbLabel ? (type === 'buy' ? 'Save Buy' : 'Save Sell') : (type === 'buy' ? 'Buy' : 'Sell')
  return (
    <button type="submit" disabled={loading || disabled}
      className="w-full py-4 rounded-xl font-bold text-headline active:scale-[0.98] disabled:opacity-40 text-white"
      style={{ background: bg }}>
      {label}
    </button>
  )
}

// ── Body scroll lock hook ─────────────────────────────────────────────────────

function useBodyScrollLock() {
  useEffect(() => {
    const y = window.scrollY
    document.body.style.position  = 'fixed'
    document.body.style.width     = '100%'
    document.body.style.top       = `-${y}px`
    return () => {
      document.body.style.position = ''
      document.body.style.width    = ''
      document.body.style.top      = ''
      window.scrollTo(0, y)
    }
  }, [])
}

// ── Type picker icons ─────────────────────────────────────────────────────────

function IconMF() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l4-5 4 3 4-6 4 4" />
    </svg>
  )
}
function IconSGB() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="8" rx="8" ry="3" />
      <path strokeLinecap="round" d="M4 8v4c0 1.657 3.582 3 8 3s8-1.343 8-3V8" />
      <path strokeLinecap="round" d="M4 12v4c0 1.657 3.582 3 8 3s8-1.343 8-3v-4" />
    </svg>
  )
}
function IconPPF() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11" />
    </svg>
  )
}
