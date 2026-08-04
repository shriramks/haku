import { describe, it, expect } from 'vitest'
import {
  advanceTaxMilestones, computeInstalments, shouldSuppressInstalments,
} from '../advance-tax'
import type { FiscalYear } from '../types'
import type { AdvanceTaxPaid } from '../advance-tax'

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
  it('target is 100% of the running liability at each date, not a % of it', () => {
    const paid: AdvanceTaxPaid = { jun: 0, sep: 0, dec: 0, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2026-03-15')
    expect(results.map(r => r.target)).toEqual([5_000, 20_000, 20_000, 40_000])
  })

  it('shortfall = target - paid, and 234C interest = 1%/month x shortfall x months-for-that-quarter', () => {
    const paid: AdvanceTaxPaid = { jun: 0, sep: 10_000, dec: 20_000, mar: 0 }
    const results = computeInstalments(MILESTONES, liabilityAsOf, paid, '2026-01-01')

    const [jun, sep, dec, mar] = results
    expect(jun.shortfall).toBe(5_000)
    expect(jun.interest).toBeCloseTo(5_000 * 0.01 * 3)   // 150

    expect(sep.shortfall).toBe(10_000)
    expect(sep.interest).toBeCloseTo(10_000 * 0.01 * 3)  // 300

    expect(dec.shortfall).toBe(0)
    expect(dec.interest).toBe(0)

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
