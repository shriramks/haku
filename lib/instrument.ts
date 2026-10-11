// Pure instrument helpers shared by server actions and the Plan UI (progress log #154).
// No server imports, so client components can use them.

/** The venue stored on rows of Indian listings; anything else is an overseas instrument. */
export const NSE_EXCHANGE = 'NSE'

export function isNseExchange(exchange: string | null | undefined): boolean {
  return (exchange ?? NSE_EXCHANGE) === NSE_EXCHANGE
}

/** A Yahoo ticker with its suffix (`VUAA.L`, `AAPL`, `BRK-B`). Letters, digits and . - only, max 20 chars, no leading punctuation. */
export function isValidYahooSymbol(symbol: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$/.test(symbol)
}
