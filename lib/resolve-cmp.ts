// The one rule for a stock's display price. Standalone (no imports) so lib/compute.ts and
// lib/stock-prices.ts can both use it without an import cycle. Re-exported from stock-prices.

export interface StockPriceInfo {
  cmp: number
  prevClose: number | null
  fetchedAt: string   // ISO timestamp of the fetch that wrote this row
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
