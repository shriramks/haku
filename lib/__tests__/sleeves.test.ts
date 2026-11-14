import { describe, it, expect } from 'vitest'
import {
  fyPool, sleevePct, sleeveBudget, rowBudget, allocSleeve, stockAllocations, ppfDeposited, fyCarryover, fundInvestedByScheme,
  SLEEVES, pctStep,
} from '../sleeves'
import type { AllocationKind } from '../types'

// Pool 20 L = budget 18 L + carryover 2 L, split 75 / 25 / 0 — the numbers used in the #180 mockup.
const FY = { total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000, equity_pct: 75, debt_pct: 25, gold_pct: 0 }

describe('fyPool', () => {
  it('is the budget plus carryover', () => expect(fyPool(FY)).toBe(2_000_000))
  it('treats a null carryover as zero', () => expect(fyPool({ total_budget_inr: 500, unallocated_carryover_inr: null })).toBe(500))
  it('is zero with no FY', () => { expect(fyPool(null)).toBe(0); expect(fyPool(undefined)).toBe(0) })
  it('counts a negative (over-invested) carryover', () => expect(fyPool({ total_budget_inr: 1000, unallocated_carryover_inr: -300 })).toBe(700))
})

describe('sleevePct', () => {
  it('reads each sleeve', () => {
    expect(sleevePct(FY, 'equity')).toBe(75)
    expect(sleevePct(FY, 'debt')).toBe(25)
    expect(sleevePct(FY, 'gold')).toBe(0)
  })
  it('defaults to all Equity when the columns are missing (a row cached before #180)', () => {
    expect(sleevePct({}, 'equity')).toBe(100)
    expect(sleevePct({}, 'debt')).toBe(0)
    expect(sleevePct({}, 'gold')).toBe(0)
  })
  it('defaults to all Equity with no FY', () => {
    expect(sleevePct(null, 'equity')).toBe(100)
    expect(sleevePct(undefined, 'gold')).toBe(0)
  })
  it('accepts numeric strings (numeric(5,2) can arrive as text)', () => {
    expect(sleevePct({ equity_pct: '62.50' as unknown as number }, 'equity')).toBe(62.5)
  })
})

describe('sleeveBudget', () => {
  it('is the sleeve % of the pool', () => {
    expect(sleeveBudget(FY, 'equity')).toBe(1_500_000)
    expect(sleeveBudget(FY, 'debt')).toBe(500_000)
    expect(sleeveBudget(FY, 'gold')).toBe(0)
  })
  it('the sleeves together are the whole pool when the split totals 100', () => {
    const total = SLEEVES.reduce((s, sl) => s + sleeveBudget(FY, sl), 0)
    expect(total).toBeCloseTo(fyPool(FY), 6)
  })
  it('an FY with no split gives Equity the whole pool, so stock budgets are unchanged', () => {
    const old = { total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000 }
    expect(sleeveBudget(old, 'equity')).toBe(2_000_000)
    expect(sleeveBudget(old, 'debt')).toBe(0)
  })
  it('a split under 100 leaves the rest of the pool unassigned', () => {
    const under = { ...FY, equity_pct: 60, debt_pct: 20, gold_pct: 0 }
    const assigned = SLEEVES.reduce((s, sl) => s + sleeveBudget(under, sl), 0)
    expect(assigned).toBe(1_600_000)
  })
})

describe('rowBudget', () => {
  it('is the row % of its sleeve amount, not of the pool', () => {
    expect(rowBudget(40, sleeveBudget(FY, 'equity'))).toBe(600_000)   // 40% of Equity's 15 L
    expect(rowBudget(28, sleeveBudget(FY, 'debt'))).toBeCloseTo(140_000, 6) // PPF: 28% of Debt's 5 L
  })
  it('is the same as the pre-sleeve formula for an FY with no split', () => {
    const old = { total_budget_inr: 1_800_000, unallocated_carryover_inr: 200_000 }
    for (const pct of [0, 12.5, 40, 100]) {
      expect(rowBudget(pct, sleeveBudget(old, 'equity'))).toBeCloseTo((pct / 100) * fyPool(old), 6)
    }
  })
  it('rows that add up to 100 in a sleeve add up to that sleeve', () => {
    const rows = [40, 35, 25].map(p => rowBudget(p, sleeveBudget(FY, 'equity')))
    expect(rows.reduce((s, r) => s + r, 0)).toBeCloseTo(sleeveBudget(FY, 'equity'), 6)
  })
  it('is zero for any row in a 0% sleeve', () => expect(rowBudget(50, sleeveBudget(FY, 'gold'))).toBe(0))
})

