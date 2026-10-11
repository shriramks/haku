// The INR-per-unit rate stored on a trade (`transactions.fx_rate`, progress log #153). `amount` is
// quantity x price x fx_rate, so a trade's INR cost is fixed at its trade-date rate.
import type { Stock } from './stock-master'

/**
 * The rate to store for a trade in `stock`: always 1 for an INR (or unknown, i.e. NSE-by-default)
 * instrument, regardless of what the caller sent; the supplied trade-date rate for a foreign one.
 * Null when a foreign trade has no usable rate — the caller rejects it.
 */
export function tradeFxRate(stock: Pick<Stock, 'currency'> | undefined, requested: number | undefined): number | null {
  if (!stock || stock.currency === 'INR') return 1
  return typeof requested === 'number' && Number.isFinite(requested) && requested > 0 ? requested : null
}

/**
 * Keeps the trades of INR instruments only. Tax rules and NSE dividend lookups are INR-only until the
 * foreign-listed bucket (#161): they read `price` as cost per unit and fetch NSE data by symbol, which a
 * USD trade would corrupt. A symbol with no master row counts as INR, the same default as `tradeFxRate`.
 */
export function inrTransactions<T extends { symbol: string }>(
  txns: T[],
  stocks: Record<string, Pick<Stock, 'currency'>>,
): T[] {
  return txns.filter(t => (stocks[t.symbol]?.currency ?? 'INR') === 'INR')
}

/**
 * INR per one unit of each instrument's quote currency, for converting a native price to INR.
 * INR instruments are omitted (rate 1); a foreign one maps to its rate, or null when none is known
 * (non-USD currency, or no USD->INR saved yet) so the caller shows no figure instead of a wrong one.
 */
export function inrPerUnit(
  stocks: Record<string, Pick<Stock, 'currency'>>,
  usdInr: number | null,
): Record<string, number | null> {
  const rates: Record<string, number | null> = {}
  for (const [symbol, stock] of Object.entries(stocks)) {
    if (stock.currency === 'INR') continue
    rates[symbol] = stock.currency === 'USD' && usdInr !== null && usdInr > 0 ? usdInr : null
  }
  return rates
}
