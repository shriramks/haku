import { describe, it, expect } from 'vitest'
import { allocationSections, fundLine, goldLine, ppfLine, stockLine, stripTotals, totalsOf, type AllocationLine } from '../allocation-sections'
import type { StockRow } from '../types'

const FY = { total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000, equity_pct: 75, debt_pct: 25, gold_pct: 0 }

function row(symbol: string, budget: number, spent: number, currentCost = spent): StockRow {
  return { symbol, allocationPct: 0, budget, spent, remaining: budget - spent, pctRemaining: 0, qty: 0, avgCost: 0, currentCost, cmp: null, unrealisedPnL: null, unrealisedPnLPct: null }
}

describe('totalsOf', () => {
  it('sums budget, invested and left over the rows', () => {
    const t = totalsOf([
      { key: 'A', name: 'A', href: '', budget: 600_000, spent: 240_000, remaining: 360_000, currentCost: 240_000 },
      { key: 'B', name: 'B', href: '', budget: 375_000, spent: 150_000, remaining: 225_000, currentCost: 150_000 },
    ])
    expect(t.budget).toBe(975_000)
    expect(t.invested).toBe(390_000)
    expect(t.remaining).toBe(585_000)
    expect(t.pctInvested).toBeCloseTo(40, 6)
    expect(t.pctLeft).toBeCloseTo(60, 6)
  })
  it('is all zeros with no rows', () => {
    expect(totalsOf([])).toEqual({ budget: 0, invested: 0, remaining: 0, pctInvested: 0, pctLeft: 0 })
  })
  it('floors the Left % at 0 when over-invested but keeps the signed amount', () => {
    const t = totalsOf([{ key: 'A', name: 'A', href: '', budget: 100, spent: 130, remaining: -30, currentCost: 130 }])
    expect(t.remaining).toBe(-30)
    expect(t.pctLeft).toBe(0)
    expect(t.pctInvested).toBe(130)
  })
  it('does not force Invested % and Left % to add to 100 (currentCost and spent are different measures)', () => {
    // sold down: spent (net buys) is 0 while the position still costs 40
    const t = totalsOf([{ key: 'A', name: 'A', href: '', budget: 100, spent: 0, remaining: 100, currentCost: 40 }])
    expect(t.pctInvested).toBe(40)
    expect(t.pctLeft).toBe(100)
  })
})

describe('stockLine / ppfLine', () => {
  it('a stock line links to its detail page for the FY', () => {
    const l = stockLine(row('ITC', 100, 10), 'FY 27')
    expect(l.href).toBe('/stocks/ITC?fy=FY%2027')
    expect(l.name).toBe('ITC')
  })
  it('PPF: budget is its % of the Debt sleeve, invested is the deposits, and it opens Portfolio', () => {
    const l = ppfLine({ allocation_pct: 28 }, FY, 110_000)
    expect(l.budget).toBeCloseTo(140_000, 6)     // 28% of Debt's 5 L
    expect(l.currentCost).toBe(110_000)
    expect(l.spent).toBe(110_000)
    expect(l.remaining).toBeCloseTo(30_000, 6)
    expect(l.href).toBe('/portfolio')
  })
  it('PPF over its budget shows a negative remaining', () => {
    expect(ppfLine({ allocation_pct: 28 }, FY, 150_000).remaining).toBeCloseTo(-10_000, 6)
  })
})

describe('allocationSections', () => {
  const eq: AllocationLine[] = [stockLine(row('NIFTYBEES', 600_000, 240_000), 'FY27'), stockLine(row('ITC', 375_000, 375_000), 'FY27')]
  const ppf = ppfLine({ allocation_pct: 28 }, FY, 110_000)

  it('makes one section per sleeve that has rows, Equity first', () => {
    const sections = allocationSections(eq, [ppf])
    expect(sections.map(s => s.sleeve)).toEqual(['equity', 'debt'])
  })
  it('leaves out a sleeve with no rows', () => {
    expect(allocationSections(eq, []).map(s => s.sleeve)).toEqual(['equity'])
    expect(allocationSections([], [])).toEqual([])
  })
  it('sorts rows by name inside a section', () => {
    expect(allocationSections(eq, [])[0].lines.map(l => l.name)).toEqual(['ITC', 'NIFTYBEES'])
  })
  it('each section carries its own totals', () => {
    const debt = allocationSections(eq, [ppf]).find(s => s.sleeve === 'debt')!
    expect(debt.budget).toBeCloseTo(140_000, 6)
    expect(debt.invested).toBe(110_000)
  })
  it('the strip is the sum of its sections (budget, invested and left all agree)', () => {
    const sections = allocationSections(eq, [ppf])
    const strip = stripTotals(sections)
    expect(strip.budget).toBeCloseTo(sections.reduce((s, x) => s + x.budget, 0), 6)
    expect(strip.invested).toBeCloseTo(sections.reduce((s, x) => s + x.invested, 0), 6)
    expect(strip.remaining).toBeCloseTo(sections.reduce((s, x) => s + x.remaining, 0), 6)
  })
  it('with only stock rows the strip is what it was before sleeves', () => {
    const strip = stripTotals(allocationSections(eq, []))
    expect(strip.budget).toBe(975_000)
    expect(strip.invested).toBe(615_000)
    expect(strip.remaining).toBe(360_000)
  })
})

describe('fundLine', () => {
  const alloc = { symbol: '100', allocation_pct: 40, name: 'Example Liquid' }
  it('budgets at its % of Debt and counts invested as spent and deployed', () => {
    const l = fundLine(alloc, FY, 100_000, 'abc')
    expect(l.budget).toBeCloseTo(200_000, 6)   // 40% of 25% of 20 L
    expect(l).toMatchObject({ key: '100', name: 'Example Liquid', href: '/portfolio/mf/abc', spent: 100_000, currentCost: 100_000 })
    expect(l.remaining).toBeCloseTo(100_000, 6)
  })
  it('opens Portfolio while the fund has no holding yet, and falls back to the code for a name', () => {
    const l = fundLine({ symbol: '100', allocation_pct: 40 }, FY, 0, null)
    expect(l.href).toBe('/portfolio')
    expect(l.name).toBe('100')
  })
})

describe('goldLine', () => {
  const FYG = { ...FY, equity_pct: 70, debt_pct: 20, gold_pct: 10 }
  it('budgets at its % of Gold and counts invested as spent and deployed', () => {
    const l = goldLine({ symbol: 'SGB', allocation_pct: 60 }, FYG, 50_000)
    expect(l.budget).toBeCloseTo(120_000, 6)   // 60% of 10% of 20 L
    expect(l).toMatchObject({ key: 'SGB', name: 'SGB', href: '/portfolio', spent: 50_000, currentCost: 50_000 })
    expect(l.remaining).toBeCloseTo(70_000, 6)
  })
  it('builds a Gold section after Debt', () => {
    const s = allocationSections([], [fundLine({ symbol: '1', allocation_pct: 10 }, FYG, 0, null)], [goldLine({ symbol: 'ETF', allocation_pct: 40 }, FYG, 0)])
    expect(s.map(x => x.sleeve)).toEqual(['debt', 'gold'])
  })
})
