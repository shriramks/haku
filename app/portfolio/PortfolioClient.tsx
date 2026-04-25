'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { formatINR, formatINRFine, todayISO } from '@/lib/formatter'
import { ChevronRightIcon, PencilIcon, SearchIcon } from '@/components/icons'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { mfXirr, sgbXirr, ppfXirr, computePPFBalance, stockXirr, portfolioXirr } from '@/lib/xirr'
import { seqCost } from '@/lib/compute'
import { upsertMFund, addMFTransaction, addGoldTransaction, addPPFTransaction, setPPFBalanceOverride } from './actions'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, MFHolding, SGBBatch, EquitySummary, PPFSummary } from '@/lib/portfolio-types'
import type { Transaction, BuyBand } from '@/lib/types'

interface Props {
  allTransactions: Transaction[]
  bands: BuyBand[]
  latestYearSymbols: string[]
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  sgbTransactions: SGBTransaction[]
  ppfTransactions: PPFTransaction[]
  ppfOverride: PPFBalanceOverride | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeEquity(transactions: Transaction[], bands: BuyBand[], allowedSymbols: string[]): EquitySummary {
  const allowed = new Set(allowedSymbols)
  const bySymbol: Record<string, Transaction[]> = {}
  for (const t of transactions) {
    if (allowed.size > 0 && !allowed.has(t.symbol)) continue
    ;(bySymbol[t.symbol] ??= []).push(t)
  }
  let invested = 0, currentValue = 0, holdingsCount = 0
  for (const [symbol, txns] of Object.entries(bySymbol)) {
    const { qty, cost } = seqCost(txns)
    if (qty <= 0.001) continue
    holdingsCount++
    invested     += cost
    const band    = bands.find(b => b.symbol === symbol)
    currentValue += band?.manual_cmp ? qty * band.manual_cmp : cost
  }
  return { holdingsCount, invested, currentValue }
}

function computeStockHoldings(
  transactions: Transaction[],
  bands: BuyBand[],
  allowedSymbols: string[],
): { symbol: string; qty: number; invested: number; currentValue: number | null; gain: number | null; xirr: number | null }[] {
  const allowed = new Set(allowedSymbols)
  const bySymbol: Record<string, Transaction[]> = {}
  for (const t of transactions) {
    if (allowed.size > 0 && !allowed.has(t.symbol)) continue
    ;(bySymbol[t.symbol] ??= []).push(t)
  }
  return Object.entries(bySymbol)
    .flatMap(([symbol, txns]) => {
      const { qty, cost } = seqCost(txns)
      if (qty <= 0.001) return []
      const band = bands.find(b => b.symbol === symbol)
      const currentValue = band?.manual_cmp ? qty * band.manual_cmp : null
      const gain = currentValue !== null ? currentValue - cost : null
      const xirrVal = currentValue !== null ? stockXirr(txns, currentValue) : null
      return [{ symbol, qty, invested: cost, currentValue, gain, xirr: xirrVal }]
    })
    .sort((a, b) => (b.currentValue ?? b.invested) - (a.currentValue ?? a.invested))
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
  const map = new Map<string, {
    transactions: SGBTransaction[]; grams: number; invested: number
    maturityDate: string | null; goldType: 'sgb' | 'etf' | 'physical'; name: string | null
  }>()
  for (const t of transactions) {
    const goldType = t.gold_type ?? 'sgb'
    const key = goldType === 'sgb'
      ? new Date(t.trade_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : (t.name ?? (goldType === 'physical' ? 'Physical Gold' : 'Gold ETF'))
    const b = map.get(key) ?? { transactions: [], grams: 0, invested: 0, maturityDate: null, goldType, name: t.name }
    b.transactions.push(t)
    if (t.trade_type === 'buy') {
      b.grams    += t.grams
      b.invested += t.amount
      if (!b.maturityDate && goldType === 'sgb') b.maturityDate = t.maturity_date
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
        goldType:     b.goldType,
        name:         b.name,
      }
    })
}

function goldDisplayName(b: SGBBatch): string {
  if (b.goldType === 'sgb') return `SGB ${b.key}`
  if (b.goldType === 'etf') return b.name ?? b.key
  return b.name || 'Physical Gold'
}

function goldMeta(b: SGBBatch): string {
  if (b.goldType === 'sgb') {
    const matDate = b.maturityDate
      ? new Date(b.maturityDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : '—'
    return `${trimZero(b.grams)}g · ${matDate}`
  }
  if (b.goldType === 'etf') return `${trimZero(b.grams)} units`
  return `${trimZero(b.grams)}g`
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

function assetClass(fund: { scheme_type: string; scheme_name: string }): 'equity' | 'debt' {
  const t = `${fund.scheme_type} ${fund.scheme_name}`.toLowerCase()
  if (t.includes('debt') || t.includes('liquid') || t.includes('fixed') || t.includes('bond') ||
      t.includes('overnight') || t.includes('duration') || t.includes('arbitrage') ||
      t.includes('gilt') || t.includes('money market') || t.includes('treasury')) return 'debt'
  return 'equity'
}

function fmtXirr(v: number | null): string {
  if (v === null) return '—'
  return `${trimZero(v * 100)}%`
}

function trimZero(n: number, dp = 1): string {
  const s = n.toFixed(dp)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function fmtGain(gain: number | null): string {
  if (gain === null) return '—'
  return (gain >= 0 ? '+' : '') + formatINR(gain)
}

function noR(s: string): string { return s.replace('₹', '') }

function fmtGainPct(gain: number | null, invested: number): string {
  if (gain === null || invested <= 0) return ''
  return `${gain >= 0 ? '+' : ''}${trimPct((gain / invested) * 100)}%`
}

function trimPct(v: number): string {
  const s = v.toFixed(1)
  return s.endsWith('.0') ? String(Math.round(v)) : s
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioClient({
  allTransactions, bands, latestYearSymbols, mfFunds, mfTransactions,
  sgbTransactions, ppfTransactions, ppfOverride,
}: Props) {
  const router = useRouter()
  const [openSections, setOpenSections] = useState(new Set<string>([]))
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const [addSheet, setAddSheet] = useState<'mf' | 'gold' | 'ppf' | null>(null)
  const [navs, setNavs]         = useState<Record<string, number>>({})
  const [navsLoading, setNavsLoading] = useState(mfFunds.length > 0)
  const [goldPrice, setGoldPrice] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const v = localStorage.getItem('goldPricePerGram')
    return v ? parseFloat(v) : null
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // Live gold price via Yahoo Finance proxy; persists last known price in localStorage
  useEffect(() => {
    fetch('/api/gold-price')
      .then(r => r.json())
      .then(d => {
        if (d.pricePerGram) {
          setGoldPrice(d.pricePerGram)
          localStorage.setItem('goldPricePerGram', String(d.pricePerGram))
        }
      })
      .catch(() => {})
  }, [refreshKey])

  // Live NAV fetch from mfapi.in
  useEffect(() => {
    if (mfFunds.length === 0) return
    setNavsLoading(true)
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
  }, [mfFunds, refreshKey])

  const equity        = useMemo(() => computeEquity(allTransactions, bands, latestYearSymbols), [allTransactions, bands, latestYearSymbols])
  const stockHoldings = useMemo(() => computeStockHoldings(allTransactions, bands, latestYearSymbols), [allTransactions, bands, latestYearSymbols])
  const mfHoldings    = useMemo(() => computeMFHoldings(mfFunds, mfTransactions, navs), [mfFunds, mfTransactions, navs])
  const sgbBatches    = useMemo(() => computeSGBBatches(sgbTransactions, goldPrice), [sgbTransactions, goldPrice])
  const ppf           = useMemo(() => computePPF(ppfTransactions, ppfOverride), [ppfTransactions, ppfOverride])

  // Summary numbers
  const mfInvested      = mfHoldings.reduce((s, h) => s + h.invested, 0)
  const mfCurrentValue  = mfHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const sgbInvested     = sgbBatches.reduce((s, b) => s + b.invested, 0)
  const sgbCurrentValue = sgbBatches.reduce((s, b) => s + (b.currentValue ?? b.invested), 0)
  const totalInvested   = equity.invested + mfInvested + sgbInvested + ppf.totalDeposited
  const totalCurrent    = equity.currentValue + mfCurrentValue + sgbCurrentValue + ppf.currentBalance
  const totalGain       = totalCurrent - totalInvested

  // Overall XIRR: wait for live prices before computing so the terminal value is accurate.
  // Use the same symbol filter as computeEquity for consistency with totalCurrent.
  const overallXirr = useMemo(() => {
    if (navsLoading || (sgbTransactions.length > 0 && goldPrice === null)) return null
    const equityTxns = latestYearSymbols.length > 0
      ? allTransactions.filter(t => latestYearSymbols.includes(t.symbol))
      : allTransactions
    return portfolioXirr(equityTxns, mfTransactions, sgbTransactions, ppfTransactions, totalCurrent)
  }, [allTransactions, mfTransactions, sgbTransactions, ppfTransactions, totalCurrent, navsLoading, goldPrice, latestYearSymbols])

  // Asset allocation for donut + section bars
  const mfEquity      = mfHoldings.filter(h => assetClass(h.fund) === 'equity').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfDebt        = mfHoldings.filter(h => assetClass(h.fund) === 'debt').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const totalForAlloc = equity.currentValue + mfEquity + mfDebt + sgbInvested + ppf.currentBalance
  const eqPct   = totalForAlloc > 0 ? Math.round((equity.currentValue + mfEquity) / totalForAlloc * 100) : 0
  const debtPct = totalForAlloc > 0 ? Math.round((mfDebt + ppf.currentBalance) / totalForAlloc * 100) : 0
  const goldPct = 100 - eqPct - debtPct

  // Bar %s for section rows (% of total portfolio)
  const pct = (v: number) => totalCurrent > 0 ? v / totalCurrent * 100 : 0
  const totalGoldGrams = sgbBatches.reduce((s, b) => s + b.grams, 0)

  function handleRefresh() {
    setRefreshing(true)
    setRefreshKey(k => k + 1)
    router.refresh()
    setTimeout(() => setRefreshing(false), 1500)
  }

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAdd(type: 'mf' | 'gold' | 'ppf') {
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
        <button onClick={handleRefresh}
                className="flex items-center justify-center min-w-[44px] min-h-[44px]"
                style={{ color: 'var(--accent)' }}>
          <svg className={refreshing ? 'animate-spin' : ''} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>

      {/* Summary: 3-col grid — no justify-between stretch */}
      <div className="grid px-4 py-2 border-b"
           style={{ gridTemplateColumns: '1fr 1fr auto', gap: '0', borderColor: 'var(--border-faint)' }}>
        <div className="flex flex-col gap-2">
          <SCell label="Current Value ₹" value={formatINRFine(totalCurrent)} />
          <SCell label="Gain ₹" value={fmtGain(totalGain)} positive={totalGain > 0} negative={totalGain < 0} />
        </div>
        <div className="flex flex-col gap-2 border-l pl-4" style={{ borderColor: 'var(--border-faint)', marginLeft: 8 }}>
          <SCell label="Invested ₹" value={formatINRFine(totalInvested)} />
          <SCell label="XIRR p.a." value={fmtXirr(overallXirr)} positive={overallXirr !== null && overallXirr > 0} negative={overallXirr !== null && overallXirr < 0} />
        </div>
        <FilledPieChart equity={eqPct} debt={debtPct} gold={goldPct} />
      </div>

      {/* Scrollable sections */}
      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

        {/* EQUITY */}
        <SectionHeader
          id="equity" label="Stocks"
          badge={equity.holdingsCount > 0 ? `${equity.holdingsCount} stocks` : null}
          gainPct={equity.invested > 0 ? ((equity.currentValue - equity.invested) / equity.invested * 100) : null}
          currentValue={equity.currentValue > 0 ? equity.currentValue : null}
          invested={equity.invested > 0 ? equity.invested : null}
          barPct={pct(equity.currentValue)}
          barColor="var(--c-equity)"
          open={openSections.has('equity')}
          onToggle={() => toggleSection('equity')}
        />
        {openSections.has('equity') && (
          <>
            {stockHoldings.length > 0 && (
              <>
                <ColHeaders c1="Stock" c2="Inv ₹" c3="Curr ₹" c4="Return ₹" />
                {stockHoldings.map(h => (
                  <FundRow key={h.symbol}
                    name={h.symbol}
                    meta={`${h.qty.toLocaleString('en-IN', { maximumFractionDigits: 0 })} shares`}
                    invested={noR(formatINRFine(h.invested))}
                    current={h.currentValue !== null ? noR(formatINRFine(h.currentValue)) : '—'}
                    gain={noR(fmtGain(h.gain))}
                    xirr={h.xirr !== null ? fmtXirr(h.xirr) : fmtGainPct(h.gain, h.invested)}
                    positive={(h.gain ?? 0) > 0}
                  />
                ))}
              </>
            )}
            {stockHoldings.length === 0 && (
              <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No stock holdings yet.</p>
            )}
          </>
        )}

        {/* MUTUAL FUNDS */}
        <SectionHeader
          id="mf" label="MF"
          badge={mfHoldings.length > 0 ? `${mfHoldings.length} MFs` : null}
          gainPct={mfInvested > 0 && !navsLoading ? ((mfCurrentValue - mfInvested) / mfInvested * 100) : null}
          currentValue={mfCurrentValue > 0 ? mfCurrentValue : null}
          invested={mfInvested > 0 ? mfInvested : null}
          barPct={pct(mfEquity)}
          barColor="var(--c-equity)"
          barPct2={pct(mfDebt)}
          barColor2="var(--accent)"
          open={openSections.has('mf')}
          onToggle={() => toggleSection('mf')}
        />
        {openSections.has('mf') && (
          <>
            {mfHoldings.length > 0 && (
              <>
                <ColHeaders c1="Fund" c2="Inv ₹" c3="Curr ₹" c4="Return ₹" />
                {mfHoldings.map(h => (
                  <FundRow key={h.fund.id}
                    name={h.fund.scheme_name}
                    meta={`${h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`}
                    invested={noR(formatINRFine(h.invested))}
                    current={h.currentValue !== null ? noR(formatINRFine(h.currentValue)) : '—'}
                    gain={noR(fmtGain(h.gain))}
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

        {/* Gold */}
        <SectionHeader
          id="sgb" label="Gold"
          badge={totalGoldGrams > 0 ? `${trimZero(totalGoldGrams)}g` : null}
          gainPct={sgbInvested > 0 && goldPrice !== null ? ((sgbCurrentValue - sgbInvested) / sgbInvested * 100) : null}
          currentValue={sgbCurrentValue > 0 ? sgbCurrentValue : null}
          invested={sgbInvested > 0 ? sgbInvested : null}
          barPct={pct(sgbCurrentValue)}
          barColor="var(--c-gold)"
          open={openSections.has('sgb')}
          onToggle={() => toggleSection('sgb')}
        />
        {openSections.has('sgb') && (
          <>
            {sgbBatches.length > 0 && (
              <>
                <ColHeaders c1="Gold" c2="Inv ₹" c3="Curr ₹" c4="Return ₹" />
                {sgbBatches.map(b => (
                  <FundRow key={b.key}
                    name={goldDisplayName(b)}
                    meta={goldMeta(b)}
                    invested={noR(formatINRFine(b.invested))}
                    current={b.currentValue !== null ? noR(formatINRFine(b.currentValue)) : '—'}
                    gain={noR(fmtGain(b.gain))}
                    xirr={fmtXirr(b.xirr)}
                    positive={(b.gain ?? 0) > 0}
                  />
                ))}
              </>
            )}
            {sgbBatches.length === 0 && (
              <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No gold holdings yet.</p>
            )}
          </>
        )}

        {/* PPF */}
        <SectionHeader
          id="ppf" label="PPF"
          badge={null}
          gainPct={ppf.totalDeposited > 0 ? ((ppf.currentBalance - ppf.totalDeposited) / ppf.totalDeposited * 100) : null}
          currentValue={ppf.currentBalance > 0 ? ppf.currentBalance : null}
          invested={ppf.totalDeposited > 0 ? ppf.totalDeposited : null}
          barPct={pct(ppf.currentBalance)}
          barColor="var(--accent)"
          isPPF
          open={openSections.has('ppf')}
          onToggle={() => toggleSection('ppf')}
        />
        {openSections.has('ppf') && (
          <PPFRow ppf={ppf} />
        )}

        {/* Single add button */}
        <div className="px-4 mt-5">
          <button
            onClick={() => setTypePickerOpen(true)}
            className="flex items-center justify-center gap-2 w-full rounded-xl text-accent font-semibold text-body"
            style={{ minHeight: 48, background: 'rgba(10,132,255,0.10)', border: '1px solid var(--border)' }}>
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add transaction
          </button>
        </div>
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
      {addSheet === 'gold' && (
        <AddGoldSheet onClose={() => setAddSheet(null)} />
      )}
      {addSheet === 'ppf' && (
        <AddPPFSheet onClose={() => setAddSheet(null)} />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SCell({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-footnote" style={{ color: 'var(--text-faint)', letterSpacing: '0.02em' }}>{label}</p>
      <p className="text-title-1 font-bold tabnum"
         style={{ color: positive ? 'var(--c-positive)' : negative ? 'var(--c-negative)' : 'var(--text-primary)' }}>
        {noR(value)}
      </p>
    </div>
  )
}

function FilledPieChart({ equity, debt, gold }: { equity: number; debt: number; gold: number }) {
  const cx = 48, cy = 48, r = 44
  const total = equity + debt + gold

  function arcPath(startPct: number, pct: number): string {
    if (pct <= 0) return ''
    const startAngle = (startPct / 100) * 360 - 90
    if (pct >= 99.5) {
      const sx = (cx + r * Math.cos(startAngle * Math.PI / 180)).toFixed(2)
      const sy = (cy + r * Math.sin(startAngle * Math.PI / 180)).toFixed(2)
      const mx = (cx + r * Math.cos((startAngle + 180) * Math.PI / 180)).toFixed(2)
      const my = (cy + r * Math.sin((startAngle + 180) * Math.PI / 180)).toFixed(2)
      return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 1 1 ${mx} ${my} A ${r} ${r} 0 1 1 ${sx} ${sy} Z`
    }
    const endAngle = ((startPct + pct) / 100) * 360 - 90
    const sx = (cx + r * Math.cos(startAngle * Math.PI / 180)).toFixed(2)
    const sy = (cy + r * Math.sin(startAngle * Math.PI / 180)).toFixed(2)
    const ex = (cx + r * Math.cos(endAngle   * Math.PI / 180)).toFixed(2)
    const ey = (cy + r * Math.sin(endAngle   * Math.PI / 180)).toFixed(2)
    return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${pct > 50 ? 1 : 0} 1 ${ex} ${ey} Z`
  }

  function sliceCentroid(startPct: number, pct: number): [number, number] {
    const midAngle = ((startPct + pct / 2) / 100) * 360 - 90
    const rad = midAngle * Math.PI / 180
    const cr = r * 0.58
    return [cx + cr * Math.cos(rad), cy + cr * Math.sin(rad)]
  }

  const LETTERS = ['E', 'D', 'G']
  let offset = 0
  const slices = [
    { pct: equity, color: 'var(--c-equity)', darkLabel: false },
    { pct: debt,   color: 'var(--accent)',   darkLabel: false },
    { pct: gold,   color: 'var(--c-gold)',   darkLabel: true  },
  ].map((s, i) => {
    const d        = arcPath(offset, s.pct)
    const centroid = s.pct >= 10 ? sliceCentroid(offset, s.pct) : null
    offset += s.pct
    return { ...s, d, centroid, letter: LETTERS[i], key: i }
  })

  return (
    <div className="flex-shrink-0 flex items-center">
      <svg width="128" height="128" viewBox="0 0 96 96">
        {total === 0
          ? <circle cx={cx} cy={cy} r={r} fill="var(--bg-tertiary)" />
          : slices.map(s => s.d
              ? <path key={s.key} d={s.d} fill={s.color} stroke="var(--bg-primary)" strokeWidth="1.5" />
              : null)
        }
        {total > 0 && slices.map(s => s.centroid && (
          <text
            key={`lbl-${s.key}`}
            x={s.centroid[0].toFixed(2)}
            y={s.centroid[1].toFixed(2)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="9"
            fontWeight="700"
            fill={s.darkLabel ? 'rgba(0,0,0,0.68)' : 'rgba(255,255,255,0.90)'}
            style={{ fontFamily: 'system-ui, -apple-system' }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
      </svg>
    </div>
  )
}

function SectionHeader({ id, label, badge, gainPct, currentValue, invested, barPct, barColor, barPct2, barColor2, isPPF, open, onToggle }: {
  id: string; label: string; badge: string | null
  gainPct: number | null; currentValue: number | null; invested: number | null
  barPct: number; barColor: string; barPct2?: number; barColor2?: string
  isPPF?: boolean; open: boolean; onToggle: () => void
}) {
  const positive = gainPct !== null && gainPct >= 0
  const hasBar   = barPct > 0 || (barPct2 ?? 0) > 0
  const totalPct = Math.round(barPct + (barPct2 ?? 0))

  return (
    <button onClick={onToggle}
            className="flex items-center w-full px-4 border-t"
            style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'var(--border-faint)' }}>
      {/* Left: label + badge below */}
      <div className="flex flex-col justify-center py-2.5 flex-shrink-0" style={{ minWidth: 68 }}>
        <span className="text-headline font-bold" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {badge && (
          <span className="text-footnote tabnum mt-0.5" style={{ color: 'var(--text-faint)' }}>{badge}</span>
        )}
      </div>

      {/* Middle: bar + meta */}
      <div className="flex flex-col flex-1 justify-center py-2.5 gap-1" style={{ paddingLeft: 12, paddingRight: 10 }}>
        {hasBar && currentValue !== null && (
          <>
            <div className="w-full flex overflow-hidden" style={{ height: 5, borderRadius: 3, background: 'var(--border)' }}>
              <div style={{ width: `${barPct}%`, background: barColor, borderRadius: barPct2 ? '3px 0 0 3px' : 3 }} />
              {barPct2 != null && barPct2 > 0 && barColor2 && (
                <>
                  <div style={{ width: 2 }} />
                  <div style={{ width: `${barPct2}%`, background: barColor2, borderRadius: '0 3px 3px 0' }} />
                </>
              )}
            </div>
            <span className="text-footnote tabnum" style={{ color: 'var(--text-faint)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{totalPct}%</span>
              {invested !== null && ` · ${noR(formatINRFine(invested))} ${isPPF ? 'dep' : 'inv'}`}
            </span>
          </>
        )}
      </div>

      {/* Right: value on top, gain% below */}
      <div className="flex flex-col items-end flex-shrink-0 py-2.5 gap-0.5">
        {currentValue !== null ? (
          <>
            <span className="text-headline font-semibold tabnum" style={{ color: 'var(--text-2)' }}>
              {noR(formatINRFine(currentValue))}
            </span>
            {gainPct !== null ? (
              <span className="text-footnote font-bold tabnum"
                    style={{ color: positive ? 'var(--c-positive)' : 'var(--c-negative)' }}>
                {positive ? '+' : ''}{trimPct(gainPct)}%
              </span>
            ) : (
              <span className="text-footnote" style={{ color: 'var(--text-faint)' }}>—</span>
            )}
          </>
        ) : (
          <span className="text-headline font-bold" style={{ color: 'var(--text-faint)' }}>—</span>
        )}
      </div>

      <ChevronRightIcon
        className={`w-4 h-4 flex-shrink-0 ml-1.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        style={{ color: 'var(--text-muted)' }} />
    </button>
  )
}

const FUND_ROW_COLS = '1.4fr 0.9fr 0.9fr 1fr'

function ColHeaders({ c1, c2, c3, c4 }: { c1: string; c2: string; c3: string; c4: string }) {
  return (
    <div className="grid items-center px-4 py-1"
         style={{ background: 'rgba(255,255,255,0.02)', gridTemplateColumns: FUND_ROW_COLS }}>
      <span className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c1}</span>
      <span className="text-footnote font-bold uppercase text-right" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c2}</span>
      <span className="text-footnote font-bold uppercase text-right" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c3}</span>
      <span className="text-footnote font-bold uppercase text-right" style={{ color: 'var(--text-faint)', letterSpacing: '0.07em' }}>{c4}</span>
    </div>
  )
}

function FundRow({ name, meta, invested, current, gain, xirr, positive }: {
  name: string; meta: string; invested: string; current: string;
  gain: string; xirr: string; positive: boolean
}) {
  return (
    <div className="grid px-4 py-3"
         style={{ minHeight: 52, gridTemplateColumns: FUND_ROW_COLS, alignItems: 'start' }}>
      <div className="min-w-0 pr-2">
        <p className="text-headline font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
        <p className="text-footnote mt-0.5 tabnum" style={{ color: 'var(--text-2)' }}>{meta}</p>
      </div>
      <p className="text-body font-semibold tabnum text-right" style={{ color: 'var(--text-primary)' }}>{invested}</p>
      <p className="text-body font-semibold tabnum text-right" style={{ color: 'var(--text-primary)' }}>{current}</p>
      <div className="text-right">
        <p className="text-body font-semibold tabnum"
           style={{ color: positive ? 'var(--c-positive)' : 'var(--text-primary)' }}>{gain}</p>
        {xirr && <p className="text-footnote tabnum mt-0.5" style={{ color: positive ? 'var(--c-positive)' : 'var(--text-faint)' }}>{xirr}</p>}
      </div>
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
    <div className="flex items-center px-4" style={{ minHeight: 52 }}>
      <div className="flex-1">
        <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>PPF Account</p>
        <p className="text-footnote mt-0.5 tabnum" style={{ color: 'var(--text-faint)' }}>
          Deposited ₹ {noR(formatINRFine(ppf.totalDeposited))}
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
              {noR(formatINRFine(ppf.currentBalance))}
            </p>
            <p className="text-footnote tabnum mt-0.5" style={{ color: 'var(--c-positive)' }}>
              +{noR(formatINRFine(ppf.currentBalance - ppf.totalDeposited))}
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
  onSelect: (type: 'mf' | 'gold' | 'ppf') => void
}) {
  const kh = useKeyboardHeight()
  useBodyScrollLock()
  const types = [
    { id: 'mf'   as const, label: 'Mutual Fund', Icon: IconMF  },
    { id: 'gold' as const, label: 'Gold',         Icon: IconSGB },
    { id: 'ppf'  as const, label: 'PPF',          Icon: IconPPF },
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

// ── Add Gold Sheet ────────────────────────────────────────────────────────────

type GoldType = 'sgb' | 'etf' | 'physical'

function GoldTypePicker({ value, onChange }: { value: GoldType; onChange: (t: GoldType) => void }) {
  return (
    <div className="flex gap-2 mb-3">
      {(['sgb', 'etf', 'physical'] as const).map(t => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className="flex-1 rounded-xl text-subheadline font-bold transition-colors"
          style={{
            height: 40,
            background: value === t ? 'rgba(255,214,10,0.10)' : 'var(--bg-tertiary)',
            border: value === t ? '1.5px solid rgba(255,214,10,0.40)' : '1.5px solid transparent',
            color: value === t ? 'rgba(255,214,10,0.90)' : 'var(--text-muted)',
          }}>
          {t === 'sgb' ? 'SGB' : t === 'etf' ? 'ETF' : 'Physical'}
        </button>
      ))}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      onFocus={e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
      className="w-full px-3 py-2.5 rounded-xl text-body outline-none"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
  )
}

function AddGoldSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const kh     = useKeyboardHeight()
  const [goldType, setGoldType] = useState<GoldType>('sgb')
  const [type, setType]         = useState<'buy' | 'sell'>('buy')
  const [name, setName]         = useState('')
  const [date, setDate]         = useState(todayISO())
  const [qty, setQty]           = useState('')
  const [price, setPrice]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)
  useBodyScrollLock()

  const amount = (parseFloat(qty) || 0) * (parseFloat(price) || 0)
  const maturityDate = goldType === 'sgb' && type === 'buy' && date
    ? (() => { const d = new Date(date); d.setFullYear(d.getFullYear() + 8); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) })()
    : null
  const breakdown = amount > 0
    ? goldType === 'etf' ? `${qty} units × ₹${price}/unit` : `${qty}g × ₹${price}/g`
    : undefined
  const isDisabled = !qty || !price || (goldType === 'etf' && !name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isDisabled) return
    setLoading(true); setError(null)
    const { error: err } = await addGoldTransaction(goldType, name || null, date, type, parseFloat(qty), parseFloat(price))
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
        <SheetHeader title="Add Gold" onCancel={onClose} />

        <div className="px-4 flex-shrink-0">
          <GoldTypePicker value={goldType} onChange={t => { setGoldType(t); setName('') }} />
          <ToggleBuySell type={type} onChange={setType} />
        </div>
        <AmountHero amount={amount} type={type} breakdown={breakdown} />
        <div className="flex-shrink-0 mx-4" style={{ height: 1, background: 'var(--border-faint)', marginBottom: 14 }} />

        <form onSubmit={submit} className="overflow-y-auto flex-1 px-4 space-y-3"
              style={{ paddingBottom: kh > 0 ? 8 : 'calc(env(safe-area-inset-bottom,0px) + 24px)' }}>

          {goldType !== 'sgb' && (
            <div>
              <FieldLabel>{goldType === 'etf' ? 'Fund name' : 'Description (optional)'}</FieldLabel>
              <TextInput value={name} onChange={setName}
                placeholder={goldType === 'etf' ? 'SBI Gold ETF' : 'e.g. 22K ring, hallmarked bar…'} />
            </div>
          )}

          <div>
            <FieldLabel>{type === 'buy' ? 'Purchase date' : 'Sale date'}</FieldLabel>
            <DateInput value={date} onChange={setDate} />
          </div>

          <div>
            <FieldLabel>Details</FieldLabel>
            <div className="grid grid-cols-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <TwoColCell label={goldType === 'etf' ? 'Units' : 'Grams'}
                value={qty} onChange={setQty} placeholder={goldType === 'etf' ? '50' : '20'} decimal />
              <TwoColCell
                label={goldType === 'etf' ? 'NAV ₹/unit' : (type === 'buy' ? 'Issue price ₹/g' : 'Sale price ₹/g')}
                value={price} onChange={setPrice} placeholder="9241" decimal right />
            </div>
          </div>

          {maturityDate && (
            <div className="flex justify-between items-center px-3 py-3 rounded-xl"
                 style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-faint)' }}>
              <span className="text-subheadline" style={{ color: 'var(--text-muted)' }}>Matures on</span>
              <span className="text-body font-medium tabnum" style={{ color: 'var(--text-2)' }}>{maturityDate}</span>
            </div>
          )}

          {goldType === 'physical' && (
            <p className="text-footnote" style={{ color: 'var(--text-faint)' }}>Valued at current 24K market rate</p>
          )}

          {error && <p className="text-negative text-subheadline text-center">{error}</p>}
          <SubmitButton type={type} done={done} loading={loading} disabled={isDisabled} sgbLabel />
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
