// US holding math (progress log #131.b): one position per direct USD stock / ETF, in INR.
// Cost is fixed at each trade's USD->INR rate (`amount_inr`); value uses today's price and
// today's rate, so XIRR and gain are on INR cash flows and currency movement counts.
import { seqCost } from './compute'
import { stockXirr } from './xirr'
import { HELD_QTY_EPSILON } from './stock-prices'
import type { UsHolding, UsTransaction } from './portfolio-types'

export interface UsPosition {
  holding: UsHolding
  transactions: UsTransaction[]
  quantity: number
  /** INR cost of the open quantity (average-cost basis, like stocks). */
  invested: number
  /** Latest USD price, or null when never fetched. */
  priceUsd: number | null
  /** Value in INR at today's price and rate; null without a price or a rate. */
  currentValue: number | null
  /** Total INR gain (price + currency together); null when value is null. */
  gain: number | null
  xirr: number | null
  gain1d: number | null
  gain1dPct: number | null
}

export interface UsQuote {
  price: number
  prevClose: number | null
}

export interface UsRate {
  rate: number
  prevRate: number | null
}

/**
 * Position for one holding, or null when nothing is held. Without a price or a rate the
 * value fields are null (callers fall back to `invested`, as for MFs without a NAV).
 */
export function computeUsPosition(
  holding: UsHolding,
  transactions: UsTransaction[],
  quote: UsQuote | null,
  fx: UsRate | null,
): UsPosition | null {
  const { qty, cost } = seqCost(transactions.map(t => ({
    trade_date: t.trade_date, trade_type: t.trade_type, quantity: t.quantity, amount: t.amount_inr,
  })))
  if (qty <= HELD_QTY_EPSILON) return null

  const priceUsd = quote?.price ?? null
  const currentValue = priceUsd !== null && fx ? qty * priceUsd * fx.rate : null
  const gain = currentValue !== null ? currentValue - cost : null

  // Day change is in INR, so it includes the overnight FX move; with no prior rate, hold the rate flat.
  const prevValue = quote?.prevClose != null && fx ? qty * quote.prevClose * (fx.prevRate ?? fx.rate) : null
  const gain1d = currentValue !== null && prevValue !== null ? currentValue - prevValue : null
  const gain1dPct = gain1d !== null && prevValue ? (gain1d / prevValue) * 100 : null

  return {
    holding, transactions, quantity: qty, invested: cost,
    priceUsd, currentValue, gain,
    xirr: currentValue !== null
      ? stockXirr(transactions.map(t => ({ trade_date: t.trade_date, trade_type: t.trade_type, amount: t.amount_inr })), currentValue)
      : null,
    gain1d, gain1dPct,
  }
}

/** Positions for every held holding (holdings with nothing held are dropped), largest value first. */
export function computeUsPositions(
  holdings: UsHolding[],
  transactions: UsTransaction[],
  quotes: Record<string, UsQuote>,   // keyed by yahoo_symbol
  fx: UsRate | null,
): UsPosition[] {
  const byHolding = new Map<string, UsTransaction[]>()
  for (const t of transactions) {
    const list = byHolding.get(t.holding_id)
    if (list) list.push(t)
    else byHolding.set(t.holding_id, [t])
  }
  return holdings
    .map(h => computeUsPosition(h, byHolding.get(h.id) ?? [], quotes[h.yahoo_symbol] ?? null, fx))
    .filter((p): p is UsPosition => p !== null)
    .sort((a, b) => (b.currentValue ?? b.invested) - (a.currentValue ?? a.invested))
}
