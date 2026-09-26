'use client'

import React, { useState, useMemo, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trimZero, fyLabel, monthYear, formatDate } from '@/lib/formatter'
import { TxnRow, ppfToDisplayTxn, epfToDisplayTxn } from '@/components/EditableTxnRow'
import { mfAssetClass } from '@/lib/tax-compute'
import { Num, NumUnit } from '@/components/Num'
import { HoldingRow, type HoldingRowData } from '@/components/HoldingRow'
import HoldingsToolbar, { type ToolbarPill } from '@/components/HoldingsToolbar'
import { DEFAULT_SORT, nextSort, returnMetric, sortHoldings, type SortState } from '@/lib/holdings-sort'
import { istDay, laggingDates, shortDate } from '@/lib/price-freshness'
import { CheckIcon, ChevronRightIcon, RefreshIcon } from '@/components/icons'
import EmptyState from '@/components/EmptyState'
import UserMenu from '@/components/UserMenu'
import { sgbXirr, ppfXirr, epfXirr, computePPFBalance, computeEPFBalance, stockXirr, mfXirr, portfolioXirr } from '@/lib/xirr'
import { seqCost } from '@/lib/compute'
import { HELD_QTY_EPSILON, resolveCmp, type StockPriceInfo } from '@/lib/stock-prices'
import { computeMFHolding } from '@/lib/mf-compute'
import { computeSGBBatches, goldDisplayName, goldMeta } from '@/lib/sgb-compute'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction, MFHolding, EquitySummary, PPFSummary, EPFSummary } from '@/lib/portfolio-types'
import type { Transaction } from '@/lib/types'

/** The only stock-transaction fields the maths reads — page.tsx sends just these. */
export type StockTxn = Pick<Transaction, 'symbol' | 'trade_date' | 'trade_type' | 'quantity' | 'amount'>

