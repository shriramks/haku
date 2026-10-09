import { describe, it, expect } from 'vitest'
import { computeRegionExposure, mfRegion } from '../exposure'

const named = (scheme_name: string, scheme_type = 'Equity Scheme') => ({ id: scheme_name, scheme_name, scheme_type })
const tx = (trade_date: string, trade_type: 'buy' | 'sell', amount: number) => ({ trade_date, trade_type, amount })

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
  const us = { fund: named('Edelweiss US Technology Equity FoF'), currentValue: 300, invested: 250, transactions: [tx('2025-01-01', 'buy', 250)] }
  const india = { fund: named('Parag Parikh Flexi Cap Fund'), currentValue: 700, invested: 500, transactions: [tx('2025-01-01', 'buy', 500)] }

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
    expect(r).toMatchObject({ indiaValue: 0, usValue: 0, indiaPct: 0, usPct: 0 })
    expect(r.equity.map(g => [g.value, g.pctOfEquity, g.xirr])).toEqual([[0, 0, null], [0, 0, null], [0, 0, null], [0, 0, null]])
  })

  describe('US funds and ETFs', () => {
    const big = { ...us, fund: named('Mirae Asset S&P 500 Top 50 FoF'), currentValue: 900, invested: 800 }
    const debtUs = { fund: named('Some US Treasury Fund', 'Debt Scheme'), currentValue: null, invested: 100, transactions: [] }

    it('lists every US fund (any class), largest first, summing to usValue', () => {
      const r = computeRegionExposure([us, india, debtUs, big], 3000)
      expect(r.usHoldings.map(f => f.key)).toEqual([big.fund.id, us.fund.id, debtUs.fund.id])
      expect(r.usHoldings.reduce((s, f) => s + f.value, 0)).toBe(r.usValue)
      expect(r.usHoldings[0]).toMatchObject({ name: big.fund.scheme_name, value: 900 })
      expect(r.usHoldings[0].pctOfTotal).toBeCloseTo(30)
      expect(r.usHoldings[0].xirr).not.toBeNull()
    })

    it('no NAV counts at cost; no transactions → xirr null', () => {
      expect(computeRegionExposure([debtUs], 100).usHoldings[0]).toMatchObject({ value: 100, xirr: null })
    })

    it('empty without US funds, and survives a JSON round-trip', () => {
      expect(computeRegionExposure([india], 700).usHoldings).toEqual([])
      const r = computeRegionExposure([us], 300)
      expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    })
  })

  describe('equity by region', () => {
    const stocks = { value: 1000, txns: [tx('2025-01-01', 'buy', 800)] }

    it('three groups sum to equity value (stocks + equity MFs); shares sum to 100', () => {
      const r = computeRegionExposure([us, india], 5000, stocks)
      expect(r.equity.map(g => g.key)).toEqual(['india-stocks', 'india-mfs', 'us-stocks', 'us-mfs'])
      expect(r.equity.map(g => g.value)).toEqual([1000, 700, 0, 300])
      expect(r.equity.reduce((s, g) => s + g.value, 0)).toBe(2000)
      expect(r.equity.reduce((s, g) => s + g.pctOfEquity, 0)).toBeCloseTo(100)
      expect(r.equity[3].pctOfEquity).toBeCloseTo(15)
      expect(r.equity.filter(g => g.value > 0).every(g => g.xirr !== null)).toBe(true)
    })

    it('a debt-class fund inferred US counts in the bar but not in equity by region', () => {
      const debtUs = { fund: named('Some US Treasury Debt Fund', 'Debt Scheme'), currentValue: 400, invested: 400, transactions: [tx('2025-01-01', 'buy', 400)] }
      const r = computeRegionExposure([debtUs, india], 1100, { value: 0, txns: [] })
      expect(r.usValue).toBe(400)
      expect(r.equity.map(g => g.value)).toEqual([0, 700, 0, 0])
    })

    it('xirr is null for a group with no value or no transactions', () => {
      const r = computeRegionExposure([{ ...us, transactions: [] }], 300, { value: 0, txns: [] })
      expect(r.equity[0].xirr).toBeNull()
      expect(r.equity[3].value).toBe(300)
      expect(r.equity[3].xirr).toBeNull()
    })

    it('an MF with no NAV counts at cost', () => {
      const r = computeRegionExposure([{ ...us, currentValue: null }], 250, { value: 0, txns: [] })
      expect(r.equity[3].value).toBe(250)
    })

    it('survives a JSON round-trip', () => {
      const r = computeRegionExposure([us, india], 5000, stocks)
      expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    })
  })

  describe('direct USD holdings', () => {
    const direct = (id: string, region: 'us' | 'india', value: number | null, invested: number) => ({
      holding: { id, symbol: id.toUpperCase(), name: `${id} ETF`, region },
      transactions: [{ trade_date: '2025-01-01', trade_type: 'buy' as const, amount_inr: invested }],
      currentValue: value, invested,
    })
    const stocks = { value: 1000, txns: [tx('2025-01-01', 'buy', 800)] }

    it('a US-region holding adds to usValue, so India + US still equals the total', () => {
      const r = computeRegionExposure([india], 2700, stocks, [direct('vuaa', 'us', 1000, 900)])
      expect(r.usValue).toBe(1000)
      expect(r.indiaValue + r.usValue).toBe(2700)
    })

    it('lands in the US stocks & ETFs group; groups still sum to equity value', () => {
      const r = computeRegionExposure([us, india], 3000, stocks, [direct('vuaa', 'us', 1000, 900)])
      expect(r.equity.map(g => g.value)).toEqual([1000, 700, 1000, 300])
      expect(r.equity.reduce((s, g) => s + g.pctOfEquity, 0)).toBeCloseTo(100)
      expect(r.equity[2].xirr).not.toBeNull()
    })

    it('an India-region holding joins India stocks and stays out of usValue', () => {
      const r = computeRegionExposure([], 1500, stocks, [direct('inda', 'india', 500, 400)])
      expect(r.usValue).toBe(0)
      expect(r.equity[0].value).toBe(1500)
    })

    it('counts at cost without a price, and lists beside US MFs largest first with its own href', () => {
      const r = computeRegionExposure([us], 1000, undefined, [direct('vuaa', 'us', null, 700)])
      expect(r.usValue).toBe(1000)
      expect(r.usHoldings.map(h => h.key)).toEqual(['vuaa', us.fund.id])
      expect(r.usHoldings[0]).toMatchObject({ href: '/portfolio/us/vuaa', name: 'vuaa ETF', value: 700 })
      expect(r.usHoldings[1].href).toBe(`/portfolio/mf/${us.fund.id}`)
    })
  })
})
