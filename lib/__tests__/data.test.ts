import { describe, it, expect } from 'vitest'
import { getCurrentFY } from '../fy-utils'
import type { FiscalYear } from '../types'

function mkFY(label: string, start: string, end: string): FiscalYear {
  return {
    id: `fy-${label}`, user_id: 'u1', label,
    start_date: start, end_date: end,
    total_budget_inr: 1_000_000,
    unallocated_carryover_inr: null,
    deploy_capital_inr: null,
  }
}

const FY24 = mkFY('FY24', '2023-04-01', '2024-03-31')
const FY25 = mkFY('FY25', '2024-04-01', '2025-03-31')
const FY26 = mkFY('FY26', '2025-04-01', '2026-03-31')

describe('getCurrentFY', () => {
  it('returns null for empty array', () => {
    expect(getCurrentFY([])).toBeNull()
  })

  it('returns matching FY when fyParam matches a label', () => {
    expect(getCurrentFY([FY24, FY25, FY26], 'FY25')).toBe(FY25)
  })

  it('falls back to most recent FY when fyParam does not match', () => {
    expect(getCurrentFY([FY24, FY25, FY26], 'FY99')).toBe(FY26)
  })

  it('returns single-element array when fyParam does not match', () => {
    expect(getCurrentFY([FY25], 'FY99')).toBe(FY25)
  })

  it('finds current FY by today date when no fyParam', () => {
    // FY26 covers 2025-04-01 to 2026-03-31; today (2026-04-07) is in FY27 if it existed
    // Use a range that definitely contains today
    const fyNow = mkFY('FYNOW', '2020-01-01', '2099-12-31')
    expect(getCurrentFY([FY24, FY25, fyNow], undefined)).toBe(fyNow)
  })

  it('falls back to most recent FY when no FY contains today', () => {
    // All FYs are in the past (well before 2026-04-07)
    const oldFY1 = mkFY('OLD1', '2010-04-01', '2011-03-31')
    const oldFY2 = mkFY('OLD2', '2011-04-01', '2012-03-31')
    // Array is ordered ascending by start_date; most recent = last element
    const result = getCurrentFY([oldFY1, oldFY2], undefined)
    expect(result).toBe(oldFY2)
  })
})
