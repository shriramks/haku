import { describe, it, expect } from 'vitest'
import { investedByYear, fyLabel, type YearTxn } from '../invested-by-year'

const cls = (id: string) => (id === 'debt-fund' ? 'debt' : 'equity')
const t = (o: Partial<YearTxn> & Pick<YearTxn, 'trade_date' | 'direction' | 'amount'>): YearTxn =>
  ({ asset: 'stock', ...o })

describe('fyLabel', () => {
  it('formats the FY ending in a year', () => {
    expect(fyLabel(2026)).toBe('FY 25-26')
    expect(fyLabel(2000)).toBe('FY 99-00')
  })
})

describe('investedByYear', () => {
  it('buckets by Indian FY: April starts a year, March ends it', () => {
    const rows = investedByYear([
      t({ trade_date: '2025-03-31', direction: 'in', amount: 100 }),
      t({ trade_date: '2025-04-01', direction: 'in', amount: 200 }),
    ], cls)
    expect(rows.map(r => [r.label, r.in])).toEqual([['FY 25-26', 200], ['FY 24-25', 100]])
  })

  it('net is in minus out and may go negative', () => {
    const [r] = investedByYear([
      t({ trade_date: '2025-06-01', direction: 'in', amount: 100 }),
      t({ trade_date: '2025-07-01', direction: 'out', amount: 250 }),
    ], cls)
    expect(r).toMatchObject({ in: 100, out: 250, net: -150 })
  })

  it('splits into Equity / Debt / Gold like the Portfolio', () => {
    const [r] = investedByYear([
      t({ asset: 'stock', trade_date: '2025-06-01', direction: 'in', amount: 10 }),
      t({ asset: 'mf', fundId: 'eq-fund', trade_date: '2025-06-01', direction: 'in', amount: 20 }),
      t({ asset: 'mf', fundId: 'debt-fund', trade_date: '2025-06-01', direction: 'in', amount: 30 }),
      t({ asset: 'ppf', trade_date: '2025-06-01', direction: 'in', amount: 40 }),
      t({ asset: 'epf', trade_date: '2025-06-01', direction: 'in', amount: 50 }),
      t({ asset: 'gold', trade_date: '2025-06-01', direction: 'in', amount: 60 }),
      t({ asset: 'stock', trade_date: '2025-06-02', direction: 'out', amount: 5 }),
    ], cls)
    expect(r.byClass.equity).toEqual({ in: 30, out: 5, net: 25 })
    expect(r.byClass.debt).toEqual({ in: 120, out: 0, net: 120 })
    expect(r.byClass.gold).toEqual({ in: 60, out: 0, net: 60 })
  })

  it('the three classes add up to the year', () => {
    const [r] = investedByYear([
      t({ asset: 'mf', fundId: 'debt-fund', trade_date: '2025-06-01', direction: 'in', amount: 70 }),
      t({ asset: 'gold', trade_date: '2025-06-01', direction: 'out', amount: 15 }),
      t({ trade_date: '2025-06-01', direction: 'in', amount: 40 }),
    ], cls)
    const sum = (k: 'in' | 'out' | 'net') => r.byClass.equity[k] + r.byClass.debt[k] + r.byClass.gold[k]
    expect([sum('in'), sum('out'), sum('net')]).toEqual([r.in, r.out, r.net])
  })

  it('skips direction-less rows (PPF/EPF interest)', () => {
    expect(investedByYear([t({ asset: 'ppf', trade_date: '2025-06-01', direction: 'neutral', amount: 999 })], cls)).toEqual([])
  })

  it('lists newest first and omits empty years', () => {
    const rows = investedByYear([
      t({ trade_date: '2022-05-01', direction: 'in', amount: 1 }),
      t({ trade_date: '2025-05-01', direction: 'in', amount: 1 }),
    ], cls)
    expect(rows.map(r => r.label)).toEqual(['FY 25-26', 'FY 22-23'])
  })
})
