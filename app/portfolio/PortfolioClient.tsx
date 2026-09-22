'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trimZero, fyLabel, monthYear, formatDate, getGainColor } from '@/lib/formatter'
import { TxnRow, ppfToDisplayTxn, epfToDisplayTxn } from '@/components/EditableTxnRow'
import { mfAssetClass } from '@/lib/tax-compute'
import { Num, NumUnit } from '@/components/Num'
import { ChevronRightIcon, RefreshIcon } from '@/components/icons'
import EmptyState from '@/components/EmptyState'
import UserMenu from '@/components/UserMenu'
import { sgbXirr, ppfXirr, epfXirr, computePPFBalance, computeEPFBalance, stockXirr, mfXirr, portfolioXirr, oneDayXirr } from '@/lib/xirr'
import { seqCost } from '@/lib/compute'
import { computeMFHolding } from '@/lib/mf-compute'
import { computeSGBBatches, goldDisplayName, goldMeta } from '@/lib/sgb-compute'
import type { MFund, MFTransaction, SGBTransaction, PPFTransaction, PPFBalanceOverride, EPFTransaction, MFHolding, EquitySummary, PPFSummary, EPFSummary } from '@/lib/portfolio-types'
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

function computeStockHoldings(
  transactions: Transaction[],
  bands: BuyBand[],
  allowedSymbols: string[],
  liveCmp: Record<string, number>,
  prevClose: Record<string, number | null>,
): { symbol: string; qty: number; invested: number; currentValue: number | null; gain: number | null; xirr: number | null; gain1d: number | null; gain1dPct: number | null }[] {
  const allowed = new Set(allowedSymbols)
  const bySymbol: Record<string, Transaction[]> = {}
  for (const t of transactions) {
    if (allowed.size > 0 && !allowed.has(t.symbol)) continue
    ;(bySymbol[t.symbol] ??= []).push(t)
  }
  const cmpBySymbol = new Map(bands.map(b => [b.symbol, b.cmp]))
  return Object.entries(bySymbol)
    .flatMap(([symbol, txns]) => {
      const { qty, cost } = seqCost(txns)
      if (qty <= 0.001) return []
      // Prefer a live-fetched CMP over the stored band snapshot, which only
      // updates when bands are (re)generated and can be stale for days.
      const cmp = liveCmp[symbol] ?? cmpBySymbol.get(symbol) ?? null
      const currentValue = cmp ? qty * cmp : null
      const gain = currentValue !== null ? currentValue - cost : null
      const xirrVal = currentValue !== null ? stockXirr(txns, currentValue) : null
      const prev = prevClose[symbol] ?? null
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

const NAV_CACHE_KEY = 'mfNavCache'

function readNavCache(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(NAV_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortfolioClient({
  allTransactions, bands, latestYearSymbols, mfFunds, mfTransactions,
  sgbTransactions, ppfTransactions: initialPpfTransactions, ppfOverride,
  epfTransactions: initialEpfTransactions,
}: Props) {
  const router = useRouter()
  const [openSections, setOpenSections] = useState(new Set<string>())
  const [ppfTxns, setPpfTxns] = useState(initialPpfTransactions)
  const [epfTxns, setEpfTxns] = useState(initialEpfTransactions)
  const [navs, setNavs]         = useState<Record<string, number>>(() => readNavCache())
  const [navsLoading, setNavsLoading] = useState(() => mfFunds.some(f => readNavCache()[f.scheme_code] === undefined))
  const [prevNavs, setPrevNavs] = useState<Record<string, number | null>>({})
  const [liveCmp, setLiveCmp] = useState<Record<string, number>>({})
  const [prevClose, setPrevClose] = useState<Record<string, number | null>>({})
  const [goldPrice, setGoldPrice] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const v = localStorage.getItem('goldPricePerGram')
    return v ? parseFloat(v) : null
  })
  const [prevGoldPrice, setPrevGoldPrice] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // Live gold price via Yahoo Finance proxy; persists last known price in localStorage.
  // prevPricePerGram (yesterday's close) feeds 1D gain only — not persisted, same as
  // prevNavs/prevClose above.
  useEffect(() => {
    fetch('/api/gold-price')
      .then(r => r.json())
      .then(d => {
        if (d.pricePerGram) {
          setGoldPrice(d.pricePerGram)
          localStorage.setItem('goldPricePerGram', String(d.pricePerGram))
        }
        setPrevGoldPrice(d.prevPricePerGram ?? null)
      })
      .catch(() => {})
  }, [refreshKey])

  // Live NAV fetch from mfapi.in; seeded from localStorage above so the MF section
  // renders real numbers immediately, then this refreshes in the background.
  // The same response's data[1] is the previous *published* NAV (not strictly
  // "yesterday" — lags further over a weekend/holiday gap) — used for 1D gain,
  // no extra request needed.
  useEffect(() => {
    if (mfFunds.length === 0) return
    Promise.all(
      mfFunds.map(f =>
        fetch(`https://api.mfapi.in/mf/${f.scheme_code}`)
          .then(r => r.json())
          .then(d => [f.scheme_code, parseFloat(d.data?.[0]?.nav ?? '0'), parseFloat(d.data?.[1]?.nav ?? '0') || null] as [string, number, number | null])
          .catch(() => [f.scheme_code, 0, null] as [string, number, number | null])
      )
    ).then(results => {
      setNavs(prev => {
        const next = { ...prev }
        for (const [code, nav] of results) { if (nav > 0) next[code] = nav }
        try { localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(next)) } catch {}
        return next
      })
      setPrevNavs(prev => {
        const next = { ...prev }
        for (const [code, , prevNav] of results) next[code] = prevNav
        return next
      })
      setNavsLoading(false)
    })
  }, [mfFunds, refreshKey])

  const stockHoldings = useMemo(() => computeStockHoldings(allTransactions, bands, latestYearSymbols, liveCmp, prevClose), [allTransactions, bands, latestYearSymbols, liveCmp, prevClose])

  // Live CMP fetch for held stocks — bands.cmp above is a stored snapshot that only
  // refreshes when bands are (re)generated on the Bands screen, so it can be stale
  // for days. Mirrors the NAV/gold-price live-fetch pattern; the symbol set is
  // derived from holdings but doesn't depend on cmp, so this can't loop with the
  // state update below. No DB write-back — unlike BandsClient's refresh, this is
  // local display state only, so it can't race with band generation elsewhere.
  const heldSymbolsKey = stockHoldings.map(h => h.symbol).join(',')
  useEffect(() => {
    if (!heldSymbolsKey) return
    fetch(`/api/cmp/batch?symbols=${encodeURIComponent(heldSymbolsKey)}`)
      .then(r => r.json())
      .then(d => {
        if (d.prices) setLiveCmp(prev => ({ ...prev, ...d.prices }))
        if (d.prevClose) setPrevClose(prev => ({ ...prev, ...d.prevClose }))
      })
      .catch(() => {})
  }, [heldSymbolsKey, refreshKey])

  // Summary derived from holdings; no-CMP positions fall back to cost (gain 0)
  const equity: EquitySummary = useMemo(() => ({
    holdingsCount: stockHoldings.length,
    invested:      stockHoldings.reduce((s, h) => s + h.invested, 0),
    currentValue:  stockHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0),
    gain1d:        stockHoldings.reduce((s, h) => s + (h.gain1d ?? 0), 0),
  }), [stockHoldings])
  const mfHoldings    = useMemo(() => computeMFHoldings(mfFunds, mfTransactions, navs, prevNavs), [mfFunds, mfTransactions, navs, prevNavs])
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
  // Use the same symbol filter as computeStockHoldings for consistency with totalCurrent.
  const overallXirr = useMemo(() => {
    if (navsLoading || (sgbTransactions.length > 0 && goldPrice === null)) return null
    const equityTxns = latestYearSymbols.length > 0
      ? allTransactions.filter(t => latestYearSymbols.includes(t.symbol))
      : allTransactions
    return portfolioXirr(equityTxns, mfTransactions, sgbTransactions, ppfTxns, epfTxns, totalCurrent)
  }, [allTransactions, mfTransactions, sgbTransactions, ppfTxns, epfTxns, totalCurrent, navsLoading, goldPrice, latestYearSymbols])

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
  // Portfolio-level only — no per-batch line item (gold rows don't get a 1D figure, unlike Stock/MF).
  const goldGain1d = goldPrice !== null && prevGoldPrice !== null ? totalGoldGrams * (goldPrice - prevGoldPrice) : null

  // 1D Gain rolls in Stocks + MF + Gold — PPF/EPF excluded (no daily price). 1D XIRR
  // treats totalCurrent as "today" and totalCurrent − totalGain1d as "yesterday",
  // so static PPF/EPF dilute the annualised figure exactly like they should.
  const totalGain1d = (equity.gain1d ?? 0) + mfGain1d + (goldGain1d ?? 0)
  const dayXirr      = oneDayXirr(totalCurrent, totalGain1d)

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
          <SCell label="Current Value" amount={totalCurrent} />
          <SCell label="Gain" amount={totalGain} signed />
          <SCell label="1D Gain" amount={totalGain1d} signed />
        </div>
        <div className="flex flex-col gap-2 pl-4" style={{ marginLeft: 8 }}>
          <SCell label="Invested" amount={totalInvested} />
          <SCell label="XIRR p.a." pct={overallXirr !== null ? overallXirr * 100 : null} signed />
          <SCell label="1D XIRR" pct={dayXirr !== null ? dayXirr * 100 : null} signed />
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
            {stockHoldings.length > 0 && (
              <>
                <ColHeaders c1="Stock" c2="Inv" c3="Curr" c4="Return" />
                {stockHoldings.map(h => (
                  <FundRow key={h.symbol}
                    name={h.symbol}
                    dayGain={{ amount: h.gain1d, pct: h.gain1dPct }}
                    invested={h.invested}
                    current={h.currentValue}
                    gain={h.gain}
                    xirr={h.xirr}
                    onClick={() => router.push(`/portfolio/stock/${encodeURIComponent(h.symbol)}`)}
                  />
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
            {mfHoldings.length > 0 && (
              <>
                <ColHeaders c1="Fund" c2="Inv" c3="Curr" c4="Return" />
                {[
                  { label: 'Equity', color: 'var(--c-equity)', amount: mfEquity, holdings: mfHoldings.filter(h => assetClass(h.fund) === 'equity') },
                  { label: 'Debt',   color: 'var(--c-debt)',   amount: mfDebt,   holdings: mfHoldings.filter(h => assetClass(h.fund) === 'debt') },
                ].map(group => group.holdings.length > 0 && (
                  <React.Fragment key={group.label}>
                    <MFGroupDivider label={group.label} color={group.color} amount={group.amount} />
                    {group.holdings.map(h => (
                      <FundRow key={h.fund.id}
                        name={h.fund.scheme_name}
                        dayGain={{ amount: h.gain1d, pct: h.gain1dPct }}
                        invested={h.invested}
                        current={h.currentValue}
                        gain={h.gain}
                        xirr={h.xirr}
                        onClick={() => router.push(`/portfolio/mf/${h.fund.id}`)}
                      />
                    ))}
                  </React.Fragment>
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
            {sgbBatches.length > 0 && (
              <>
                <ColHeaders c1="Gold" c2="Inv" c3="Curr" c4="Return" />
                {sgbBatches.map(b => (
                  <FundRow key={b.key}
                    name={goldDisplayName(b)}
                    meta={goldMeta(b)}
                    invested={b.invested}
                    current={b.currentValue}
                    gain={b.gain}
                    xirr={b.xirr}
                    onClick={() => router.push(`/portfolio/gold/${encodeURIComponent(b.key)}`)}
                  />
                ))}
              </>
            )}
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
          <span className="text-footnote font-bold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>Reports</span>
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
            <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>Capital gains</p>
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
            <p className="text-subheadline" style={{ color: 'var(--text-faint)' }}>Income received</p>
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
      <p className="text-subheadline" style={{ color: 'var(--text-faint)', letterSpacing: '0.02em' }}>{label}</p>
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
      <span className="text-subheadline tabnum" style={{ color: 'var(--text-faint)' }}>{invested}</span>
      <span className="text-headline font-semibold tabnum"
            style={{ color: currentValue !== null ? 'var(--text-2)' : 'var(--text-faint)' }}>
        <Num amount={currentValue} align />
      </span>
      {gainPct !== null ? (
        <span className={`text-subheadline font-bold tabnum ${positive ? 'text-positive' : 'text-negative'}`}>
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

const SECTION_HEADER_COLS = 'minmax(0,1fr) 5.5ch 8ch 6ch 1rem'
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

function MFGroupDivider({ label, color, amount }: { label: string; color: string; amount: number }) {
  return (
    <div className="px-4 py-1" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <span className="text-footnote font-bold uppercase tabnum" style={{ color, letterSpacing: '0.07em' }}>
        {label} · <Num amount={amount} />
      </span>
    </div>
  )
}

function FundRow({ name, meta, dayGain, invested, current, gain, xirr, onClick }: {
  name: string; meta?: string; invested: number; current: number | null
  gain: number | null; xirr: number | null
  dayGain?: { amount: number | null; pct: number | null }
  onClick?: () => void
}) {
  const positive = (gain ?? 0) > 0
  const xirrPct = xirr !== null ? xirr * 100
    : (gain !== null && invested > 0 ? (gain / invested) * 100 : null)
  const content = (
    <div className="grid px-4 py-3"
         style={{ minHeight: 52, gridTemplateColumns: FUND_ROW_COLS, alignItems: 'start' }}>
      <div className="min-w-0 pr-2">
        <div className="flex items-start gap-1">
          <p className="min-w-0 flex-1 text-headline font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
          {onClick && (
            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
          )}
        </div>
        <p className="text-footnote mt-0.5 tabnum" style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {dayGain ? (
            <>
              <span style={{ color: 'var(--text-faint)' }}>1D</span>{' '}
              <span style={{ color: dayGain.amount !== null ? getGainColor(dayGain.amount) : 'var(--text-2)' }}>
                <Num amount={dayGain.amount} signed />{'  '}<Num pct={dayGain.pct} signed />
              </span>
            </>
          ) : meta}
        </p>
      </div>
      <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
        <Num amount={invested} align />
      </p>
      <p className="text-body font-semibold tabnum" style={{ color: 'var(--text-primary)' }}>
        <Num amount={current} align />
      </p>
      <div>
        <p className="text-body font-semibold tabnum"
           style={{ color: positive ? 'var(--c-positive)' : 'var(--text-primary)' }}>
          <Num amount={gain} signed align />
        </p>
        {xirrPct !== null && (
          <p className="text-footnote tabnum mt-0.5"
             style={{ color: positive ? 'var(--c-positive)' : 'var(--text-faint)' }}>
            <Num pct={xirrPct} signed align />
          </p>
        )}
      </div>
    </div>
  )

  if (!onClick) return content

  return (
    <button onClick={onClick} className="block w-full text-left tap-row">
      {content}
    </button>
  )
}

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
