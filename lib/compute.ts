import type { StockAllocation, Transaction, BuyBand, StockRow, FiscalYear } from './types'
import { getBandSignal } from './band-calculator'

/**
 * Given a previous FY's allocations + transactions, return a map of
 * symbol → remaining budget (negative = over-allocated debt, positive = credit).
 * Pass this as the auto-carryover for the next FY.
 */
export function buildAutoCarryover(
  prevAllocations: StockAllocation[],
  prevTransactions: Transaction[],
  prevTotalBudget: number,
  prevFyId: string,
): Map<string, number> {
  const rows = computeStockRows(prevAllocations, prevTransactions, [], prevTotalBudget, prevFyId)
  return new Map(rows.map(r => [r.symbol, r.remaining]))
}

/**
 * For a single stock present across multiple FYs, compute the effective
 * carryover for each FY by chaining: each FY's remaining becomes the next
 * FY's carryover (overriding the DB carryover_inr field).
 *
 * Returns a Map of fyId → carryover_inr to apply for that FY.
 * Falls back to DB carryover_inr for the first FY the stock appears in.
 *
 * @param symbolAllocations - all FY allocations for this symbol, in any order
 * @param allSymbolTransactions - all transactions for this symbol across all FYs
 * @param fiscalYears - all FYs sorted by start_date ascending
 */
export function computeSymbolCarryoverChain(
  symbolAllocations: StockAllocation[],
  allSymbolTransactions: Transaction[],
  fiscalYears: FiscalYear[],
): Map<string, number> {
  const result = new Map<string, number>()
  let prevRemaining: number | null = null

  for (const fy of fiscalYears) {
    const alloc = symbolAllocations.find(a => a.fy_id === fy.id)
    if (!alloc) {
      prevRemaining = null // chain resets when stock not present in a FY
      continue
    }

    const carryover = prevRemaining ?? (alloc.carryover_inr ?? 0)
    result.set(fy.id, carryover)

    const totalBudget = fy.total_budget_inr + (fy.unallocated_carryover_inr ?? 0)
    const budget = (alloc.allocation_pct / 100) * totalBudget + carryover

    // Same filtering logic as computeStockRows: exclude advance buys for other FYs
    const spent = allSymbolTransactions
      .filter(t => t.advance_fy_id == null ? t.fy_id === fy.id : t.advance_fy_id === fy.id)
      .reduce((s, t) => s + (t.trade_type === 'buy' ? t.amount : -t.amount), 0)

    prevRemaining = budget - spent
  }

  return result
}

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
    const totalSellValue = sells.reduce((s, t) => s + t.amount,   0)

    const qty     = Math.max(0, totalBought - totalSold)
    const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
    const spent   = totalBuyValue - totalSellValue

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
