import { describe, it, expect } from 'vitest'
import { rateOnOrBefore, parseYahooFxHistory } from '../fx'

const rates = [
  { rate_date: '2026-10-05', rate: 83.1 },
  { rate_date: '2026-10-02', rate: 83.0 },
  { rate_date: '2026-10-06', rate: 83.2 },
]

describe('rateOnOrBefore', () => {
  it('returns the exact day when present', () => {
    expect(rateOnOrBefore(rates, '2026-10-05')).toBe(83.1)
  })
  it('falls back to the previous trading day for a weekend', () => {
    expect(rateOnOrBefore(rates, '2026-10-04')).toBe(83.0)
  })
  it('is order-independent', () => {
    expect(rateOnOrBefore(rates, '2026-10-09')).toBe(83.2)
  })
  it('returns null before the first known rate', () => {
    expect(rateOnOrBefore(rates, '2026-09-01')).toBeNull()
  })
})

describe('parseYahooFxHistory', () => {
  it('maps timestamps to dates, skips null closes, sorts', () => {
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000
    const json = { chart: { result: [{
      timestamp: [day('2026-10-06'), day('2026-10-05'), day('2026-10-07')],
      indicators: { quote: [{ close: [83.2, 83.1, null] }] },
    }] } }
    expect(parseYahooFxHistory(json)).toEqual([
      { rate_date: '2026-10-05', rate: 83.1 },
      { rate_date: '2026-10-06', rate: 83.2 },
    ])
  })
  it('returns [] for a malformed response', () => {
    expect(parseYahooFxHistory({})).toEqual([])
  })
})
