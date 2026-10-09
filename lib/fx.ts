// Pure FX helpers for USD->INR (progress log #131.a). No server imports.

export interface FxRate {
  rate_date: string   // YYYY-MM-DD
  rate: number        // INR per 1 USD
}

/** Reserved stock_prices key for today's USD->INR rate; the underscore can't collide with a ticker. */
export const USDINR_PRICE_KEY = '_USDINR'

/**
 * The rate in force on `date`: the rate for that day, else the previous trading day's
 * (weekends / holidays have no row). Null when `date` precedes all known rates.
 */
export function rateOnOrBefore(rates: FxRate[], date: string): number | null {
  let best: FxRate | null = null
  for (const r of rates) {
    if (r.rate_date <= date && (!best || r.rate_date > best.rate_date)) best = r
  }
  return best ? best.rate : null
}

/** Daily closes from a Yahoo v8 chart response (`USDINR=X`, interval=1d), skipping null days. */
export function parseYahooFxHistory(json: unknown): FxRate[] {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined
  const stamps = result?.timestamp ?? []
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const byDate = new Map<string, number>()
  stamps.forEach((ts, i) => {
    const close = closes[i]
    if (close == null || !(close > 0)) return
    byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), close)
  })
  return [...byDate].map(([rate_date, rate]) => ({ rate_date, rate })).sort((a, b) => a.rate_date.localeCompare(b.rate_date))
}
