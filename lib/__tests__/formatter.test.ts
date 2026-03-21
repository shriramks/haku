import { describe, it, expect } from 'vitest'
import { fyLabel } from '../formatter'

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
