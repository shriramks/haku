import type { MFund, MFTransaction, MFHolding } from './portfolio-types'
import { mfXirr } from './xirr'

type TxnSlice = Pick<MFTransaction, 'trade_type' | 'units' | 'nav'>

/** Single-fund holding math shared by the Portfolio list and the Fund Detail page. */
export function computeMFHolding(fund: MFund, transactions: MFTransaction[], currentNav: number | null, prevNav: number | null = null): MFHolding | null {
  const { units, invested } = computeMFLots(transactions)
  if (units < 0.001) return null
  const currentValue = currentNav !== null ? units * currentNav : null
  const gain         = currentValue !== null ? currentValue - invested : null
  const gain1d    = currentNav !== null && prevNav !== null ? units * (currentNav - prevNav) : null
  const gain1dPct = currentNav !== null && prevNav !== null ? (currentNav / prevNav - 1) * 100 : null
  return {
    fund, transactions, units, invested,
    currentNav, currentValue, gain,
    xirr: currentValue !== null ? mfXirr(transactions, currentValue) : null,
    gain1d, gain1dPct,
  }
}

export function computeMFLots(txns: TxnSlice[]): { units: number; invested: number } {
  const lots: { units: number; nav: number }[] = []
  for (const t of txns) {
    if (t.trade_type === 'buy') {
      lots.push({ units: t.units, nav: t.nav })
    } else {
      let toSell = t.units
      while (toSell > 0.0001 && lots.length > 0) {
        const lot = lots[0]
        if (lot.units <= toSell) { toSell -= lot.units; lots.shift() }
        else                     { lot.units -= toSell; toSell = 0  }
      }
    }
  }
  return {
    units:    lots.reduce((s, l) => s + l.units, 0),
    invested: lots.reduce((s, l) => s + l.units * l.nav, 0),
  }
}

// `mf_funds` holds every fund ever created (getMFFunds has no active-holding
// filter), including long-sold-out entries — some tagged with a garbage
// non-numeric scheme_code (a fund name, not an AMFI code) from old imports.
// Only funds with a live unit balance need a live NAV lookup.
export function filterActiveMfFunds(funds: MFund[], transactions: MFTransaction[]): MFund[] {
  const byFund: Record<string, MFTransaction[]> = {}
  for (const t of transactions) {
    ;(byFund[t.fund_id] ??= []).push(t)
  }
  return funds.filter(f => computeMFLots(byFund[f.id] ?? []).units >= 0.001)
}
