// Instrument master (`stocks`, progress log #152): the venue, currency and Yahoo symbol each
// tradable symbol is priced with. Public reference data like stock_prices, written only here via
// the service-role client, so a client-supplied Yahoo symbol can never reach a table every user
// reads. Uncached on purpose, same as stock_prices: the Prices refresh must see a new row at once.
import { createSupabaseServiceClient } from './supabase-service'

export interface Stock {
  symbol: string
  exchange: string
  currency: string
  yahooSymbol: string
  region: 'india' | 'us'
  name: string
}

/** Letters, digits and . - & _ only, no leading punctuation (so no collision with `_GOLD_INR_PER_GRAM` / `_USDINR` in stock_prices), max 20 chars. */
export function isValidStockSymbol(symbol: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.\-&_]{0,19}$/.test(symbol)
}

/** What an instrument we know nothing else about is: an NSE equity / ETF. */
export function nseStock(symbol: string): Stock {
  return { symbol, exchange: 'NSE', currency: 'INR', yahooSymbol: `${symbol}.NS`, region: 'india', name: '' }
}

type StockRow = { symbol: string; exchange: string; currency: string; yahoo_symbol: string; region: 'india' | 'us'; name: string }
const COLUMNS = 'symbol, exchange, currency, yahoo_symbol, region, name'

const toStock = (r: StockRow): Stock => ({
  symbol: r.symbol, exchange: r.exchange, currency: r.currency, yahooSymbol: r.yahoo_symbol, region: r.region, name: r.name,
})
const toRow = (s: Stock): StockRow => ({
  symbol: s.symbol, exchange: s.exchange, currency: s.currency, yahoo_symbol: s.yahooSymbol, region: s.region, name: s.name,
})

async function readStocks(symbols: string[]): Promise<Record<string, Stock> | null> {
  if (symbols.length === 0) return {}
  const { data, error } = await createSupabaseServiceClient()
    .from('stocks')
    .select(COLUMNS)
    .in('symbol', symbols)
  if (error) return null
  const result: Record<string, Stock> = {}
  for (const row of (data ?? []) as StockRow[]) result[row.symbol] = toStock(row)
  return result
}

/** Master rows for `symbols`, keyed by symbol. A symbol with no row is absent — callers skip it, never guess a suffix. */
export async function getStocks(symbols: string[]): Promise<Record<string, Stock>> {
  return (await readStocks(symbols)) ?? {}
}

/**
 * Makes sure every symbol has a master row, creating missing ones from `known` (an instrument the
 * caller already has full details for, e.g. VUAA) or else as NSE / INR / `SYMBOL.NS`. Existing rows
 * are never overwritten. Symbols that fail `isValidStockSymbol` are not written. Returns the master
 * rows for the requested symbols; null if the master could not be read or written.
 */
export async function ensureStocks(
  symbols: string[],
  known: Record<string, Stock> = {},
): Promise<Record<string, Stock> | null> {
  const wanted = [...new Set(symbols.map(s => s.trim()).filter(isValidStockSymbol))]
  if (wanted.length === 0) return {}
  const existing = await readStocks(wanted)
  if (!existing) return null
  const missing = wanted.filter(s => !existing[s])
  if (missing.length === 0) return existing
  const created = missing.map(s => known[s] ?? nseStock(s))
  const { error } = await createSupabaseServiceClient()
    .from('stocks')
    .upsert(created.map(toRow), { onConflict: 'symbol', ignoreDuplicates: true })
  if (error) return null
  const result = { ...existing }
  for (const s of created) result[s.symbol] = s
  return result
}
