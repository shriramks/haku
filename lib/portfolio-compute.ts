// Everything the Portfolio screen shows, computed in one pass — called from app/portfolio/page.tsx
// so the phone receives finished rows and totals instead of raw transactions (progress log #125).
// Pure: no React, no server imports. The maths is the old PortfolioClient code, moved not rewritten.
import { seqCost } from './compute'
import { computeMFHolding } from './mf-compute'
import { computeSGBBatches, goldDisplayName, goldMeta } from './sgb-compute'
import { HELD_QTY_EPSILON, resolveCmp, type StockPriceInfo } from './stock-prices'
import { formatUsd, trimZero } from './formatter'
import { istDay, laggingDates, shortDate } from './price-freshness'
import { returnMetric } from './holdings-sort'
import { mfAssetClass } from './tax-compute'
import { computeRegionExposure, type DirectHoldingInput, type RegionExposure } from './exposure'
import {
  computeEPFBalance, computePPFBalance, epfXirr, mfXirr, portfolioXirr, sgbXirr, stockXirr,
} from './xirr'
import type { HoldingRowData } from '@/components/HoldingRow'
import type {
  EPFTransaction, MFHolding, MFTransaction, MFund, PPFBalanceOverride, PPFTransaction, SGBTransaction,
} from './portfolio-types'
import type { Transaction } from './types'

/** The only stock-transaction fields the maths reads. */
export type StockTxn = Pick<Transaction, 'symbol' | 'trade_date' | 'trade_type' | 'quantity' | 'amount'>

/** Today's USD->INR rate and the prior close (`getUsdInrRate` shape, reduced to the numbers). */
export interface UsdInrRate {
  rate: number
  prevRate: number | null
}

/** What the `stocks` master says about a symbol; a symbol without an entry is an INR / India stock. */
export interface InstrumentInfo {
  currency: string
  region: 'india' | 'us'
  name: string
}

const INR_INSTRUMENT: InstrumentInfo = { currency: 'INR', region: 'india', name: '' }

/** A saved MF NAV row (`getMFNavs`), keyed by scheme code in the input. */
export interface MFNavRow { nav: number; prevNav: number | null; navDate: string }

export interface PortfolioInput {
  /** Open positions only, already scoped by page.tsx. */
  stockTxns: StockTxn[]
  /** symbol → buy_bands.cmp snapshot, the resolveCmp fallback. */
  bandCmps: Record<string, number>
  stockPrices: Record<string, StockPriceInfo>
  mfFunds: MFund[]
  mfTransactions: MFTransaction[]
  mfNavs: Record<string, MFNavRow>
  sgbTransactions: SGBTransaction[]
  /** INR per gram; null until the first Prices tap. */
  goldPrice: number | null
  prevGoldPrice: number | null
  ppfTransactions: PPFTransaction[]
  ppfOverride: PPFBalanceOverride | null
  epfTransactions: EPFTransaction[]
  /** Master rows by symbol (#153). `stockTxns` amounts are INR at the trade-date rate; prices are in the instrument's currency. */
  instruments: Record<string, InstrumentInfo>
  /** Today's USD->INR rate; null until the first Prices tap (USD values then fall back to cost). */
  usdInr: UsdInrRate | null
}

/** What a section header shows. A figure that is zero comes through as null (the header draws nothing). */
export interface SectionHeaderData {
  invested: number | null
  gainPct: number | null
  currentValue: number | null
}

export interface PortfolioSummary {
  totalCurrent: number
  totalInvested: number
  totalGain: number
  totalGain1d: number
  /** Plain (non-annualised) 1D move; null when there is no prior-day total. */
  dayPct: number | null
  /** Overall XIRR as a fraction; null when it cannot be computed (or gold has no price yet). */
  xirr: number | null
  eqPct: number
  debtPct: number
  goldPct: number
}

export interface PortfolioData {
  summary: PortfolioSummary
  /** India vs US split of `summary.totalCurrent` (the region sheet behind the pie). */
  region: RegionExposure
  stocks: SectionHeaderData & { rows: HoldingRowData[] }
  /** `eqPct` = equity's share of MF value, for the Equity / Debt pills. */
  mf: SectionHeaderData & { rows: HoldingRowData[]; eqPct: number }
  /** Gold's first header figure is grams held, not an amount. */
  gold: { grams: number | null; gainPct: number | null; currentValue: number | null; rows: HoldingRowData[] }
  ppf: SectionHeaderData
  epf: SectionHeaderData
}

