import { describe, it, expect } from 'vitest'
import { isNseExchange, isValidYahooSymbol } from '../instrument'

describe('isNseExchange', () => {
  it('is true for NSE and for a missing venue, false for anything else', () => {
    expect(isNseExchange('NSE')).toBe(true)
    expect(isNseExchange(undefined)).toBe(true)
    expect(isNseExchange('LSE')).toBe(false)
  })
})

describe('isValidYahooSymbol', () => {
  it('accepts suffixed and plain tickers', () => {
    for (const s of ['VUAA.L', 'AAPL', 'BRK-B']) expect(isValidYahooSymbol(s)).toBe(true)
  })
  it('rejects empty, leading punctuation, path / query characters and over-long values', () => {
    for (const s of ['', '.L', '_USDINR', 'A/B', 'A?x=1', 'A B', 'A'.repeat(21)]) expect(isValidYahooSymbol(s)).toBe(false)
  })
})
