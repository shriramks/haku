import { describe, it, expect } from 'vitest'
import { fyLabel, formatINR } from '../formatter'

describe('fyLabel — FY boundary (31-Mar / 01-Apr crossover)', () => {
  it('31 Mar 2025 is FY25 (last day of FY25)', () => {
    expect(fyLabel('2025-03-31')).toBe('FY25')
  })
  it('01 Apr 2025 is FY26 (first day of FY26)', () => {
    expect(fyLabel('2025-04-01')).toBe('FY26')
  })
  it('31 Mar 2026 is FY26 (last day of FY26)', () => {
    expect(fyLabel('2026-03-31')).toBe('FY26')
  })
  it('01 Apr 2026 is FY27 (first day of FY27)', () => {
    expect(fyLabel('2026-04-01')).toBe('FY27')
  })
})

describe('fyLabel — April-March fiscal year', () => {
  // FY26 = Apr 2025 → Mar 2026
  it('April 2025 is FY26', () => {
    expect(fyLabel('2025-04-01')).toBe('FY26')
  })
  it('March 2026 is FY26', () => {
    expect(fyLabel('2026-03-31')).toBe('FY26')
  })
  // FY25 = Apr 2024 → Mar 2025
  it('April 2024 is FY25', () => {
    expect(fyLabel('2024-04-01')).toBe('FY25')
  })
  it('March 2025 is FY25', () => {
    expect(fyLabel('2025-03-31')).toBe('FY25')
  })
  it('January 2025 is FY25 (mid-year)', () => {
    expect(fyLabel('2025-01-15')).toBe('FY25')
  })
  it('accepts Date objects', () => {
    expect(fyLabel(new Date('2025-06-15'))).toBe('FY26')
  })
})
