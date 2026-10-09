// Region exposure: how much of the portfolio sits in India vs the US. Pure — called from
// lib/portfolio-compute.ts. Stocks, gold, PPF and EPF are India by definition; a mutual fund is
// US when its scheme name says so (same keyword-on-name approach as `mfAssetClass`).
import type { MFund, MFTransaction } from './portfolio-types'
import type { Transaction } from './types'
import { mfAssetClass } from './tax-compute'
import { mfXirr, stockXirr } from './xirr'

export type Region = 'india' | 'us'

// Whole-word "US" / "U.S." (so Focus, Plus, Bonus never match), "S&P" with its spellings
// (S&P, S & P, S&amp;P, S and P, SnP; the 500 may follow with no space), and "Nasdaq".
const US_NAME = /(?<![a-z0-9])u\.?s\.?(?![a-z0-9])|(?<![a-z])s\s*(?:&amp;|&|and|n)\s*p(?![a-z])|nasdaq/

export function mfRegion(fund: Pick<MFund, 'scheme_name'>): Region {
  return US_NAME.test(fund.scheme_name.toLowerCase()) ? 'us' : 'india'
}

export interface RegionExposure {
  indiaValue: number
  usValue: number
  /** Shares of total current value, 0–100. Both 0 when the portfolio is empty. */
  indiaPct: number
  usPct: number
  /** Equity only (stocks + equity-class MFs), cut into India stocks / India MFs / US MFs. */
  equity: EquityRegionGroup[]
  /** Every US-region MF (any asset class), largest first. Values sum to `usValue`. */
  usFunds: UsFundRow[]
}

export interface UsFundRow {
  fundId: string
  name: string
  value: number
  /** Share of total current value, 0–100. */
  pctOfTotal: number
  /** Fraction (0.12 = 12 %); null when the fund has no value or no transactions. */
  xirr: number | null
}

export interface EquityRegionGroup {
  key: 'india-stocks' | 'india-mfs' | 'us-mfs'
  label: string
  value: number
  /** Share of total equity value, 0–100. */
  pctOfEquity: number
  /** Fraction (0.12 = 12 %); null when the group has no value or no transactions. */
  xirr: number | null
}

type TxnFlow = Pick<Transaction, 'trade_date' | 'trade_type' | 'amount'>

/**
 * `usValue` is the current value of US-region MFs (cost where a NAV is missing, as everywhere on
 * this screen); India is the rest of `totalCurrent`, so India + US always equals the pie's total.
 */
export function computeRegionExposure(
  mfHoldings: {
    fund: Pick<MFund, 'id' | 'scheme_name' | 'scheme_type'>
    transactions: Pick<MFTransaction, 'trade_date' | 'trade_type' | 'amount'>[]
    currentValue: number | null
    invested: number
  }[],
  totalCurrent: number,
  stocks: { value: number; txns: TxnFlow[] } = { value: 0, txns: [] },
): RegionExposure {
  const usValue = mfHoldings
    .filter(h => mfRegion(h.fund) === 'us')
    .reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const indiaValue = totalCurrent - usValue

  // "Equity by region": equity-class MFs only, so a debt fund inferred US stays in the bar above
  // but not here. The three groups sum to the pie's equity value (stocks + equity MFs).
  const eqMfs = mfHoldings.filter(h => mfAssetClass(h.fund) === 'equity')
  const indiaMfs = eqMfs.filter(h => mfRegion(h.fund) === 'india')
  const usMfs = eqMfs.filter(h => mfRegion(h.fund) === 'us')
  const mfValue = (hs: typeof eqMfs) => hs.reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const groupXirr = (value: number, hs: typeof eqMfs) =>
    value > 0 && hs.some(h => h.transactions.length > 0) ? mfXirr(hs.flatMap(h => h.transactions), value) : null
  const indiaMfValue = mfValue(indiaMfs)
  const usMfValue = mfValue(usMfs)
  const equityTotal = stocks.value + indiaMfValue + usMfValue
  const pctOfEquity = (v: number) => (equityTotal > 0 ? v / equityTotal * 100 : 0)
  const equity: EquityRegionGroup[] = [
    { key: 'india-stocks', label: 'India stocks', value: stocks.value, pctOfEquity: pctOfEquity(stocks.value),
      xirr: stocks.value > 0 && stocks.txns.length > 0 ? stockXirr(stocks.txns, stocks.value) : null },
    { key: 'india-mfs', label: 'India MFs', value: indiaMfValue, pctOfEquity: pctOfEquity(indiaMfValue), xirr: groupXirr(indiaMfValue, indiaMfs) },
    { key: 'us-mfs', label: 'US MFs', value: usMfValue, pctOfEquity: pctOfEquity(usMfValue), xirr: groupXirr(usMfValue, usMfs) },
  ]

  const usFunds: UsFundRow[] = mfHoldings
    .filter(h => mfRegion(h.fund) === 'us')
    .map(h => {
      const value = h.currentValue ?? h.invested
      return {
        fundId: h.fund.id, name: h.fund.scheme_name, value,
        pctOfTotal: totalCurrent > 0 ? value / totalCurrent * 100 : 0,
        xirr: groupXirr(value, [h]),
      }
    })
    .sort((a, b) => b.value - a.value)

  return {
    indiaValue,
    usValue,
    indiaPct: totalCurrent > 0 ? indiaValue / totalCurrent * 100 : 0,
    usPct: totalCurrent > 0 ? usValue / totalCurrent * 100 : 0,
    equity,
    usFunds,
  }
}
