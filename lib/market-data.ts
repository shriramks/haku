/**
 * Yahoo Finance helpers for fetching live prices. Callers pass the full Yahoo symbol, suffix
 * included (the `stocks` master's `yahooSymbol`); nothing here assumes an exchange.
 */

import { parseYahooFxHistory, type FxRate } from './fx'

const YAHOO_UA = 'Mozilla/5.0'

export interface CmpQuote {
  price: number
  previousClose: number | null
  changePercent: number | null
  week52Low: number | null
  week52High: number | null
}

/** Fetches CMP + prev close + 52W low/high for a full Yahoo symbol (suffix included). Returns null on any failure. */
export async function fetchYahooQuote(yahooSymbol: string): Promise<CmpQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null
    return {
      price:         meta.regularMarketPrice as number,
      previousClose: (meta.previousClose as number) ?? null,
      changePercent: (meta.regularMarketChangePercent as number) ?? null,
      week52Low:     (meta.fiftyTwoWeekLow  as number) ?? null,
      week52High:    (meta.fiftyTwoWeekHigh as number) ?? null,
    }
  } catch {
    return null
  }
}

/** Fetches the current market price for a Yahoo symbol. Returns null on any failure. */
export async function fetchCmp(yahooSymbol: string): Promise<number | null> {
  return (await fetchYahooQuote(yahooSymbol))?.price ?? null
}

export interface YearChart {
  price: number | null
  week52Low: number | null   // min of daily lows over the past year
}

/** Fetches the 1-year daily chart for a Yahoo symbol: live CMP (from meta) +
 *  52-week low (from daily lows). Returns nulls on any failure. */
export async function fetchYearChart(yahooSymbol: string): Promise<YearChart> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1y&interval=1d`,
      { headers: { 'User-Agent': YAHOO_UA } }
    )
    if (!res.ok) return { price: null, week52Low: null }
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    const price: number | null = result?.meta?.regularMarketPrice ?? null
    const dailyLows: (number | null)[] = result?.indicators?.quote?.[0]?.low ?? []
    const validLows = dailyLows.filter((n): n is number => n != null && n > 0)
    return { price, week52Low: validLows.length > 0 ? Math.min(...validLows) : null }
  } catch {
    return { price: null, week52Low: null }
  }
}

export interface CmpQuoteBatch {
  prices: Record<string, number>
  prevClose: Record<string, number | null>
  changePercent: Record<string, number | null>
  week52: Record<string, { low: number | null; high: number | null }>
}

/** An instrument to price: `symbol` is the app's key (results are keyed by it), `yahooSymbol` is what Yahoo is asked for. */
export interface QuoteTarget {
  symbol: string
  yahooSymbol: string
}

/** Fetches CMP + prev close + 52W low/high for multiple instruments in one request.
 *  Tries Yahoo v7 batch first; falls back to parallel v8 chart calls if the
 *  batch returns empty results (Yahoo frequently blocks server-side batch
 *  requests while the per-symbol chart endpoint remains accessible). */
export async function fetchCmpBatch(targets: QuoteTarget[]): Promise<CmpQuoteBatch> {
  const symbolByYahoo = new Map(targets.map(t => [t.yahooSymbol, t.symbol]))
  // Attempt 1: Yahoo v7 batch endpoint
  try {
    const joined = targets.map(t => encodeURIComponent(t.yahooSymbol)).join(',')
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } })
    if (res.ok) {
      const json = await res.json()
      const results: {
        symbol: string
        regularMarketPrice: number
        regularMarketPreviousClose?: number
        regularMarketChangePercent?: number
        fiftyTwoWeekLow?: number
        fiftyTwoWeekHigh?: number
      }[] = json?.quoteResponse?.result ?? []
      if (results.length > 0) {
        const prices: Record<string, number> = {}
        const prevClose: Record<string, number | null> = {}
        const changePercent: Record<string, number | null> = {}
        const week52: Record<string, { low: number | null; high: number | null }> = {}
        for (const r of results) {
          const sym = symbolByYahoo.get(r.symbol)
          if (!sym) continue
          if (r.regularMarketPrice) prices[sym] = r.regularMarketPrice
          prevClose[sym] = r.regularMarketPreviousClose ?? null
          changePercent[sym] = r.regularMarketChangePercent ?? null
          week52[sym] = { low: r.fiftyTwoWeekLow ?? null, high: r.fiftyTwoWeekHigh ?? null }
        }
        return { prices, prevClose, changePercent, week52 }
      }
    }
  } catch { /* fall through to per-symbol fallback */ }

  // Attempt 2: Parallel per-symbol v8 chart calls
  const quotes = await Promise.all(targets.map(t => fetchYahooQuote(t.yahooSymbol).then(q => ({ sym: t.symbol, q }))))
  const prices: Record<string, number> = {}
  const prevClose: Record<string, number | null> = {}
  const changePercent: Record<string, number | null> = {}
  const week52: Record<string, { low: number | null; high: number | null }> = {}
  for (const { sym, q } of quotes) {
    if (q?.price) prices[sym] = q.price
    prevClose[sym] = q?.previousClose ?? null
    changePercent[sym] = q?.changePercent ?? null
    week52[sym] = { low: q?.week52Low ?? null, high: q?.week52High ?? null }
  }
  return { prices, prevClose, changePercent, week52 }
}

export interface GoldQuote {
  pricePerGram: number
  prevPricePerGram: number | null
}

const GRAMS_PER_TROY_OZ = 31.1035

/** INR per gram from COMEX gold (USD per troy oz) and the USD/INR rate. */
export function goldPerGram(usdPerOz: number, usdInr: number): number {
  return (usdPerOz / GRAMS_PER_TROY_OZ) * usdInr
}

interface FuturesMeta { price: number; prevClose: number | null }

async function fetchFuturesMeta(symbol: string): Promise<FuturesMeta | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { headers: { 'User-Agent': YAHOO_UA } },
  )
  if (!res.ok) return null
  const json = await res.json()
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta?.regularMarketPrice) return null
  // Futures/FX chart meta carries the prior close as chartPreviousClose, not
  // previousClose (unlike NSE equities above).
  return { price: meta.regularMarketPrice as number, prevClose: (meta.chartPreviousClose as number) ?? null }
}

/** Fetches gold in INR per gram (GC=F × USDINR=X) plus the prior per-gram price.
 *  Deliberately uncached — it backs the Prices button, which must return the live price.
 *  Returns null on any failure. */
export async function fetchGoldPrice(): Promise<GoldQuote | null> {
  try {
    const [gc, usdinr] = await Promise.all([fetchFuturesMeta('GC=F'), fetchFuturesMeta('USDINR=X')])
    if (!gc || !usdinr) return null
    return {
      pricePerGram: goldPerGram(gc.price, usdinr.price),
      prevPricePerGram: gc.prevClose !== null && usdinr.prevClose !== null
        ? goldPerGram(gc.prevClose, usdinr.prevClose)
        : null,
    }
  } catch {
    return null
  }
}

/** Daily USD->INR closes (Yahoo `USDINR=X`) over `range` (e.g. '1mo', '5y'). [] on any failure. */
export async function fetchUsdInrHistory(range: string): Promise<FxRate[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/USDINR=X?range=${range}&interval=1d`,
      { headers: { 'User-Agent': YAHOO_UA } },
    )
    if (!res.ok) return []
    return parseYahooFxHistory(await res.json())
  } catch {
    return []
  }
}
