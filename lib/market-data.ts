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

export interface CmpQuoteBatch {
  prices: Record<string, number>
  week52: Record<string, { low: number | null; high: number | null }>
}

/** Fetches CMP + 52W low/high for multiple NSE symbols in one request.
 *  Tries Yahoo v7 batch first; falls back to parallel v8 chart calls if the
 *  batch returns empty results (Yahoo frequently blocks server-side batch
 *  requests while the per-symbol chart endpoint remains accessible). */
export async function fetchCmpBatch(symbols: string[]): Promise<CmpQuoteBatch> {
  // Attempt 1: Yahoo v7 batch endpoint
  try {
    const nsSuffixed = symbols.map(s => `${s}.NS`).join(',')
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${nsSuffixed}`
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } })
    if (res.ok) {
      const json = await res.json()
      const results: {
        symbol: string
        regularMarketPrice: number
        fiftyTwoWeekLow?: number
        fiftyTwoWeekHigh?: number
      }[] = json?.quoteResponse?.result ?? []
      if (results.length > 0) {
        const prices: Record<string, number> = {}
        const week52: Record<string, { low: number | null; high: number | null }> = {}
        for (const r of results) {
          const sym = r.symbol.replace(/\.NS$/, '')
          if (r.regularMarketPrice) prices[sym] = r.regularMarketPrice
          week52[sym] = { low: r.fiftyTwoWeekLow ?? null, high: r.fiftyTwoWeekHigh ?? null }
        }
        return { prices, week52 }
      }
    }
  } catch { /* fall through to per-symbol fallback */ }

  // Attempt 2: Parallel per-symbol v8 chart calls
  const quotes = await Promise.all(symbols.map(sym => fetchCmpQuote(sym).then(q => ({ sym, q }))))
  const prices: Record<string, number> = {}
  const week52: Record<string, { low: number | null; high: number | null }> = {}
  for (const { sym, q } of quotes) {
    if (q?.price) prices[sym] = q.price
    week52[sym] = { low: q?.week52Low ?? null, high: q?.week52High ?? null }
  }
  return { prices, week52 }
}
