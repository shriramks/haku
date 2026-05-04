import { describe, it, expect } from 'vitest'
import { fyLabel, formatINRFine, formatPriceFine } from '../formatter'

const THIN = ' '

describe('formatINRFine — up to 2 decimal places, trailing zeros stripped', () => {
  it('1.32L — two significant decimals', () => {
    expect(formatINRFine(132_000)).toBe(`1.32${THIN}L`)
  })
  it('1.3L — second decimal zero, stripped', () => {
    expect(formatINRFine(130_000)).toBe(`1.3${THIN}L`)
  })
  it('1L — whole number, no decimals', () => {
    expect(formatINRFine(100_000)).toBe(`1${THIN}L`)
  })
  it('3.5L — one decimal', () => {
    expect(formatINRFine(350_000)).toBe(`3.5${THIN}L`)
  })
  it('84.2K — K range', () => {
    expect(formatINRFine(84_200)).toBe(`84.2${THIN}K`)
  })
  it('negatives preserved', () => {
    expect(formatINRFine(-132_000)).toBe(`-1.32${THIN}L`)
  })
  it('K range: 8.4K', () => {
    expect(formatINRFine(8_400)).toBe(`8.4${THIN}K`)
  })
})

describe('formatPriceFine — price with up to 2 decimal places', () => {
  it('whole number below 10k — no commas, no decimals', () => {
    expect(formatPriceFine(1284)).toBe('₹1284')
  })
  it('decimal below 10k — shown', () => {
    expect(formatPriceFine(529.38)).toBe('₹529.38')
  })
  it('trailing zero stripped', () => {
    expect(formatPriceFine(529.30)).toBe('₹529.3')
  })
  it('whole number above 10k — commas, no decimals', () => {
    expect(formatPriceFine(14800)).toBe('₹14,800')
  })
  it('decimal above 10k — commas + decimal', () => {
    expect(formatPriceFine(14800.50)).toBe('₹14,800.5')
  })
})

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
