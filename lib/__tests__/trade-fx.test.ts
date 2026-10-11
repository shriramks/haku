import { describe, it, expect } from 'vitest'
import { tradeFxRate, inrTransactions } from '../trade-fx'
import { isUsSymbol, knownInstruments } from '../us-symbols'

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

describe('us-symbols', () => {
  it('isUsSymbol knows VUAA only', () => {
    expect(isUsSymbol('VUAA')).toBe(true)
    expect(isUsSymbol('TCS')).toBe(false)
    expect(isUsSymbol('toString')).toBe(false)
  })

  it('knownInstruments gives the master row VUAA is created from, and nothing for NSE symbols', () => {
    expect(knownInstruments(['VUAA', 'TCS'])).toEqual({
      VUAA: { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahooSymbol: 'VUAA.L', region: 'us', name: 'Vanguard S&P 500 UCITS ETF' },
    })
  })
})

describe('inrTransactions', () => {
  const txns = [{ symbol: 'TCS' }, { symbol: 'VUAA' }, { symbol: 'NEWCO' }]

  it('drops trades of non-INR instruments; an unknown symbol counts as INR', () => {
    expect(inrTransactions(txns, { TCS: { currency: 'INR' }, VUAA: { currency: 'USD' } }))
      .toEqual([{ symbol: 'TCS' }, { symbol: 'NEWCO' }])
  })
})
