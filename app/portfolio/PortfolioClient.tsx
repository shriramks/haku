'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatINRFine } from '@/lib/formatter'
import { ChevronRightIcon, RefreshIcon } from '@/components/icons'
import UserMenu from '@/components/UserMenu'
import { mfXirr, sgbXirr, ppfXirr, epfXirr, computePPFBalance, computeEPFBalance, stockXirr, portfolioXirr } from '@/lib/xirr'
import { seqCost } from '@/lib/compute'
import { computeMFLots } from '@/lib/mf-compute'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction, MFHolding, SGBBatch, EquitySummary, PPFSummary, EPFSummary } from '@/lib/portfolio-types'
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
  epfTransactions: EPFTransaction[]
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
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
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
    const { units, invested } = computeMFLots(txns)
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

function computeEPF(transactions: EPFTransaction[]): EPFSummary {
  const totalDeposited  = transactions
    .filter(t => t.trade_type === 'deposit')
    .reduce((s, t) => s + t.amount, 0)
  const computedBalance = computeEPFBalance(transactions)
  return { transactions, totalDeposited, computedBalance, xirr: epfXirr(transactions, computedBalance) }
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
  return (gain >= 0 ? '+' : '') + formatINRFine(gain)
}

function noR(s: string): string { return s.replace('₹', '') }

