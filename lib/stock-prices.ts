// Pure helpers for the saved-prices flow (stock_prices table) — no server imports,
// so PortfolioClient can share resolveCmp with the server-rendered detail page.
// See progress log #120.a and docs/architecture.md "Price Fetch Flow".
import { seqCost } from './compute'
import type { Transaction } from './types'
import type { CmpQuoteBatch } from './market-data'

/** Net quantity above this counts as a held position — the Portfolio list and the refresh route share the cut-off. */
export const HELD_QTY_EPSILON = 0.001

export interface StockPriceInfo {
  cmp: number
  prevClose: number | null
  fetchedAt: string   // ISO timestamp of the fetch that wrote this row
}

type HeldTxn = Pick<Transaction, 'symbol' | 'trade_date' | 'trade_type' | 'quantity' | 'amount'>

/** Symbols with a live position (net qty > 0) across all of a user's stock transactions, sorted. */
export function heldSymbols(transactions: HeldTxn[]): string[] {
  const bySymbol = new Map<string, HeldTxn[]>()
  for (const t of transactions) {
    const list = bySymbol.get(t.symbol)
    if (list) list.push(t)
    else bySymbol.set(t.symbol, [t])
  }
  const held: string[] = []
  for (const [symbol, txns] of bySymbol) {
    if (seqCost(txns).qty > HELD_QTY_EPSILON) held.push(symbol)
  }
  return held.sort()
}

/**
 * The one place a stock's display price is decided: the saved price if there is one,
 * else the stored band snapshot (`buy_bands.cmp`), else null. Portfolio list and
 * stock detail both go through this so they can never disagree.
 */
export function resolveCmp(
  symbol: string,
  prices: Record<string, StockPriceInfo>,
  bandCmp: number | null | undefined,
): number | null {
  return prices[symbol]?.cmp ?? bandCmp ?? null
}

export interface PriceRow {
  symbol: string
  cmp: number
  prev_close: number | null
  fetched_at: string
}

export interface PriceUpdate {
  /** Rows to upsert — only symbols the fetch returned a price for. */
  rows: PriceRow[]
  /** Symbols whose price differs from the previously saved row (or that had none). */
  moved: string[]
  /** Requested symbols the fetch returned no price for; their saved row is left untouched. */
  failed: string[]
}

// stock_prices.cmp is numeric(x,4); compare at that precision so float noise isn't "movement".
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/**
 * Turns a fetched batch into upsert rows + a diff against what's already saved.
 * A symbol with no fetched price is reported as failed and gets no row, so a Yahoo
 * failure can never overwrite a good saved price.
 */
export function buildPriceUpdate(
  symbols: string[],
  batch: Pick<CmpQuoteBatch, 'prices' | 'prevClose'>,
  previous: Record<string, StockPriceInfo>,
  fetchedAt: string,
): PriceUpdate {
  const rows: PriceRow[] = []
  const moved: string[] = []
  const failed: string[] = []
  for (const symbol of symbols) {
    const cmp = batch.prices[symbol]
    if (!cmp) { failed.push(symbol); continue }
    rows.push({ symbol, cmp, prev_close: batch.prevClose[symbol] ?? null, fetched_at: fetchedAt })
    const before = previous[symbol]
    if (!before || round4(before.cmp) !== round4(cmp)) moved.push(symbol)
  }
  return { rows, moved, failed }
}
