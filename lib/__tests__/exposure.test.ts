import { describe, it, expect } from 'vitest'
import { computeRegionExposure, mfRegion } from '../exposure'

const named = (scheme_name: string) => ({ scheme_name })

describe('mfRegion', () => {
  it.each([
    'Motilal Oswal Nasdaq 100 FoF - Direct Plan',
    'Motilal Oswal Nasdaq-100 FoF',
    'Mirae Asset S&P 500 Top 50 ETF Fund of Fund',
    'Mirae Asset S & P 500 Top 50 FoF',
    'Some Fund S&amp;P 500 Index',
    'Some Fund S and P 500 Index',
    'Some Fund SnP 500 Index',
    'Some Fund S&P500 Index',
    'Edelweiss US Technology Equity FoF',
    'ICICI Prudential US Bluechip Equity Fund',
    'Franklin U.S. Opportunities Fund of Fund',
    'PGIM India Global us equity',
  ])('%s is US', name => {
    expect(mfRegion(named(name))).toBe('us')
  })

  it.each([
    'Parag Parikh Flexi Cap Fund',
    'HDFC Focus 30 Fund',
    'Axis Bluechip Fund',
    'Nippon India Nifty 50 Index Fund',
    'Quant Business Cycles Fund',
    'ICICI Prudential Equity & Debt Fund',
    'SBI Magnum Midcap Fund',
    'Kotak Funds and Plus Fund',
    'Bandhan Business Fund',
    'HDFC Liquid Fund',
  ])('%s is India', name => {
    expect(mfRegion(named(name))).toBe('india')
  })
})

describe('computeRegionExposure', () => {
  const us = { fund: named('Edelweiss US Technology Equity FoF'), currentValue: 300, invested: 250 }
  const india = { fund: named('Parag Parikh Flexi Cap Fund'), currentValue: 700, invested: 500 }

  it('India + US equals the total, and the shares add to 100', () => {
    const r = computeRegionExposure([us, india], 2000)   // 1000 of MFs, 1000 of stocks / gold / PPF / EPF
    expect(r.usValue).toBe(300)
    expect(r.indiaValue).toBe(1700)
    expect(r.indiaValue + r.usValue).toBe(2000)
    expect(r.usPct).toBeCloseTo(15)
    expect(r.indiaPct + r.usPct).toBeCloseTo(100)
  })

  it('no US funds → 100% India', () => {
    const r = computeRegionExposure([india], 1700)
    expect(r.usValue).toBe(0)
    expect(r.usPct).toBe(0)
    expect(r.indiaPct).toBeCloseTo(100)
  })

  it('a US fund with no NAV counts at cost, like the pie', () => {
    const r = computeRegionExposure([{ ...us, currentValue: null }], 1000)
    expect(r.usValue).toBe(250)
  })

  it('an empty portfolio is 0 / 0, not NaN', () => {
    const r = computeRegionExposure([], 0)
    expect(r).toEqual({ indiaValue: 0, usValue: 0, indiaPct: 0, usPct: 0 })
  })
})
