// Direct USD stocks / ETFs the app knows how to plan and trade (progress log #146.a).
// A symbol typed in Plan or picked in Add transaction that is listed here is a US holding;
// anything else is an NSE stock. Add an entry here to support another one.
import type { UsHolding } from './portfolio-types'
import type { Stock } from './stock-master'

// `exchange` / `currency` seed the `stocks` instrument master (#152) when a holding is first created.
export const US_SYMBOLS: Record<string, Pick<UsHolding, 'yahoo_symbol' | 'name' | 'region'> & { exchange: string; currency: string }> = {
  VUAA: { yahoo_symbol: 'VUAA.L', name: 'Vanguard S&P 500 UCITS ETF', region: 'us', exchange: 'LSE', currency: 'USD' },
}

/** Master rows for the symbols in `symbols` that this file knows, for `ensureStocks` to create on a first trade. */
export function knownInstruments(symbols: string[]): Record<string, Stock> {
  const known: Record<string, Stock> = {}
  for (const symbol of symbols) {
    const h = Object.hasOwn(US_SYMBOLS, symbol) ? US_SYMBOLS[symbol] : undefined   // own keys only: 'constructor' is not an instrument
    if (h) known[symbol] = { symbol, exchange: h.exchange, currency: h.currency, yahooSymbol: h.yahoo_symbol, region: h.region, name: h.name }
  }
  return known
}

export function isUsSymbol(symbol: string): boolean {
  return Object.hasOwn(US_SYMBOLS, symbol)
}