// Returns "FY25" style label for a date string
function fyLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = d.getMonth() // 0-indexed; March = 2
  const fy = m <= 2 ? y : y + 1  // interest credited in March belongs to the FY ending that year
  return `FY${String(fy).slice(2)}`
}

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
  sgbTransactions, ppfTransactions, ppfOverride, epfTransactions,
}: Props) {
  const router = useRouter()
  const [openSections, setOpenSections] = useState(new Set<string>([]))
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
  const epf           = useMemo(() => computeEPF(epfTransactions), [epfTransactions])

  // Summary numbers
  const mfInvested      = mfHoldings.reduce((s, h) => s + h.invested, 0)
  const mfCurrentValue  = mfHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const sgbInvested     = sgbBatches.reduce((s, b) => s + b.invested, 0)
  const sgbCurrentValue = sgbBatches.reduce((s, b) => s + (b.currentValue ?? b.invested), 0)
  const totalInvested   = equity.invested + mfInvested + sgbInvested + ppf.totalDeposited + epf.totalDeposited
  const totalCurrent    = equity.currentValue + mfCurrentValue + sgbCurrentValue + ppf.currentBalance + epf.computedBalance
  const totalGain       = totalCurrent - totalInvested

  // Overall XIRR: wait for live prices before computing so the terminal value is accurate.
  // Use the same symbol filter as computeEquity for consistency with totalCurrent.
  const overallXirr = useMemo(() => {
    if (navsLoading || (sgbTransactions.length > 0 && goldPrice === null)) return null
    const equityTxns = latestYearSymbols.length > 0
      ? allTransactions.filter(t => latestYearSymbols.includes(t.symbol))
      : allTransactions
    return portfolioXirr(equityTxns, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions, totalCurrent)
  }, [allTransactions, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions, totalCurrent, navsLoading, goldPrice, latestYearSymbols])

  // Section-level XIRR for MF and Gold headers
  const mfSectionXirr = useMemo(() => {
    if (navsLoading || mfCurrentValue === 0 || mfTransactions.length === 0) return null
    return mfXirr(mfTransactions, mfCurrentValue)
  }, [mfTransactions, mfCurrentValue, navsLoading])

  const goldSectionXirr = useMemo(() => {
    if (goldPrice === null || sgbCurrentValue === 0 || sgbTransactions.length === 0) return null
    return sgbXirr(sgbTransactions, sgbCurrentValue)
  }, [sgbTransactions, sgbCurrentValue, goldPrice])

  // Asset allocation for donut + section bars
  const mfEquity      = mfHoldings.filter(h => assetClass(h.fund) === 'equity').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfDebt        = mfHoldings.filter(h => assetClass(h.fund) === 'debt').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const totalForAlloc = equity.currentValue + mfEquity + mfDebt + sgbCurrentValue + ppf.currentBalance + epf.computedBalance
  const eqPct   = totalForAlloc > 0 ? Math.round((equity.currentValue + mfEquity) / totalForAlloc * 100) : 0
  const debtPct = totalForAlloc > 0 ? Math.round((mfDebt + ppf.currentBalance + epf.computedBalance) / totalForAlloc * 100) : 0
  const goldPct = 100 - eqPct - debtPct

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
        <button onClick={handleRefresh} disabled={refreshing}
                className="flex items-center gap-1.5 text-accent text-subheadline rounded-lg px-2.5 min-h-[44px] disabled:opacity-40 mr-1.5"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <RefreshIcon className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Updating…' : 'Prices'}
        </button>
        <UserMenu />
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
          badge={equity.invested > 0 ? `${noR(formatINRFine(equity.invested))} inv` : null}
          gainPct={equity.invested > 0 ? ((equity.currentValue - equity.invested) / equity.invested * 100) : null}
          currentValue={equity.currentValue > 0 ? equity.currentValue : null}
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
          badge={mfInvested > 0 ? `${noR(formatINRFine(mfInvested))} inv` : null}
          gainPct={mfSectionXirr !== null ? mfSectionXirr * 100 : null}
          currentValue={mfCurrentValue > 0 ? mfCurrentValue : null}
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
          gainPct={goldSectionXirr !== null ? goldSectionXirr * 100 : null}
          currentValue={sgbCurrentValue > 0 ? sgbCurrentValue : null}
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
          badge={ppf.totalDeposited > 0 ? `${noR(formatINRFine(ppf.totalDeposited))} dep` : null}
          gainPct={ppf.totalDeposited > 0 ? ((ppf.currentBalance - ppf.totalDeposited) / ppf.totalDeposited * 100) : null}
          currentValue={ppf.currentBalance > 0 ? ppf.currentBalance : null}
          open={openSections.has('ppf')}
          onToggle={() => toggleSection('ppf')}
        />
        {openSections.has('ppf') && (
          <PPFRow ppf={ppf} />
        )}

        {/* EPF */}
        <SectionHeader
          id="epf" label="EPF"
          badge={epf.totalDeposited > 0 ? `${noR(formatINRFine(epf.totalDeposited))} dep` : null}
          gainPct={epf.totalDeposited > 0 ? ((epf.computedBalance - epf.totalDeposited) / epf.totalDeposited * 100) : null}
          currentValue={epf.computedBalance > 0 ? epf.computedBalance : null}
          open={openSections.has('epf')}
          onToggle={() => toggleSection('epf')}
        />
        {openSections.has('epf') && (
          <EPFRow epf={epf} />
        )}

      </div>

    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SCell({ label, value, positive, negative }: {
  label: string; value: string; positive?: boolean; negative?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-subheadline" style={{ color: 'var(--text-faint)', letterSpacing: '0.02em' }}>{label}</p>
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

function SectionHeader({ id, label, badge, gainPct, currentValue, open, onToggle }: {
  id: string; label: string; badge: string | null
  gainPct: number | null; currentValue: number | null
  open: boolean; onToggle: () => void
}) {
  const positive = gainPct !== null && gainPct >= 0

  return (
    <button onClick={onToggle}
            className="flex items-center w-full px-4"
            style={{ background: 'rgba(255,255,255,0.025)', minHeight: 52 }}>
      <span className="text-headline font-bold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{label}</span>
      {badge && (
        <>
          <span className="flex-shrink-0 mx-1.5" style={{ color: 'var(--border-faint)', fontSize: 15 }}>·</span>
          <span className="text-subheadline tabnum flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{badge}</span>
        </>
      )}
      <div className="flex-1" />
      {currentValue !== null ? (
        <>
          <span className="text-headline font-semibold tabnum flex-shrink-0" style={{ color: 'var(--text-2)' }}>
            {noR(formatINRFine(currentValue))}
          </span>
          {gainPct !== null && (
            <>
              <span className="flex-shrink-0 mx-1.5" style={{ color: 'var(--border-faint)', fontSize: 13 }}>·</span>
              <span className="text-subheadline font-bold tabnum flex-shrink-0"
                    style={{ color: positive ? 'var(--c-positive)' : 'var(--c-negative)' }}>
                {positive ? '+' : ''}{trimPct(gainPct)}%
              </span>
            </>
          )}
        </>
      ) : (
        <span className="text-headline font-bold flex-shrink-0" style={{ color: 'var(--text-faint)' }}>—</span>
      )}
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
  const rows = [...ppf.transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No deposits yet.</p>
  }

  return (
    <>
      {rows.map(t => {
        const isInterest = t.trade_type === 'interest'
        const label = isInterest
          ? `Interest ${fyLabel(t.trade_date)}`
          : new Date(t.trade_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        const amtColor = t.trade_type === 'withdrawal' ? 'var(--c-negative)' : 'var(--text-primary)'
        return (
          <div key={t.id} className="flex items-center px-4 py-3" style={{ borderTop: '1px solid var(--border-faint)' }}>
            <p className="flex-1 text-body tabnum"
               style={{ color: 'var(--text-2)', fontStyle: isInterest ? 'italic' : 'normal' }}>
              {label}
            </p>
            <p className="text-body tabnum"
               style={{ fontWeight: isInterest ? 400 : 600, fontStyle: isInterest ? 'italic' : 'normal', color: amtColor }}>
              {t.trade_type === 'withdrawal' ? '−' : ''}{noR(formatINRFine(t.amount))}
            </p>
          </div>
        )
      })}
    </>
  )
}

function EPFRow({ epf }: { epf: EPFSummary }) {
  const rows = [...epf.transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <p className="px-4 py-3 text-subheadline" style={{ color: 'var(--text-faint)' }}>No transactions yet. Import from passbook.</p>
  }

  return (
    <>
      {rows.map(t => {
        const isInterest = t.trade_type === 'interest'
        const label = isInterest
          ? `Interest ${fyLabel(t.trade_date)}`
          : new Date(t.trade_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        return (
          <div key={t.id} className="flex items-center px-4 py-3" style={{ borderTop: '1px solid var(--border-faint)' }}>
            <p className="flex-1 text-body tabnum"
               style={{ color: 'var(--text-2)', fontStyle: isInterest ? 'italic' : 'normal' }}>
              {label}
            </p>
            <p className="text-body tabnum"
               style={{ fontWeight: isInterest ? 400 : 600, fontStyle: isInterest ? 'italic' : 'normal', color: 'var(--text-primary)' }}>
              {noR(formatINRFine(t.amount))}
            </p>
          </div>
        )
      })}
    </>
  )
}