describe('allocSleeve / stockAllocations', () => {
  it('maps each kind to its sleeve', () => {
    expect(allocSleeve('stock')).toBe('equity')
    expect(allocSleeve('ppf')).toBe('debt')
    expect(allocSleeve('mf')).toBe('debt')
  })
  it('keeps only stock rows', () => {
    const rows = (['stock', 'ppf', 'stock', 'mf'] as AllocationKind[]).map((kind, i) => ({ kind, id: i }))
    expect(stockAllocations(rows).map(r => r.id)).toEqual([0, 2])
  })
})

describe('ppfDeposited', () => {
  const t = (trade_date: string, trade_type: 'deposit' | 'withdrawal' | 'interest', amount: number) => ({ trade_date, trade_type, amount })
  it('sums deposits dated inside the FY', () => {
    expect(ppfDeposited([t('2026-05-02', 'deposit', 50_000), t('2026-11-01', 'deposit', 90_000)], '2026-04-01', '2027-03-31')).toBe(140_000)
  })
  it('ignores interest and withdrawals — they are not invested money', () => {
    expect(ppfDeposited([t('2026-05-02', 'deposit', 50_000), t('2027-03-31', 'interest', 12_000), t('2026-08-01', 'withdrawal', 20_000)], '2026-04-01', '2027-03-31')).toBe(50_000)
  })
  it('includes both boundary dates and excludes the days outside', () => {
    const txns = [t('2026-03-31', 'deposit', 1), t('2026-04-01', 'deposit', 10), t('2027-03-31', 'deposit', 100), t('2027-04-01', 'deposit', 1000)]
    expect(ppfDeposited(txns, '2026-04-01', '2027-03-31')).toBe(110)
  })
  it('is zero with no deposits', () => expect(ppfDeposited([], '2026-04-01', '2027-03-31')).toBe(0))
})

describe('fyCarryover', () => {
  it('is the pool minus stock spend and PPF deposits', () => {
    expect(fyCarryover(2_000_000, 1_200_000, 140_000)).toBe(660_000)
  })
  it('does not count PPF as unspent: a PPF deposit reduces carryover just as a stock buy does', () => {
    expect(fyCarryover(1_000_000, 0, 140_000)).toBe(fyCarryover(1_000_000, 140_000, 0))
  })
  it('is negative when over-invested', () => expect(fyCarryover(100, 80, 50)).toBe(-30))
  it('is unchanged from the old stock-only figure when there are no PPF deposits', () => {
    expect(fyCarryover(2_000_000, 1_200_000, 0)).toBe(2_000_000 - 1_200_000)
  })
})

describe('pctStep', () => {
  it('is 0.1 on a short range, where fine control is wanted', () => {
    expect(pctStep(10)).toBe(0.1)
    expect(pctStep(25)).toBe(0.1)
  })
  it('is 1 on a wide range, where 0.1 steps would be 1,000 slider positions', () => {
    expect(pctStep(26)).toBe(1)
    expect(pctStep(100)).toBe(1)
  })
  it('a full-range slider has at most about 100 positions', () => {
    expect(100 / pctStep(100)).toBeLessThanOrEqual(100)
  })
})

describe('fundInvestedByScheme', () => {
  const funds = [{ id: 'f1', scheme_code: '100' }, { id: 'f2', scheme_code: '200' }]
  const t = (fund_id: string, trade_date: string, trade_type: 'buy' | 'sell', amount: number) => ({ fund_id, trade_date, trade_type, amount })
  it('is net buys minus redemptions dated in the FY, by scheme code', () => {
    const out = fundInvestedByScheme(funds, [
      t('f1', '2026-04-01', 'buy', 50_000), t('f1', '2027-03-31', 'buy', 30_000), t('f1', '2026-09-01', 'sell', 20_000),
      t('f2', '2026-05-01', 'buy', 10_000),
    ], '2026-04-01', '2027-03-31')
    expect(out).toEqual({ '100': 60_000, '200': 10_000 })
  })
  it('ignores other FYs and unknown funds', () => {
    expect(fundInvestedByScheme(funds, [t('f1', '2026-03-31', 'buy', 5), t('zz', '2026-06-01', 'buy', 5)], '2026-04-01', '2027-03-31')).toEqual({})
  })
  it('floors a net redemption at 0', () => {
    expect(fundInvestedByScheme(funds, [t('f1', '2026-06-01', 'sell', 9_000)], '2026-04-01', '2027-03-31')).toEqual({ '100': 0 })
  })
})

describe('fyCarryover with fund rows', () => {
  it('subtracts net fund buys as well', () => expect(fyCarryover(2_000_000, 900_000, 100_000, 250_000)).toBe(750_000))
  it('is unchanged without funds', () => expect(fyCarryover(2_000_000, 900_000, 100_000)).toBe(1_000_000))
})
