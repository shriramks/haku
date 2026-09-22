import { describe, it, expect } from 'vitest'
import { parseAmfiNavAll, isNavStale } from '../amfi'

// Trimmed real sample from https://portal.amfiindia.com/spages/NAVAll.txt
const NAV_ALL_SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Children's Fund - Childrens' Fund)

Axis Mutual Fund

135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;29.9528;21-Sep-2026
135765;INF846K01WP8;-;Axis Children's Fund;Direct Plan;IDCW Option;27.5919;21-Sep-2026

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

PPFAS Mutual Fund

122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;90.5324;21-Sep-2026
120716;INF789F01XA0;-;UTI Nifty 50 Index Fund;Direct Plan;Growth;164.893;18-Sep-2026
`

describe('parseAmfiNavAll', () => {
  it('parses data rows into scheme_code -> {nav, date}', () => {
    const result = parseAmfiNavAll(NAV_ALL_SAMPLE)
    expect(result.get('122639')).toEqual({ nav: 90.5324, date: '2026-09-21' })
    expect(result.get('120716')).toEqual({ nav: 164.893, date: '2026-09-18' })
    expect(result.get('135762')).toEqual({ nav: 29.9528, date: '2026-09-21' })
  })

  it('skips header, blank, category, and fund-house lines', () => {
    const result = parseAmfiNavAll(NAV_ALL_SAMPLE)
    expect(result.size).toBe(4)
  })

  it('ignores malformed rows without throwing', () => {
    const malformed = `123456;ISIN;-;Some Fund;Direct;Growth;not-a-number;21-Sep-2026\n789012;ISIN;-;Other Fund;Direct;Growth;10.5;not-a-date\n`
    expect(() => parseAmfiNavAll(malformed)).not.toThrow()
    expect(parseAmfiNavAll(malformed).size).toBe(0)
  })
})

describe('isNavStale', () => {
  it('is false for today\'s NAV', () => {
    expect(isNavStale('2026-09-21', new Date('2026-09-21T12:00:00'))).toBe(false)
  })

  it('is false across an ordinary weekend gap', () => {
    // Friday's NAV, checked Monday — a normal 3-calendar-day, 1-trading-day gap.
    expect(isNavStale('2026-09-18', new Date('2026-09-21T12:00:00'))).toBe(false)
  })

  it('is true when the feed is stuck multiple days behind (the mfapi.in bug this guards)', () => {
    expect(isNavStale('2026-09-18', new Date('2026-09-23T12:00:00'))).toBe(true)
  })
})
