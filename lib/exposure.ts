// Region exposure: how much of the portfolio sits in India vs the US. Pure — called from
// lib/portfolio-compute.ts. Stocks, gold, PPF and EPF are India by definition; a mutual fund is
// US when its scheme name says so (same keyword-on-name approach as `mfAssetClass`).
import type { MFund } from './portfolio-types'

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
}

/**
 * `usValue` is the current value of US-region MFs (cost where a NAV is missing, as everywhere on
 * this screen); India is the rest of `totalCurrent`, so India + US always equals the pie's total.
 */
export function computeRegionExposure(
  mfHoldings: { fund: Pick<MFund, 'scheme_name'>; currentValue: number | null; invested: number }[],
  totalCurrent: number,
): RegionExposure {
  const usValue = mfHoldings
    .filter(h => mfRegion(h.fund) === 'us')
    .reduce((s, h) => s + (h.currentValue ?? h.invested), 0)
  const indiaValue = totalCurrent - usValue
  return {
    indiaValue,
    usValue,
    indiaPct: totalCurrent > 0 ? indiaValue / totalCurrent * 100 : 0,
    usPct: totalCurrent > 0 ? usValue / totalCurrent * 100 : 0,
  }
}
