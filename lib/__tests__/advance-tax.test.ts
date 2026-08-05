import { describe, it, expect } from 'vitest'
import {
  advanceTaxMilestones, computeInstalments, shouldSuppressInstalments, buildLiabilityAsOf,
} from '../advance-tax'
import type { FiscalYear, Transaction, DividendTransaction } from '../types'
import type { AdvanceTaxPaid } from '../advance-tax'
import type { MFund, MFTransaction, SGBTransaction } from '../portfolio-types'

const FY: FiscalYear = {
  id: 'fy1', label: 'FY25-26', start_date: '2025-04-01', end_date: '2026-03-31',
  total_budget_inr: 0, unallocated_carryover_inr: null, deploy_capital_inr: null,
}

// ── advanceTaxMilestones ───────────────────────────────────────────────────────

describe('advanceTaxMilestones', () => {
  it('Jun/Sep/Dec fall in the FY start year, Mar in the end year', () => {
    const m = advanceTaxMilestones(FY)
    expect(m.map(x => x.date)).toEqual(['2025-06-15', '2025-09-15', '2025-12-15', '2026-03-15'])
  })

  it('Jun/Sep/Dec carry a 3-month s.234C multiplier, Mar carries 1', () => {
    const m = advanceTaxMilestones(FY)
    expect(m.map(x => x.monthsIfShort)).toEqual([3, 3, 3, 1])
  })

  it('carries the s.211 cumulative percentages: 15/45/75/100%', () => {
    const m = advanceTaxMilestones(FY)
    expect(m.map(x => x.cumulativePct)).toEqual([0.15, 0.45, 0.75, 1.00])
  })
})

// ── computeInstalments ─────────────────────────────────────────────────────────

const MILESTONES = advanceTaxMilestones(FY)

// Stand-in for the real #77 pipeline truncated to each milestone's date —
// the running cumulative tax liability at each checkpoint.
const LIABILITY_AT: Record<string, number> = {
  '2025-06-15': 5_000,
  '2025-09-15': 20_000,
  '2025-12-15': 20_000,
  '2026-03-15': 40_000,
}
const liabilityAsOf = (date: string) => LIABILITY_AT[date] ?? 0