// ── Per-asset helpers ─────────────────────────────────────────────────────────

interface StockHolding {
  symbol: string
  qty: number
  invested: number
  /** INR. */
  currentValue: number | null
  gain: number | null
  xirr: number | null
  gain1d: number | null
  gain1dPct: number | null
  instrument: InstrumentInfo
  /** Latest price in the instrument's own currency. */
  cmp: number | null
}

function computeStockHoldings(
  transactions: StockTxn[],
  bandCmps: Record<string, number>,
  stockPrices: Record<string, StockPriceInfo>,
  instruments: Record<string, InstrumentInfo>,
  usdInr: UsdInrRate | null,
): StockHolding[] {
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
      const instrument = instruments[symbol] ?? INR_INSTRUMENT
      // INR per unit of the quote currency: 1 for INR; the USD->INR pair for USD. A foreign
      // instrument with no rate yet has no INR value (falls back to cost in the totals).
      const inr = instrument.currency === 'INR' ? { rate: 1, prevRate: 1 } : instrument.currency === 'USD' ? usdInr : null
      const currentValue = cmp && inr ? qty * cmp * inr.rate : null
      const gain = currentValue !== null ? currentValue - cost : null
      const xirrVal = currentValue !== null ? stockXirr(txns, currentValue) : null
      const prev = stockPrices[symbol]?.prevClose ?? null
      // The day change is in INR, so a USD holding includes the overnight FX move; with no prior rate, hold the rate flat.
      const gain1d = cmp && prev && inr ? currentValue! - qty * prev * (inr.prevRate ?? inr.rate) : null
      const prevValue = cmp && prev && inr ? qty * prev * (inr.prevRate ?? inr.rate) : null
      const gain1dPct = gain1d !== null && prevValue ? gain1d / prevValue * 100 : null
      return [{ symbol, qty, invested: cost, currentValue, gain, xirr: xirrVal, gain1d, gain1dPct, instrument, cmp }]
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

function computeMFHoldings(
  funds: MFund[],
  transactions: MFTransaction[],
  navs: Record<string, MFNavRow>,
): MFHolding[] {
  const byFund: Record<string, MFTransaction[]> = {}
  for (const t of transactions) {
    ;(byFund[t.fund_id] ??= []).push(t)
  }
  return funds
    .flatMap(fund => {
      const txns = byFund[fund.id] ?? []
      if (txns.length === 0) return []
      const nav = navs[fund.scheme_code]
      const holding = computeMFHolding(fund, txns, nav?.nav ?? null, nav?.prevNav ?? null)
      return holding ? [holding] : []
    })
    .sort((a, b) => a.fund.scheme_name.localeCompare(b.fund.scheme_name))
}

/** Percent gain over deposits, or null when nothing has been deposited. */
function gainOverInvested(current: number, invested: number): number | null {
  return invested > 0 ? (current - invested) / invested * 100 : null
}

// ── The whole screen ──────────────────────────────────────────────────────────

export function buildPortfolio(input: PortfolioInput): PortfolioData {
  const {
    stockTxns, bandCmps, stockPrices, mfFunds, mfTransactions, mfNavs,
    sgbTransactions, goldPrice, prevGoldPrice, ppfTransactions, ppfOverride, epfTransactions,
    instruments, usdInr,
  } = input

  const stockHoldings = computeStockHoldings(stockTxns, bandCmps, stockPrices, instruments, usdInr)
  const mfHoldings = computeMFHoldings(mfFunds, mfTransactions, mfNavs)
  const sgbBatches = computeSGBBatches(sgbTransactions, goldPrice)

  // Stocks — no-CMP positions fall back to cost (gain 0) in the totals.
  // Every instrument is one list, in INR (#153). The region split below cuts it by the master's region.
  const stocksInvested = stockHoldings.reduce((s, h) => s + h.invested, 0)
  const stocksCurrent = stockHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const stocksGain1d = stockHoldings.reduce((s, h) => s + (h.gain1d ?? 0), 0)
  const indiaStockHoldings = stockHoldings.filter(h => h.instrument.region === 'india')
  const foreignHoldings = stockHoldings.filter(h => h.instrument.region !== 'india')
  const indiaStockTxns = stockTxns.filter(t => indiaStockHoldings.some(h => h.symbol === t.symbol))

  // MF
  const mfInvested = mfHoldings.reduce((s, h) => s + h.invested, 0)
  const mfCurrentValue = mfHoldings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfGain1d = mfHoldings.reduce((s, h) => s + (h.gain1d ?? 0), 0)
  const mfEquity = mfHoldings.filter(h => mfAssetClass(h.fund) === 'equity').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfDebt = mfHoldings.filter(h => mfAssetClass(h.fund) === 'debt').reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const mfSectionXirr = mfCurrentValue === 0 || mfTransactions.length === 0 ? null : mfXirr(mfTransactions, mfCurrentValue)

  // Gold
  const sgbInvested = sgbBatches.reduce((s, b) => s + b.invested, 0)
  const sgbCurrentValue = sgbBatches.reduce((s, b) => s + (b.currentValue ?? b.invested), 0)
  const totalGoldGrams = sgbBatches.reduce((s, b) => s + b.grams, 0)
  const goldSectionXirr = goldPrice === null || sgbCurrentValue === 0 || sgbTransactions.length === 0
    ? null : sgbXirr(sgbTransactions, sgbCurrentValue)
  // Portfolio-level only — no per-batch line item (gold rows don't get a 1D figure, unlike Stock/MF).
  const goldGain1d = goldPrice !== null && prevGoldPrice !== null ? totalGoldGrams * (goldPrice - prevGoldPrice) : null

  // PPF / EPF
  const ppfDeposited = ppfTransactions.filter(t => t.trade_type === 'deposit').reduce((s, t) => s + t.amount, 0)
  const ppfBalance = ppfOverride?.balance ?? computePPFBalance(ppfTransactions)
  const epfDeposited = epfTransactions.filter(t => t.trade_type === 'deposit').reduce((s, t) => s + t.amount, 0)
  const epfBalance = computeEPFBalance(epfTransactions)
  const epfXirrVal = epfXirr(epfTransactions, epfBalance)

  // Totals
  const totalInvested = stocksInvested + mfInvested + sgbInvested + ppfDeposited + epfDeposited
  const totalCurrent = stocksCurrent + mfCurrentValue + sgbCurrentValue + ppfBalance + epfBalance
  const totalGain = totalCurrent - totalInvested

  // Overall XIRR (INR flows throughout — every trade's `amount` is INR at its trade-date rate): wait for the gold price before computing so the terminal value is accurate.
  // stockTxns is the same open-position list computeStockHoldings uses, so the stock cashflows
  // and totalCurrent cover the same stocks (exited positions are in neither).
  const xirr = sgbTransactions.length > 0 && goldPrice === null
    ? null
    : portfolioXirr(stockTxns, mfTransactions, sgbTransactions, ppfTransactions, epfTransactions, totalCurrent)

  // 1D Gain rolls in Stocks (incl. USD holdings) + MF + Gold — PPF/EPF excluded (no daily price). 1D % is
  // the plain (non-annualised) move: totalCurrent − totalGain1d is "yesterday", so
  // static PPF/EPF sit in the denominator with zero movement and dilute it, as they should.
  const totalGain1d = stocksGain1d + mfGain1d + (goldGain1d ?? 0)
  const prevTotal = totalCurrent - totalGain1d
  const dayPct = prevTotal > 0 ? totalGain1d / prevTotal * 100 : null

  // Asset allocation for the donut
  const totalForAlloc = stocksCurrent + mfEquity + mfDebt + sgbCurrentValue + ppfBalance + epfBalance
  const eqPct = totalForAlloc > 0 ? Math.round((stocksCurrent + mfEquity) / totalForAlloc * 100) : 0
  const debtPct = totalForAlloc > 0 ? Math.round((mfDebt + ppfBalance + epfBalance) / totalForAlloc * 100) : 0
  const goldPct = 100 - eqPct - debtPct

  // A holding whose saved price is older than the rest's shows its own date in place of "1D"
  // (a fund whose NAV publishes a day late; a stock whose price failed on the last tap).
  const stockDays: Record<string, string> = {}
  for (const h of stockHoldings) {
    const info = stockPrices[h.symbol]
    const day = info ? istDay(info.fetchedAt) : null
    if (day) stockDays[h.symbol] = day
  }
  const stockLag = laggingDates(stockDays)
  const mfDays: Record<string, string> = {}
  for (const h of mfHoldings) {
    const day = mfNavs[h.fund.scheme_code]?.navDate
    if (day) mfDays[h.fund.scheme_code] = day
  }
  const mfLag = laggingDates(mfDays)

  const stockRows: HoldingRowData[] = stockHoldings.map(h => {
    const r = returnMetric(h.xirr, h.gain, h.invested)
    const foreign = h.instrument.currency !== 'INR'
    return {
      key: h.symbol, name: foreign ? h.instrument.name || h.symbol : h.symbol,
      href: `/portfolio/stock/${encodeURIComponent(h.symbol)}`,
      value: h.currentValue, pnl: h.gain, retPct: r.pct, retLabel: r.label,
      dayPct: h.gain1dPct, day: { amount: h.gain1d, pct: h.gain1dPct },
      ...(foreign && {
        native: `${h.cmp !== null ? `${formatUsd(h.cmp)} · ` : ''}${trimZero(h.qty, 3)} units`,
      }),
      staleDate: stockLag[h.symbol] ? shortDate(stockLag[h.symbol]) : undefined,
    }
  })
  const mfRows: HoldingRowData[] = mfHoldings.map(h => {
    const r = returnMetric(h.xirr, h.gain, h.invested)
    return {
      key: h.fund.id, name: h.fund.scheme_name, href: `/portfolio/mf/${h.fund.id}`,
      value: h.currentValue, pnl: h.gain, retPct: r.pct, retLabel: r.label,
      dayPct: h.gain1dPct, day: { amount: h.gain1d, pct: h.gain1dPct },
      assetClass: mfAssetClass(h.fund),
      staleDate: mfLag[h.fund.scheme_code] ? shortDate(mfLag[h.fund.scheme_code]) : undefined,
    }
  })
  // Gold rows have no 1D figure (`meta` fills that slot) and keep their batch order — no sort control.
  const goldRows: HoldingRowData[] = sgbBatches.map(b => {
    const r = returnMetric(b.xirr, b.gain, b.invested)
    return {
      key: b.key, name: goldDisplayName(b), href: `/portfolio/gold/${encodeURIComponent(b.key)}`,
      value: b.currentValue, pnl: b.gain, retPct: r.pct, retLabel: r.label,
      dayPct: null, meta: goldMeta(b),
    }
  })

  return {
    summary: { totalCurrent, totalInvested, totalGain, totalGain1d, dayPct, xirr, eqPct, debtPct, goldPct },
    region: computeRegionExposure(
      mfHoldings, totalCurrent,
      { value: indiaStockHoldings.reduce((v, h) => v + (h.currentValue ?? h.invested), 0), txns: indiaStockTxns },
      foreignHoldings.map((h): DirectHoldingInput => ({
        holding: { symbol: h.symbol, name: h.instrument.name, region: h.instrument.region },
        transactions: stockTxns.filter(t => t.symbol === h.symbol),
        currentValue: h.currentValue, invested: h.invested,
      })),
    ),
    stocks: {
      invested: stocksInvested > 0 ? stocksInvested : null,
      gainPct: gainOverInvested(stocksCurrent, stocksInvested),
      currentValue: stocksCurrent > 0 ? stocksCurrent : null,
      rows: stockRows,
    },
    mf: {
      invested: mfInvested > 0 ? mfInvested : null,
      gainPct: mfSectionXirr !== null ? mfSectionXirr * 100 : null,
      currentValue: mfCurrentValue > 0 ? mfCurrentValue : null,
      rows: mfRows,
      eqPct: mfCurrentValue > 0 ? Math.round(mfEquity / mfCurrentValue * 100) : 0,
    },
    gold: {
      grams: totalGoldGrams > 0 ? totalGoldGrams : null,
      gainPct: goldSectionXirr !== null ? goldSectionXirr * 100 : null,
      currentValue: sgbCurrentValue > 0 ? sgbCurrentValue : null,
      rows: goldRows,
    },
    ppf: {
      invested: ppfDeposited > 0 ? ppfDeposited : null,
      gainPct: gainOverInvested(ppfBalance, ppfDeposited),
      currentValue: ppfBalance > 0 ? ppfBalance : null,
    },
    epf: {
      invested: epfDeposited > 0 ? epfDeposited : null,
      gainPct: epfXirrVal !== null ? epfXirrVal * 100 : null,
      currentValue: epfBalance > 0 ? epfBalance : null,
    },
  }
}
