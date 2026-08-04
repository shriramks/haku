import { describe, it, expect } from 'vitest'
import { fyEndYear, fyDateRange, fiscalQuarterLabel, isFYClosed } from '../fy-utils'
import type { FiscalYear } from '../types'

describe('fyEndYear — Indian FY runs Apr–Mar', () => {
  it('April onwards belongs to the FY ending next year', () => {
    expect(fyEndYear(new Date('2025-04-01'))).toBe(2026)
    expect(fyEndYear(new Date('2025-12-31'))).toBe(2026)
  })
  it('Jan–Mar belongs to the FY ending this year', () => {
    expect(fyEndYear(new Date('2026-01-15'))).toBe(2026)
    expect(fyEndYear(new Date('2026-03-31'))).toBe(2026)
  })
})

describe('fyDateRange', () => {
  it('mid-FY date maps to Apr 1 – Mar 31', () => {
    expect(fyDateRange('2025-06-12')).toEqual({ start: '2025-04-01', end: '2026-03-31' })
  })
  it('Q4 date maps to the same FY as the preceding April', () => {
    expect(fyDateRange('2026-02-01')).toEqual({ start: '2025-04-01', end: '2026-03-31' })
  })
  it('accepts a Date object', () => {
    expect(fyDateRange(new Date('2024-04-01'))).toEqual({ start: '2024-04-01', end: '2025-03-31' })
  })
})

describe('fiscalQuarterLabel', () => {
  it('Apr–Jun is Q1 of the FY ending next year', () => {
    expect(fiscalQuarterLabel(new Date('2025-05-10'))).toBe('FY26 Q1')
  })
  it('Jul–Sep is Q2', () => {
    expect(fiscalQuarterLabel(new Date('2025-08-10'))).toBe('FY26 Q2')
  })
  it('Oct–Dec is Q3', () => {
    expect(fiscalQuarterLabel(new Date('2025-11-10'))).toBe('FY26 Q3')
  })
  it('Jan–Mar is Q4 of the FY ending this year', () => {
    expect(fiscalQuarterLabel(new Date('2026-02-10'))).toBe('FY26 Q4')
  })
})

describe('isFYClosed', () => {
  const FY: FiscalYear = {
    id: 'fy1', label: 'FY25-26', start_date: '2025-04-01', end_date: '2026-03-31',
    total_budget_inr: 0, unallocated_carryover_inr: null, deploy_capital_inr: null,
  }

  it('open while asOfDate is on or before end_date', () => {
    expect(isFYClosed(FY, '2026-03-31')).toBe(false)
    expect(isFYClosed(FY, '2025-06-01')).toBe(false)
  })

  it('closed once asOfDate is after end_date', () => {
    expect(isFYClosed(FY, '2026-04-01')).toBe(true)
  })
})