describe('computeInstalments', () => {
  it('target is the s.211 cumulative percentage of the running liability at each date, not 100% of it', () => {
    const paid: AdvanceTaxPaid = { jun: 0, sep: 0, dec: 0, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2026-03-15')
    // 15%*5,000=750, 45%*20,000=9,000, 75%*20,000=15,000, 100%*40,000=40,000
    expect(results.map(r => r.target)).toEqual([750, 9_000, 15_000, 40_000])
  })

  it('shortfall = target - paid, and 234C interest = 1%/month x shortfall x months-for-that-quarter', () => {
    const paid: AdvanceTaxPaid = { jun: 0, sep: 5_000, dec: 10_000, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2026-01-01')

    const [jun, sep, dec, mar] = results
    expect(jun.shortfall).toBe(750)                      // 750 - 0
    expect(jun.interest).toBeCloseTo(750 * 0.01 * 3)      // 22.5

    expect(sep.shortfall).toBe(4_000)                     // 9,000 - 5,000
    expect(sep.interest).toBeCloseTo(4_000 * 0.01 * 3)    // 120

    expect(dec.shortfall).toBe(5_000)                     // 15,000 - 10,000
    expect(dec.interest).toBeCloseTo(5_000 * 0.01 * 3)    // 150

    // asOfToday (1 Jan) is before Mar's due date — not yet due.
    expect(mar.isPast).toBe(false)
    expect(mar.shortfall).toBe(0)
    expect(mar.interest).toBe(0)
  })

  it('a milestone before its due date never accrues shortfall/interest even if underpaid', () => {
    const paid: AdvanceTaxPaid = { jun: 0, sep: 0, dec: 0, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2025-05-01')
    for (const r of results) {
      expect(r.isPast).toBe(false)
      expect(r.shortfall).toBe(0)
      expect(r.interest).toBe(0)
    }
  })

  it('a later quarter\'s payment never retroactively erases an earlier quarter\'s shortfall', () => {
    const basePaid: AdvanceTaxPaid = { jun: 0, sep: 10_000, dec: 20_000, mar: 0 }
    const withMarPaid: AdvanceTaxPaid = { ...basePaid, mar: 40_000 }

    const a = computeInstalments(MILESTONES, liabilityAsOf, basePaid, '2026-03-15')
    const b = computeInstalments(MILESTONES, liabilityAsOf, withMarPaid, '2026-03-15')

    // Jun/Sep/Dec results are identical regardless of what Mar's paid figure is.
    expect(b[0]).toEqual(a[0])
    expect(b[1]).toEqual(a[1])
    expect(b[2]).toEqual(a[2])
    // Only Mar itself changes.
    expect(b[3].shortfall).toBe(0)
    expect(a[3].shortfall).toBe(40_000)
  })

  it('overpaying does not go negative — shortfall floors at 0', () => {
    const paid: AdvanceTaxPaid = { jun: 50_000, sep: 0, dec: 0, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2025-06-15')
    expect(results[0].shortfall).toBe(0)
    expect(results[0].interest).toBe(0)
  })
})

// ── shouldSuppressInstalments ───────────────────────────────────────────────────

describe('shouldSuppressInstalments', () => {
  it('suppresses below the s.208 10,000 threshold', () => {
    expect(shouldSuppressInstalments(0)).toBe(true)
    expect(shouldSuppressInstalments(9_999.99)).toBe(true)
  })

  it('shows the section at or above the threshold', () => {
    expect(shouldSuppressInstalments(10_000)).toBe(false)
    expect(shouldSuppressInstalments(15_000)).toBe(false)
  })
})

// ── buildLiabilityAsOf ───────────────────────────────────────────────────────

const NO_CF = { shortTerm: 0, longTerm: 0 }
const FY_START = '2025-04-01'

function stkBuy(date: string, qty: number, price: number): Transaction {
  return { id: Math.random().toString(), symbol: 'ITC', exchange: 'NSE', trade_date: date, trade_type: 'buy', quantity: qty, price, amount: qty * price, fy_id: null, notes: '' }
}
function stkSell(date: string, qty: number, price: number): Transaction {
  return { id: Math.random().toString(), symbol: 'ITC', exchange: 'NSE', trade_date: date, trade_type: 'sell', quantity: qty, price, amount: qty * price, fy_id: null, notes: '' }
}
function mfBuy(date: string, units: number, nav: number): MFTransaction {
  return { id: Math.random().toString(), fund_id: 'f1', trade_date: date, trade_type: 'buy', units, nav, amount: units * nav }
}
function mfSell(date: string, units: number, nav: number): MFTransaction {
  return { id: Math.random().toString(), fund_id: 'f1', trade_date: date, trade_type: 'sell', units, nav, amount: units * nav }
}
function gldBuy(date: string, grams: number, price: number, goldType: 'sgb' | 'etf' | 'physical'): SGBTransaction {
  return { id: Math.random().toString(), trade_date: date, trade_type: 'buy', grams, price_per_gram: price, amount: grams * price, maturity_date: null, gold_type: goldType, name: null }
}
function gldSell(date: string, grams: number, price: number, goldType: 'sgb' | 'etf' | 'physical'): SGBTransaction {
  return { id: Math.random().toString(), trade_date: date, trade_type: 'sell', grams, price_per_gram: price, amount: grams * price, maturity_date: null, gold_type: goldType, name: null }
}
function dividend(exDate: string, amount: number): DividendTransaction {
  return { id: Math.random().toString(), symbol: 'ITC', exchange: 'NSE', ex_date: exDate, per_share: amount, shares: 1, amount }
}

const DEBT_FUND: MFund = { id: 'f1', scheme_code: 'C1', scheme_name: 'ABC Debt Fund', scheme_type: 'Debt' }
const EMPTY_MAP = new Map<string, never[]>()

describe('buildLiabilityAsOf', () => {
  it('only counts sells through the cutoff date, not ones after it', () => {
    // Both sells are well within 365 days of the buy, so both are STCG —
    // avoids the 1.25L LTCG exemption masking the truncation effect.
    const stockMap = new Map([['ITC', [
      stkBuy('2025-04-10', 100, 100),
      stkSell('2025-05-01', 50, 300),   // gain 10,000, before the cutoff
      stkSell('2025-08-01', 50, 300),   // gain 10,000, after the cutoff
    ]]])
    const liabilityAsOf = buildLiabilityAsOf({
      stockMap, mfMap: EMPTY_MAP, mfFunds: [], goldMap: EMPTY_MAP, dividends: [],
      fyStart: FY_START, incomingCarryForward: NO_CF, slabRatePct: 30,
    })

    // Only the first sell: 10,000 * 20% = 2,000 + 4% cess = 2,080.
    expect(liabilityAsOf('2025-06-15')).toBeCloseTo(2_080)
    // Both sells: 20,000 * 20% = 4,000 + 4% cess = 4,160.
    expect(liabilityAsOf('2025-09-15')).toBeCloseTo(4_160)
  })

  it('folds debt MF and gold ETF sells into the debt bucket; sgb/physical gold is excluded', () => {
    const mfMap = new Map([['f1', [mfBuy('2025-04-05', 1_000, 10), mfSell('2025-05-01', 1_000, 11)]]])
    const goldMap = new Map([
      ['etf',      [gldBuy('2025-04-01', 10, 5_000, 'etf'),      gldSell('2025-05-01', 10, 5_100, 'etf')]],
      ['sgb',      [gldBuy('2025-04-01', 10, 5_000, 'sgb'),      gldSell('2025-05-01', 10, 15_000, 'sgb')]],       // huge gain, must not count
      ['physical', [gldBuy('2025-04-01', 10, 5_000, 'physical'), gldSell('2025-05-01', 10, 15_000, 'physical')]],  // huge gain, must not count
    ])
    const liabilityAsOf = buildLiabilityAsOf({
      stockMap: EMPTY_MAP, mfMap, mfFunds: [DEBT_FUND], goldMap, dividends: [],
      fyStart: FY_START, incomingCarryForward: NO_CF, slabRatePct: 30,
    })

    // Debt MF gain 1,000 + ETF gain 1,000 = 2,000 debt STCG (s.50AA slab-only
    // cutoff on the MF; ETF has no such cutoff but is well under 24 months
    // either way). Taxed at the 30% slab: 600 + 4% cess = 624.
    expect(liabilityAsOf('2025-06-15')).toBeCloseTo(624)
  })

  it('dividend income is truncated to the cutoff date and credited via TDS', () => {
    const dividends = [dividend('2025-04-15', 5_000), dividend('2025-07-01', 3_000)]
    const liabilityAsOf = buildLiabilityAsOf({
      stockMap: EMPTY_MAP, mfMap: EMPTY_MAP, mfFunds: [], goldMap: EMPTY_MAP, dividends,
      fyStart: FY_START, incomingCarryForward: NO_CF, slabRatePct: 30,
    })

    // 5,000 @ 30% slab = 1,500 + 4% cess = 1,560, minus 10% TDS (500) = 1,060.
    expect(liabilityAsOf('2025-06-15')).toBeCloseTo(1_060)
    // 8,000 @ 30% = 2,400 + cess 96 = 2,496, minus TDS 800 = 1,696.
    expect(liabilityAsOf('2025-09-15')).toBeCloseTo(1_696)
  })

  it('applies incoming carryforward before computing liability', () => {
    const stockMap = new Map([['ITC', [stkBuy('2025-04-10', 100, 100), stkSell('2025-05-01', 100, 200)]]])
    // gain = 100 * (200-100) = 10,000 STCG
    const withoutCF = buildLiabilityAsOf({
      stockMap, mfMap: EMPTY_MAP, mfFunds: [], goldMap: EMPTY_MAP, dividends: [],
      fyStart: FY_START, incomingCarryForward: NO_CF, slabRatePct: 30,
    })
    const withCF = buildLiabilityAsOf({
      stockMap, mfMap: EMPTY_MAP, mfFunds: [], goldMap: EMPTY_MAP, dividends: [],
      fyStart: FY_START, incomingCarryForward: { shortTerm: 4_000, longTerm: 0 }, slabRatePct: 30,
    })

    expect(withoutCF('2025-06-15')).toBeCloseTo(10_000 * 0.20 * 1.04)          // 2,080
    expect(withCF('2025-06-15')).toBeCloseTo((10_000 - 4_000) * 0.20 * 1.04)   // 1,248
  })
})