interface Props {
  stockTxns: StockTxn[]                  // open positions only, already scoped by page.tsx
  bandCmps: Record<string, number>       // symbol → buy_bands.cmp snapshot, the resolveCmp fallback
  stockPrices: Record<string, StockPriceInfo>
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  mfNavs: Record<string, number>
  mfPrevNavs: Record<string, number | null>
  mfNavDates: Record<string, string>     // scheme_code → nav_date (YYYY-MM-DD), for the per-row lagging date
  pricesStale: boolean                   // server-computed: newest saved stock/gold price predates the last market close
  sgbTransactions: SGBTransaction[]
  goldPrice: number | null       // INR per gram, from stock_prices (null until the first Prices tap)
  prevGoldPrice: number | null
  ppfTransactions: PPFTransaction[]
  ppfOverride: PPFBalanceOverride | null
  epfTransactions: EPFTransaction[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStockHoldings(
  transactions: StockTxn[],
  bandCmps: Record<string, number>,
  stockPrices: Record<string, StockPriceInfo>,
): { symbol: string; qty: number; invested: number; currentValue: number | null; gain: number | null; xirr: number | null; gain1d: number | null; gain1dPct: number | null }[] {
  const bySymbol: Record<string, StockTxn[]> = {}
  for (const t of transactions) {
    ;(bySymbol[t.symbol] ??= []).push(t)
  }
  return Object.entries(bySymbol)
    .flatMap(([symbol, txns]) => {
      const { qty, cost } = seqCost(txns)
      if (qty <= HELD_QTY_EPSILON) return []
      // Saved price (stock_prices, written by the Prices button) beats the stored
      // band snapshot, which only updates when bands are regenerated and can be
      // stale for days — see resolveCmp.
      const cmp = resolveCmp(symbol, stockPrices, bandCmps[symbol])
      const currentValue = cmp ? qty * cmp : null
      const gain = currentValue !== null ? currentValue - cost : null
      const xirrVal = currentValue !== null ? stockXirr(txns, currentValue) : null
      const prev = stockPrices[symbol]?.prevClose ?? null
      const gain1d = cmp && prev ? qty * (cmp - prev) : null
      const gain1dPct = cmp && prev ? (cmp / prev - 1) * 100 : null
      return [{ symbol, qty, invested: cost, currentValue, gain, xirr: xirrVal, gain1d, gain1dPct }]
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

function computeMFHoldings(
  funds: MFund[],
  transactions: MFTransaction[],
  navs: Record<string, number>,
  prevNavs: Record<string, number | null>,
): MFHolding[] {
  const byFund: Record<string, MFTransaction[]> = {}
  for (const t of transactions) {
    ;(byFund[t.fund_id] ??= []).push(t)
  }
  return funds
    .flatMap(fund => {
      const txns = byFund[fund.id] ?? []
      if (txns.length === 0) return []
      const holding = computeMFHolding(fund, txns, navs[fund.scheme_code] ?? null, prevNavs[fund.scheme_code] ?? null)
      return holding ? [holding] : []
    })
    .sort((a, b) => a.fund.scheme_name.localeCompare(b.fund.scheme_name))
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

const assetClass = mfAssetClass

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioClient({
  stockTxns, bandCmps, stockPrices, mfFunds, mfTransactions, mfNavs, mfPrevNavs, mfNavDates, pricesStale,
  sgbTransactions, goldPrice, prevGoldPrice, ppfTransactions: initialPpfTransactions, ppfOverride,
  epfTransactions: initialEpfTransactions,
}: Props) {
  const router = useRouter()
  const [openSections, setOpenSections] = useState(new Set<string>())
  // Sort is per section and not persisted; the MF filter is one class or none.
  const [stockSort, setStockSort] = useState<SortState>(DEFAULT_SORT)
  const [mfSort, setMfSort] = useState<SortState>(DEFAULT_SORT)
  const [mfFilter, setMfFilter] = useState<'equity' | 'debt' | null>(null)
  const [ppfTxns, setPpfTxns] = useState(initialPpfTransactions)
  const [epfTxns, setEpfTxns] = useState(initialEpfTransactions)
  const [posting, setPosting] = useState(false)
  const [refreshPending, startRefresh] = useTransition()
  const refreshing = posting || refreshPending
  // Outcome of the last tap, for the button: 'updated' shows a check for ~2 s; 'partial' (some prices
  // failed, or the request did) sticks as "Retry" until the next tap.
  const [refreshResult, setRefreshResult] = useState<'idle' | 'updated' | 'partial'>('idle')

  // Stock, gold and MF NAV all arrive as props (page.tsx reads stock_prices / mf_navs) and only
  // change when the Prices button posts to /api/portfolio/prices/refresh and re-renders the page.
  // Nothing fetches on mount.
  const stockHoldings = useMemo(() => computeStockHoldings(stockTxns, bandCmps, stockPrices), [stockTxns, bandCmps, stockPrices])

  // Summary derived from holdings; no-CMP positions fall back to cost (gain 0)
  const equity: EquitySummary = useMemo(() => ({
    holdingsCount: stockHoldings.length,
    invested:      stockHoldings.reduce((s, h) => s + h.invested, 0),
    currentValue:  stockHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0),
    gain1d:        stockHoldings.reduce((s, h) => s + (h.gain1d ?? 0), 0),
  }), [stockHoldings])
  const mfHoldings    = useMemo(() => computeMFHoldings(mfFunds, mfTransactions, mfNavs, mfPrevNavs), [mfFunds, mfTransactions, mfNavs, mfPrevNavs])
  const sgbBatches    = useMemo(() => computeSGBBatches(sgbTransactions, goldPrice), [sgbTransactions, goldPrice])
  const ppf           = useMemo(() => computePPF(ppfTxns, ppfOverride), [ppfTxns, ppfOverride])
  const epf           = useMemo(() => computeEPF(epfTxns), [epfTxns])

  // Summary numbers
  const mfInvested      = mfHoldings.reduce((s, h) => s + h.invested, 0)
  const mfCurrentValue  = mfHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfGain1d        = mfHoldings.reduce((s, h) => s + (h.gain1d ?? 0), 0)
  const sgbInvested     = sgbBatches.reduce((s, b) => s + b.invested, 0)
  const sgbCurrentValue = sgbBatches.reduce((s, b) => s + (b.currentValue ?? b.invested), 0)
  const totalInvested   = equity.invested + mfInvested + sgbInvested + ppf.totalDeposited + epf.totalDeposited
  const totalCurrent    = equity.currentValue + mfCurrentValue + sgbCurrentValue + ppf.currentBalance + epf.computedBalance
  const totalGain       = totalCurrent - totalInvested

  // Overall XIRR: wait for live prices before computing so the terminal value is accurate.
  // stockTxns is the same open-position list computeStockHoldings uses, so the stock cashflows
  // and totalCurrent cover the same stocks (exited positions are in neither).
  // MF NAV is server-rendered (no client fetch to wait on) — only gold still gates this.
  const overallXirr = useMemo(() => {
    if (sgbTransactions.length > 0 && goldPrice === null) return null
    return portfolioXirr(stockTxns, mfTransactions, sgbTransactions, ppfTxns, epfTxns, totalCurrent)
  }, [stockTxns, mfTransactions, sgbTransactions, ppfTxns, epfTxns, totalCurrent, goldPrice])

  // Section-level XIRR for MF and Gold headers
  const mfSectionXirr = useMemo(() => {
    if (mfCurrentValue === 0 || mfTransactions.length === 0) return null
    return mfXirr(mfTransactions, mfCurrentValue)
  }, [mfTransactions, mfCurrentValue])

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

  // Holdings lists — one HoldingRowData per row (Stocks, MF, Gold), sorted/filtered for display.
  // A holding whose saved price is older than the rest's shows its own date in place of "1D"
  // (a fund whose NAV publishes a day late; a stock whose price failed on the last tap).
  const stockLag = useMemo(() => {
    const days: Record<string, string> = {}
    for (const h of stockHoldings) {
      const info = stockPrices[h.symbol]
      const day = info ? istDay(info.fetchedAt) : null
      if (day) days[h.symbol] = day
    }
    return laggingDates(days)
  }, [stockHoldings, stockPrices])
  const mfLag = useMemo(() => {
    const days: Record<string, string> = {}
    for (const h of mfHoldings) {
      const day = mfNavDates[h.fund.scheme_code]
      if (day) days[h.fund.scheme_code] = day
    }
    return laggingDates(days)
  }, [mfHoldings, mfNavDates])

  const stockRows = useMemo<HoldingRowData[]>(() => stockHoldings.map(h => {
    const r = returnMetric(h.xirr, h.gain, h.invested)
    return {
      key: h.symbol, name: h.symbol, href: `/portfolio/stock/${encodeURIComponent(h.symbol)}`,
      value: h.currentValue, pnl: h.gain, retPct: r.pct, retLabel: r.label,
      dayPct: h.gain1dPct, day: { amount: h.gain1d, pct: h.gain1dPct },
      staleDate: stockLag[h.symbol] ? shortDate(stockLag[h.symbol]) : undefined,
    }
  }), [stockHoldings, stockLag])
  const mfRows = useMemo<HoldingRowData[]>(() => mfHoldings.map(h => {
    const r = returnMetric(h.xirr, h.gain, h.invested)
    return {
      key: h.fund.id, name: h.fund.scheme_name, href: `/portfolio/mf/${h.fund.id}`,
      value: h.currentValue, pnl: h.gain, retPct: r.pct, retLabel: r.label,
      dayPct: h.gain1dPct, day: { amount: h.gain1d, pct: h.gain1dPct },
      assetClass: assetClass(h.fund),
      staleDate: mfLag[h.fund.scheme_code] ? shortDate(mfLag[h.fund.scheme_code]) : undefined,
    }
  }), [mfHoldings, mfLag])
  // Gold rows have no 1D figure (`meta` fills that slot) and keep their batch order — no sort control.
  const goldRows = useMemo<HoldingRowData[]>(() => sgbBatches.map(b => {
    const r = returnMetric(b.xirr, b.gain, b.invested)
    return {
      key: b.key, name: goldDisplayName(b), href: `/portfolio/gold/${encodeURIComponent(b.key)}`,
      value: b.currentValue, pnl: b.gain, retPct: r.pct, retLabel: r.label,
      dayPct: null, meta: goldMeta(b),
    }
  }), [sgbBatches])

  // Equity/Debt pills only when both classes are held (one class has nothing to filter against).
  // A filter left over from before a class was sold out is ignored rather than showing an empty list.
  const mfHasBothClasses = mfRows.some(r => r.assetClass === 'equity') && mfRows.some(r => r.assetClass === 'debt')
  const mfEqPct = mfCurrentValue > 0 ? Math.round(mfEquity / mfCurrentValue * 100) : 0
  const mfPills: ToolbarPill[] = [
    { key: 'equity', label: 'Equity', color: 'var(--c-equity)', pct: mfEqPct },
    { key: 'debt',   label: 'Debt',   color: 'var(--c-debt)',   pct: 100 - mfEqPct },
  ]
  const activeMfFilter = mfHasBothClasses ? mfFilter : null
  const visibleStockRows = useMemo(() => sortHoldings(stockRows, stockSort), [stockRows, stockSort])
  const visibleMfRows = useMemo(
    () => sortHoldings(activeMfFilter ? mfRows.filter(r => r.assetClass === activeMfFilter) : mfRows, mfSort),
    [mfRows, activeMfFilter, mfSort],
  )

  const totalGoldGrams = sgbBatches.reduce((s, b) => s + b.grams, 0)
  // Portfolio-level only — no per-batch line item (gold rows don't get a 1D figure, unlike Stock/MF).
  const goldGain1d = goldPrice !== null && prevGoldPrice !== null ? totalGoldGrams * (goldPrice - prevGoldPrice) : null

  // 1D Gain rolls in Stocks + MF + Gold — PPF/EPF excluded (no daily price). 1D % is
  // the plain (non-annualised) move: totalCurrent − totalGain1d is "yesterday", so
  // static PPF/EPF sit in the denominator with zero movement and dilute it, as they should.
  const totalGain1d = (equity.gain1d ?? 0) + mfGain1d + (goldGain1d ?? 0)
  const prevTotal    = totalCurrent - totalGain1d
  const dayPct       = prevTotal > 0 ? totalGain1d / prevTotal * 100 : null

  // Fetch + save the latest prices server-side, then re-render so the page reads them back.
  // A failed POST still re-renders (harmlessly, with whatever is saved) — the transition
  // keeps the button busy until the new server render has actually landed. The button reports
  // the outcome: some prices failing (or the request failing) leaves it on "Retry".
  async function handleRefresh() {
    setPosting(true)
    let outcome: 'updated' | 'partial' = 'partial'
    try {
      const res = await fetch('/api/portfolio/prices/refresh', { method: 'POST' })
      if (res.ok) {
        const body = await res.json() as { stocks?: { failed?: unknown[] }; gold?: string }
        outcome = (body.stocks?.failed?.length ?? 0) > 0 || body.gold === 'failed' ? 'partial' : 'updated'
      }
    } catch { /* outcome stays 'partial'; fall through to the re-render below */ }
    setRefreshResult(outcome)
    startRefresh(() => router.refresh())
    setPosting(false)
  }

  // The "Updated" flash lasts ~2 s counted from when the new render has landed, not from the tap.
  useEffect(() => {
    if (refreshResult !== 'updated' || refreshing) return
    const t = setTimeout(() => setRefreshResult('idle'), 2000)
    return () => clearTimeout(t)
  }, [refreshResult, refreshing])

  // The Prices button doubles as the status — no caption line. Fresh is silent; an amber dot means
  // the saved prices are due (or some failed); see docs/design.md and progress log #121.b.
  const pricesButton = refreshing ? 'updating'
    : refreshResult === 'updated' ? 'updated'
    : refreshResult === 'partial' ? 'retry'
    : pricesStale ? 'stale' : 'fresh'
  const pricesLabel = { updating: 'Updating…', updated: 'Updated', retry: 'Retry', stale: 'Prices', fresh: 'Prices' }[pricesButton]

  function toggleSection(id: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function updatePPFTxn(u: PPFTransaction) { setPpfTxns(prev => prev.map(t => t.id === u.id ? u : t)) }
  function updateEPFTxn(u: EPFTransaction) { setEpfTxns(prev => prev.map(t => t.id === u.id ? u : t)) }
  function deletePPFTxn(id: string) { setPpfTxns(prev => prev.filter(t => t.id !== id)) }
  function deleteEPFTxn(id: string) { setEpfTxns(prev => prev.filter(t => t.id !== id)) }

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
                aria-label={pricesButton === 'stale' ? 'Refresh prices — saved prices are out of date'
                  : pricesButton === 'retry' ? 'Retry — some prices did not update' : undefined}
                className="flex items-center gap-1.5 text-accent text-body rounded-lg px-2.5 min-h-[44px] disabled:opacity-40 mr-1.5"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <span className="relative inline-flex">
            {pricesButton === 'updated'
              ? <CheckIcon className="w-4 h-4" />
              : <RefreshIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            {(pricesButton === 'stale' || pricesButton === 'retry') && (
              <span className="absolute rounded-full"
                    style={{ top: -3, right: -4, width: 8, height: 8, background: 'var(--c-warning)', border: '1.5px solid var(--bg-secondary)' }} />
            )}
          </span>
          {pricesLabel}
        </button>
        <UserMenu />
      </div>

      {/* Summary: 3-col grid — no justify-between stretch */}
      <div className="grid px-4 py-2 border-b"
           style={{ gridTemplateColumns: '1fr 1fr auto', gap: '0', borderColor: 'var(--border-faint)' }}>
        <div className="flex flex-col gap-2">
          <SCell label="Current Value" amount={totalCurrent} />
          <SCell label="Gain" amount={totalGain} signed />
          <SCell label="1D Gain" amount={totalGain1d} signed />
        </div>
        <div className="flex flex-col gap-2 pl-4" style={{ marginLeft: 8 }}>
          <SCell label="Invested" amount={totalInvested} />
          <SCell label="XIRR p.a." pct={overallXirr !== null ? overallXirr * 100 : null} signed />
          <SCell label="1D %" pct={dayPct} signed />
        </div>
        <FilledPieChart equity={eqPct} debt={debtPct} gold={goldPct} />
      </div>

      {/* Scrollable sections */}
      <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 88px)' }}>

        {/* EQUITY */}
        <SectionHeader
          id="equity" label="Stocks"
          invested={equity.invested > 0 ? <Num amount={equity.invested} align /> : null}
          gainPct={equity.invested > 0 ? ((equity.currentValue - equity.invested) / equity.invested * 100) : null}
          currentValue={equity.currentValue > 0 ? equity.currentValue : null}
          open={openSections.has('equity')}
          onToggle={() => toggleSection('equity')}
        />
        {openSections.has('equity') && (
          <>
            {visibleStockRows.length > 0 && (
              <>
                {stockRows.length >= 2 && (
                  <HoldingsToolbar sort={stockSort} onSort={k => setStockSort(cur => nextSort(cur, k))} />
                )}
                {visibleStockRows.map(r => (
                  <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
                ))}
              </>
            )}
            {stockHoldings.length === 0 && (
              <EmptyState>No stock holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* MUTUAL FUNDS */}
        <SectionHeader
          id="mf" label="MF"
          invested={mfInvested > 0 ? <Num amount={mfInvested} align /> : null}
          gainPct={mfSectionXirr !== null ? mfSectionXirr * 100 : null}
          currentValue={mfCurrentValue > 0 ? mfCurrentValue : null}
          open={openSections.has('mf')}
          onToggle={() => toggleSection('mf')}
        />
        {openSections.has('mf') && (
          <>
            {mfRows.length > 0 && (
              <>
                {(mfHasBothClasses || mfRows.length >= 2) && (
                  <HoldingsToolbar
                    sort={mfSort} onSort={k => setMfSort(cur => nextSort(cur, k))}
                    pills={mfHasBothClasses ? mfPills : undefined}
                    activePill={activeMfFilter}
                    onPill={k => setMfFilter(cur => (cur === k ? null : k as 'equity' | 'debt'))} />
                )}
                {visibleMfRows.map(r => (
                  <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
                ))}
              </>
            )}
            {mfHoldings.length === 0 && (
              <EmptyState>No mutual fund holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* Gold */}
        <SectionHeader
          id="sgb" label="Gold"
          invested={totalGoldGrams > 0 ? <NumUnit digits={trimZero(totalGoldGrams)} unit="g" /> : null}
          gainPct={goldSectionXirr !== null ? goldSectionXirr * 100 : null}
          currentValue={sgbCurrentValue > 0 ? sgbCurrentValue : null}
          open={openSections.has('sgb')}
          onToggle={() => toggleSection('sgb')}
        />
        {openSections.has('sgb') && (
          <>
            {goldRows.length > 0 && goldRows.map(r => (
              <HoldingRow key={r.key} row={r} onClick={() => router.push(r.href)} />
            ))}
            {sgbBatches.length === 0 && (
              <EmptyState>No gold holdings yet.</EmptyState>
            )}
          </>
        )}

        {/* PPF */}
        <SectionHeader
          id="ppf" label="PPF"
          invested={ppf.totalDeposited > 0 ? <Num amount={ppf.totalDeposited} align /> : null}
          gainPct={ppf.totalDeposited > 0 ? ((ppf.currentBalance - ppf.totalDeposited) / ppf.totalDeposited * 100) : null}
          currentValue={ppf.currentBalance > 0 ? ppf.currentBalance : null}
          open={openSections.has('ppf')}
          onToggle={() => toggleSection('ppf')}
        />
        {openSections.has('ppf') && (
          <PPFRow ppf={ppf} onSaved={updatePPFTxn} onDeleted={deletePPFTxn} />
        )}

        {/* EPF */}
        <SectionHeader
          id="epf" label="EPF"
          invested={epf.totalDeposited > 0 ? <Num amount={epf.totalDeposited} align /> : null}
          gainPct={epf.xirr !== null ? epf.xirr * 100 : null}
          currentValue={epf.computedBalance > 0 ? epf.computedBalance : null}
          open={openSections.has('epf')}
          onToggle={() => toggleSection('epf')}
        />
        {openSections.has('epf') && (
          <EPFRow epf={epf} onSaved={updateEPFTxn} onDeleted={deleteEPFTxn} />
        )}

        {/* Reports */}
        <div className="px-4" style={{ paddingTop: 24, paddingBottom: 6 }}>
          <span className="text-subheadline font-bold uppercase" style={{ color: 'var(--text-2)', letterSpacing: '0.08em' }}>Reports</span>
        </div>
        <button
          onClick={() => router.push('/tax')}
          className="flex items-center gap-3 w-full px-4 tap-row"
          style={{ minHeight: 52 }}>
          <span className="flex items-center justify-center flex-shrink-0"
                style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14l2 2 4-4M7 3H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2h-2M9 3h6a1 1 0 010 2H9a1 1 0 010-2z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Tax Report</p>
            <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>Capital gains</p>
          </div>
          <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </button>
        <button
          onClick={() => router.push('/dividends')}
          className="flex items-center gap-3 w-full px-4 tap-row"
          style={{ minHeight: 52 }}>
          <span className="flex items-center justify-center flex-shrink-0"
                style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-headline font-semibold" style={{ color: 'var(--text-primary)' }}>Dividends</p>
            <p className="text-subheadline" style={{ color: 'var(--text-2)' }}>Income received</p>
          </div>
          <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </button>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SCell({ label, amount, pct, signed }: {
  label: string
  amount?: number | null
  pct?: number | null
  signed?: boolean
}) {
  const val = amount !== undefined ? amount : pct
  const positive = signed && val !== null && val !== undefined && val > 0
  const negative = signed && val !== null && val !== undefined && val < 0
  return (
    <div className="flex flex-col gap-1">
      <p className="text-subheadline" style={{ color: 'var(--text-2)', letterSpacing: '0.02em' }}>{label}</p>
      <p className="text-title-1 font-bold tabnum"
         style={{ color: positive ? 'var(--c-positive)' : negative ? 'var(--c-negative)' : 'var(--text-primary)' }}>
        {amount !== undefined
          ? <Num amount={amount} signed={signed} />
          : <Num pct={pct ?? null} signed={signed} />}
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
    { pct: debt,   color: 'var(--c-debt)',   darkLabel: false },
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

function SectionHeader({ id, label, invested, gainPct, currentValue, open, onToggle }: {
  id: string; label: string; invested: React.ReactNode
  gainPct: number | null; currentValue: number | null
  open: boolean; onToggle: () => void
}) {
  const positive = gainPct !== null && gainPct >= 0

  return (
    <button onClick={onToggle}
            className="grid w-full items-baseline gap-x-2 px-4"
            style={{ background: 'rgba(255,255,255,0.025)', minHeight: 52, paddingTop: 14, paddingBottom: 14, gridTemplateColumns: SECTION_HEADER_COLS }}>
      <span className="text-headline font-bold truncate text-left" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <span className="text-body tabnum" style={{ color: 'var(--text-2)' }}>{invested}</span>
      <span className="text-headline font-semibold tabnum"
            style={{ color: currentValue !== null ? 'var(--text-2)' : 'var(--text-faint)' }}>
        <Num amount={currentValue} align />
      </span>
      {gainPct !== null ? (
        <span className={`text-body font-bold tabnum ${positive ? 'text-positive' : 'text-negative'}`}>
          <Num pct={gainPct} signed align />
        </span>
      ) : (
        <span />
      )}
      <ChevronRightIcon
        className={`w-4 h-4 transition-transform duration-150 justify-self-end self-center ${open ? 'rotate-90' : ''}`}
        style={{ color: 'var(--text-muted)' }} />
    </button>
  )
}

const SECTION_HEADER_COLS = 'minmax(0,1fr) 58px 78px 62px 1rem'
function PPFRow({ ppf, onSaved, onDeleted }: {
  ppf: PPFSummary
  onSaved: (u: PPFTransaction) => void
  onDeleted: (id: string) => void
}) {
  const rows = [...ppf.transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <EmptyState>No deposits yet.</EmptyState>
  }

  return (
    <>
      {rows.map(t => (
        <TxnRow key={t.id}
          txn={ppfToDisplayTxn(t)}
          showAssetTag={false}
          onDelete={id => onDeleted(id)}
          onSavedStock={() => {}}
          onSavedMF={() => {}}
          onSavedSGB={() => {}}
          onSavedPPF={onSaved}
          onSavedEPF={() => {}}
        />
      ))}
    </>
  )
}

function EPFRow({ epf, onSaved, onDeleted }: {
  epf: EPFSummary
  onSaved: (u: EPFTransaction) => void
  onDeleted: (id: string) => void
}) {
  const rows = [...epf.transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date))

  if (rows.length === 0) {
    return <EmptyState>No transactions yet. Import from passbook.</EmptyState>
  }

  return (
    <>
      {rows.map(t => {
        const isInterest = t.trade_type === 'interest'
        return (
          <TxnRow key={t.id}
            txn={epfToDisplayTxn(t)}
            showAssetTag={false}
            compactLabel={{
              text: isInterest ? `Interest ${fyLabel(t.trade_date)}` : monthYear(t.wage_month ?? t.trade_date),
              faint: formatDate(t.trade_date),
              italic: isInterest,
            }}
            onDelete={id => onDeleted(id)}
            onSavedStock={() => {}}
            onSavedMF={() => {}}
            onSavedSGB={() => {}}
            onSavedPPF={() => {}}
            onSavedEPF={onSaved}
          />
        )
      })}
    </>
  )
}
