// Direct USD stocks / ETFs the app knows how to plan and trade (progress log #146.a).
// A symbol typed in Plan or picked in Add transaction that is listed here is a US holding;
// anything else is an NSE stock. Add an entry here to support another one.
import type { UsHolding } from './portfolio-types'

// `exchange` / `currency` seed the `stocks` instrument master (#152) when a holding is first created.
export const US_SYMBOLS: Record<string, Pick<UsHolding, 'yahoo_symbol' | 'name' | 'region'> & { exchange: string; currency: string }> = {
  VUAA: { yahoo_symbol: 'VUAA.L', name: 'Vanguard S&P 500 UCITS ETF', region: 'us', exchange: 'LSE', currency: 'USD' },
}

export function isUsSymbol(symbol: string): boolean {
  return Object.hasOwn(US_SYMBOLS, symbol)
}
