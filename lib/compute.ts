import type { StockAllocation, Transaction, BuyBand, StockRow, FiscalYear, StockCategory, BandSignal } from './types'
import { calculateBands } from './band-calculator'

export function getBandSignal(
  cmp: number | null,
  buyLow: number | null,
  buyHigh: number | null,
  midHigh: number | null,
  trimPrice: number | null,
): BandSignal {
  if (cmp === null || buyLow === null || trimPrice === null) return 'unknown'
  if (cmp < buyLow) return 'deep'
  if (cmp <= (buyHigh ?? trimPrice)) return 'buy'
  if (cmp <= (midHigh ?? trimPrice)) return 'hold'
  return 'trim'
}

// ── Sequential cost basis ─────────────────────────────────────────────────────

/**
 * Process transactions in date order using the sequential average-cost method.
 * Sells retire `soldQty × currentAvg` from the cost basis — a full exit resets
 * the basis to zero so a subsequent re-entry starts fresh.
 *
 * Returns the current qty held, total cost of those shares, and avg cost per share.
 */
export function seqCost(txns: Transaction[]): { qty: number; cost: number; avgCost: number } {
  const sorted = [...txns].sort((a, b) =>
    a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0)
  let qty = 0, cost = 0
  for (const t of sorted) {
    if (t.trade_type === 'buy') {
      qty  += t.quantity
      cost += t.amount
    } else {
      const avg = qty > 0 ? cost / qty : 0
      cost = Math.max(0, cost - t.quantity * avg)
      qty  = Math.max(0, qty  - t.quantity)
    }
  }
  return { qty, cost, avgCost: qty > 0 ? cost / qty : 0 }
}

// ── Carryover ─────────────────────────────────────────────────────────────────

export interface CarryoverBreakdown {
  /** Direct remaining from prev FY for stocks present in both FYs */
  direct: Map<string, number>
  /** Sum of remaining for stocks that exited (not present in next FY) */
  poolTotal: number
  /** Each next-FY stock's proportional share of the orphan pool */
  poolShares: Map<string, number>
  /** Stocks from prev FY not present in next FY, with their remaining */
  orphans: Array<{ symbol: string; remaining: number }>
}

export interface CarryoverResult {
  /** Total adjustment per symbol = direct + pool share */
  adjustments: Map<string, number>
  breakdown: CarryoverBreakdown
}

/**
 * Compute carryover adjustments from a previous FY into the next FY.
 *
 * Rules:
 * 1. Stock present in both FYs → its remaining budget carries over directly.
 * 2. Stock not present in next FY → its remaining goes into an orphan pool,
 *    distributed proportionally (by allocation_pct) among all next-FY stocks.
 * 3. Both may apply to the same stock — they are summed.
 */
export function computeCarryover(
  prevAllocations: StockAllocation[],
  prevTransactions: Transaction[],
  prevTotalBudget: number,
  prevFyId: string,
  nextAllocations: StockAllocation[],
): CarryoverResult {
  const prevRows = computeStockRows(prevAllocations, prevTransactions, [], prevTotalBudget, prevFyId)
  const nextSymbols = new Set(nextAllocations.map(a => a.symbol))

  const direct = new Map<string, number>()
  const orphans: Array<{ symbol: string; remaining: number }> = []
  let poolTotal = 0

  for (const row of prevRows) {
    if (nextSymbols.has(row.symbol)) {
      direct.set(row.symbol, row.remaining)
    } else {
      orphans.push({ symbol: row.symbol, remaining: row.remaining })
      poolTotal += row.remaining
    }
  }

  // Distribute pool proportionally by allocation_pct
  const totalPct = nextAllocations.reduce((s, a) => s + a.allocation_pct, 0)
  const poolShares = new Map<string, number>()
  const adjustments = new Map<string, number>()

  for (const alloc of nextAllocations) {
    const share = totalPct > 0 ? (alloc.allocation_pct / totalPct) * poolTotal : 0
    poolShares.set(alloc.symbol, share)
    adjustments.set(alloc.symbol, (direct.get(alloc.symbol) ?? 0) + share)
  }

  return { adjustments, breakdown: { direct, poolTotal, poolShares, orphans } }
}

// ── Stock rows ────────────────────────────────────────────────────────────────

export function computeStockRows(
  allocations: StockAllocation[],
  transactions: Transaction[],
  bands: BuyBand[],
  totalBudget: number,
  fyId?: string,
  carryoverMap?: Map<string, number>,
  allTransactions?: Transaction[],
): StockRow[] {
  return allocations.map(alloc => {
    // FY-filtered transactions — used for spent/remaining/carryover (planning)
    const txns  = transactions.filter(t =>
      t.symbol === alloc.symbol &&
      (fyId == null || t.advance_fy_id == null || t.advance_fy_id === fyId)
    )
    const buys  = txns.filter(t => t.trade_type === 'buy')
    const sells = txns.filter(t => t.trade_type === 'sell')

    const totalBought    = buys.reduce((s, t)  => s + t.quantity, 0)
    const totalBuyValue  = buys.reduce((s, t)  => s + t.amount,   0)
    const totalSold      = sells.reduce((s, t) => s + t.quantity,  0)
    const totalSellValue = sells.reduce((s, t) => s + t.amount,    0)

    const qty     = Math.max(0, totalBought - totalSold)
    const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
    const spent   = Math.max(0, totalBuyValue - totalSellValue)

    const carryover = carryoverMap?.get(alloc.symbol) ?? 0
    const budget    = (alloc.allocation_pct / 100) * totalBudget + carryover
    const remaining = budget - spent

    // FY position at cost — sequential average-cost on FY-filtered txns.
    // Same scope as budget/remaining: only this FY's transactions.
    const { cost: currentCost } = seqCost(txns)

    // All-time holdings — qty, avgCost, unrealisedPnL only.
    // Uses allTransactions so prior-FY holdings aren't lost when
    // a stock has no transactions in the current FY.
    const allTxns = (allTransactions ?? transactions)
      .filter(t => t.symbol === alloc.symbol)
    const { qty: allTimeQty, avgCost: allTimeAvg } = seqCost(allTxns)

    const band   = bands.find(b => b.symbol === alloc.symbol) ?? null
    const cmp    = band?.manual_cmp ?? null
    const fresh  = band ? calculateBands({
      category:          alloc.category as StockCategory,
      twoWeakQuarters:   alloc.two_weak_quarters,
      twoStrongQuarters: alloc.two_strong_quarters,
      eps: band.eps,
    }) : null
    const _buyLow   = fresh?.buyLow   ?? band?.buy_low   ?? null
    const _buyHigh  = fresh?.buyHigh  ?? band?.buy_high  ?? null
    const _midHigh  = fresh?.midHigh  ?? band?.mid_high  ?? null
    const _trim     = fresh?.trimPrice ?? band?.trim_price ?? null
    const signal = getBandSignal(cmp, _buyLow, _buyHigh, _midHigh, _trim)

    const unrealisedPnL    = cmp !== null ? (cmp - allTimeAvg) * allTimeQty : null
    const unrealisedPnLPct = (cmp !== null && allTimeAvg > 0)
      ? (cmp - allTimeAvg) / allTimeAvg * 100 : null

    return {
      symbol:          alloc.symbol,
      allocationPct:   alloc.allocation_pct,
      budget,
      spent,
      remaining,
      pctRemaining:    budget > 0 ? (remaining / budget) * 100 : 100,
      qty:             allTimeQty,
      avgCost:         allTimeAvg,
      currentCost,
      cmp,
      unrealisedPnL,
      unrealisedPnLPct,
      bandSignal:      signal,
    }
  })
}
