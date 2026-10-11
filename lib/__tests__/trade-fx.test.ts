import { describe, it, expect } from 'vitest'
import { tradeFxRate, inrTransactions, inrPerUnit } from '../trade-fx'

describe('tradeFxRate', () => {
  it('stores 1 for an INR instrument, whatever the caller sent', () => {
    expect(tradeFxRate({ currency: 'INR' }, undefined)).toBe(1)
    expect(tradeFxRate({ currency: 'INR' }, 83.2)).toBe(1)
  })

  it('treats an instrument with no master row as INR', () => {
    expect(tradeFxRate(undefined, 83.2)).toBe(1)
  })

  it('keeps the supplied rate for a USD instrument', () => {
    expect(tradeFxRate({ currency: 'USD' }, 104.47)).toBe(104.47)
  })

  it('rejects a USD trade with a missing, zero, negative or non-finite rate', () => {
    for (const bad of [undefined, 0, -1, NaN, Infinity]) {
      expect(tradeFxRate({ currency: 'USD' }, bad)).toBeNull()
    }
  })
})

describe('inrPerUnit', () => {
  const stocks = { TCS: { currency: 'INR' }, VUAA: { currency: 'USD' }, ODD: { currency: 'EUR' } }

  it('omits INR instruments and maps USD ones to the USD->INR rate', () => {
    expect(inrPerUnit(stocks, 90)).toEqual({ VUAA: 90, ODD: null })
  })

  it('maps foreign instruments to null when no USD->INR rate is saved', () => {
    expect(inrPerUnit(stocks, null)).toEqual({ VUAA: null, ODD: null })
    expect(inrPerUnit(stocks, 0)).toEqual({ VUAA: null, ODD: null })
  })
})

describe('inrTransactions', () => {
  const txns = [{ symbol: 'TCS' }, { symbol: 'VUAA' }, { symbol: 'NEWCO' }]

  it('drops trades of non-INR instruments; an unknown symbol counts as INR', () => {
    expect(inrTransactions(txns, { TCS: { currency: 'INR' }, VUAA: { currency: 'USD' } }))
      .toEqual([{ symbol: 'TCS' }, { symbol: 'NEWCO' }])
  })
})
