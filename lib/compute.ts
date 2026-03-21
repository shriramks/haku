import type { StockAllocation, Transaction, BuyBand, StockRow } from './types'
import { getBandSignal } from './band-calculator'

export function computeStockRows(
  allocations: StockAllocation[],
  transactions: Transaction[],
  bands: BuyBand[],
  totalBudget: number,
  fyId?: string
): StockRow[] {
  return allocations.map(alloc => {
    // Exclude transactions earmarked for a different FY via advance_fy_id
    const txns  = transactions.filter(t =>
      t.symbol === alloc.symbol &&
      (fyId == null || t.advance_fy_id == null || t.advance_fy_id === fyId)
    )
    const buys  = txns.filter(t => t.trade_type === 'buy')
    const sells = txns.filter(t => t.trade_type === 'sell')

    const totalBought   = buys.reduce((s, t)  => s + t.quantity, 0)
    const totalBuyValue = buys.reduce((s, t)  => s + t.amount,   0)
    const totalSold     = sells.reduce((s, t) => s + t.quantity,  0)

    const qty     = Math.max(0, totalBought - totalSold)
    const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
    const spent   = buys.reduce((s, t) => s + t.amount, 0)

    const budget    = (alloc.allocation_pct / 100) * totalBudget + (alloc.carryover_inr ?? 0)
    const remaining = budget - spent

    const band   = bands.find(b => b.symbol === alloc.symbol) ?? null
    const cmp    = band?.manual_cmp ?? null
    const signal = band ? getBandSignal(band) : 'unknown'

    const unrealisedPnL    = cmp !== null ? (cmp - avgCost) * qty : null
    const unrealisedPnLPct = (cmp !== null && avgCost > 0)
      ? (cmp - avgCost) / avgCost * 100 : null

    return {
      symbol:          alloc.symbol,
      allocationPct:   alloc.allocation_pct,
      budget,
      spent,
      remaining,
      pctRemaining:    budget > 0 ? (remaining / budget) * 100 : 100,
      qty,
      avgCost,
      cmp,
      unrealisedPnL,
      unrealisedPnLPct,
      bandSignal:      signal,
    }
  })
}
