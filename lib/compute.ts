import type { StockAllocation, Transaction, BuyBand, StockRow, FiscalYear } from './types'

// ── Sequential cost basis ─────────────────────────────────────────────────────

/**
 * Process transactions in date order using the sequential average-cost method.
 * Sells retire `soldQty × currentAvg` from the cost basis — a full exit resets
 * the basis to zero so a subsequent re-entry starts fresh.
 *
 * Returns the current qty held, total cost of those shares, and avg cost per share.
 */
export function seqCost(txns: Transaction[]): {
  qty: number; cost: number; avgCost: number
  /** Weighted average of BUY transactions only — unaffected by sells.
   *  Use this for display ("Avg Cost") so a past sell doesn't distort
   *  the per-share price you paid. */
  buyAvgCost: number
} {
  const sorted = [...txns].sort((a, b) =>
    a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0)
  let qty = 0, cost = 0
  let buyQty = 0, buyCost = 0
  for (const t of sorted) {
    if (t.trade_type === 'buy') {
      qty     += t.quantity
      cost    += t.amount
      buyQty  += t.quantity
      buyCost += t.amount
    } else {
      const avg = qty > 0 ? cost / qty : 0
      cost = Math.max(0, cost - t.quantity * avg)
      qty  = Math.max(0, qty  - t.quantity)
    }
  }
  return {
    qty,
    cost,
    avgCost:    qty    > 0 ? cost    / qty    : 0,
    buyAvgCost: buyQty > 0 ? buyCost / buyQty : 0,
  }
}

// ── Stock rows ────────────────────────────────────────────────────────────────

export interface AllTimeHolding { qty: number; avgCost: number }

/**
 * Per-symbol all-time {qty, avgCost} via seqCost — computed server-side so the
 * full transaction history never ships to the client just for these aggregates.
 */
export function computeAllTimeHoldings(transactions: Transaction[]): Record<string, AllTimeHolding> {
  const bySymbol = new Map<string, Transaction[]>()
  for (const t of transactions) {
    const list = bySymbol.get(t.symbol)
    if (list) list.push(t)
    else bySymbol.set(t.symbol, [t])
  }
  const holdings: Record<string, AllTimeHolding> = {}
  for (const [symbol, txns] of bySymbol) {
    const { qty, avgCost } = seqCost(txns)
    holdings[symbol] = { qty, avgCost }
  }
  return holdings
}

export function computeStockRows(
  allocations: StockAllocation[],
  transactions: Transaction[],
  bands: BuyBand[],
  totalBudget: number,
  allTimeHoldings?: Record<string, AllTimeHolding>,
): StockRow[] {
  return allocations.map(alloc => {
    const txns  = transactions.filter(t => t.symbol === alloc.symbol)
    const buys  = txns.filter(t => t.trade_type === 'buy')
    const sells = txns.filter(t => t.trade_type === 'sell')

    const totalBought    = buys.reduce((s, t)  => s + t.quantity, 0)
    const totalBuyValue  = buys.reduce((s, t)  => s + t.amount,   0)
    const totalSold      = sells.reduce((s, t) => s + t.quantity,  0)
    const totalSellValue = sells.reduce((s, t) => s + t.amount,    0)

    const qty     = Math.max(0, totalBought - totalSold)
    const avgCost = totalBought > 0 ? totalBuyValue / totalBought : 0
    const spent   = Math.max(0, totalBuyValue - totalSellValue)

    const budget    = (alloc.allocation_pct / 100) * totalBudget
    const remaining = budget - spent

    // FY position at cost — sequential average-cost on FY-filtered txns.
    // Same scope as budget/remaining: only this FY's transactions.
    const { cost: currentCost } = seqCost(txns)

    // All-time holdings — qty, avgCost, unrealisedPnL only.
    // Uses the all-time map so prior-FY holdings aren't lost when
    // a stock has no transactions in the current FY.
    const { qty: allTimeQty, avgCost: allTimeAvg } = allTimeHoldings
      ? (allTimeHoldings[alloc.symbol] ?? { qty: 0, avgCost: 0 })
      : seqCost(txns)

    const band = bands.find(b => b.symbol === alloc.symbol) ?? null
    const cmp  = band?.manual_cmp ?? null

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
    }
  })
}
