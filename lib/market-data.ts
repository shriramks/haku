/**
 * Yahoo Finance helpers for fetching live prices of NSE-listed securities.
 * All symbols are expected without the .NS suffix; it is added internally.
 */

const YAHOO_UA = 'Mozilla/5.0'

export interface CmpQuote {
  price: number
  week52Low: number | null
  week52High: number | null
}

/** Fetches CMP + 52W low/high for a single NSE symbol. Returns null on any failure. */
export async function fetchCmpQuote(symbol: string): Promise<CmpQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS`
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null
    return {
      price:      meta.regularMarketPrice as number,
      week52Low:  (meta.fiftyTwoWeekLow  as number) ?? null,
      week52High: (meta.fiftyTwoWeekHigh as number) ?? null,
    }
  } catch {
    return null
  }
}

/** Fetches the current market price for a single NSE symbol. Returns null on any failure. */
export async function fetchCmp(symbol: string): Promise<number | null> {
  return (await fetchCmpQuote(symbol))?.price ?? null
}

/** Fetches prices for multiple NSE symbols in one request. Returns a map of symbol → price. */
export async function fetchCmpBatch(symbols: string[]): Promise<Record<string, number>> {
  const nsSuffixed = symbols.map(s => `${s}.NS`).join(',')
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${nsSuffixed}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA },
      next: { revalidate: 60 },
    })
    if (!res.ok) return {}
    const json = await res.json()
    const results: { symbol: string; regularMarketPrice: number }[] =
      json?.quoteResponse?.result ?? []
    const prices: Record<string, number> = {}
    for (const r of results) {
      const sym = r.symbol.replace(/\.NS$/, '')
      if (r.regularMarketPrice) prices[sym] = r.regularMarketPrice
    }
    return prices
  } catch {
    return {}
  }
}
