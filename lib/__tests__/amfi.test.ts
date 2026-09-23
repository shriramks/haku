import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseAmfiNavHistory, fetchAmfiNavHistory, isNavStale } from '../amfi'

// Trimmed real sample from AMFI's dated history report (DownloadNAVHistoryReport_Po.aspx)
// — same 8 fields as NAVAll.txt, but each scheme repeats once per date in range.
const NAV_HISTORY_SAMPLE = `Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date

Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )

PPFAS Mutual Fund

122639;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;INF879O01027;;89.71;18-Sep-2026
122639;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;INF879O01027;;90.53;19-Sep-2026
120716;UTI Nifty 50 Index Fund;Direct Plan;Growth;INF789F01XA0;;164.12;18-Sep-2026
120716;UTI Nifty 50 Index Fund;Direct Plan;Growth;INF789F01XA0;;164.89;19-Sep-2026
`

describe('parseAmfiNavHistory', () => {
  it('parses one row per scheme per date, not just the latest', () => {
    const rows = parseAmfiNavHistory(NAV_HISTORY_SAMPLE)
    expect(rows).toHaveLength(4)
    expect(rows).toContainEqual({ schemeCode: '122639', nav: 89.71, navDate: '2026-09-18' })
    expect(rows).toContainEqual({ schemeCode: '122639', nav: 90.53, navDate: '2026-09-19' })
    expect(rows).toContainEqual({ schemeCode: '120716', nav: 164.12, navDate: '2026-09-18' })
    expect(rows).toContainEqual({ schemeCode: '120716', nav: 164.89, navDate: '2026-09-19' })
  })

  it('ignores malformed rows without throwing', () => {
    const malformed = `123456;ISIN;-;Some Fund;Direct;Growth;not-a-number;21-Sep-2026\n`
    expect(() => parseAmfiNavHistory(malformed)).not.toThrow()
    expect(parseAmfiNavHistory(malformed)).toEqual([])
  })
})

describe('fetchAmfiNavHistory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests frmdt/todt formatted as DD-Mon-YYYY and parses the response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => NAV_HISTORY_SAMPLE,
    })
    vi.stubGlobal('fetch', mockFetch)

    const rows = await fetchAmfiNavHistory(new Date(2026, 8, 18), new Date(2026, 8, 19))

    expect(mockFetch).toHaveBeenCalledWith(
      'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=18-Sep-2026&todt=19-Sep-2026'
    )
    expect(rows).toHaveLength(4)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(fetchAmfiNavHistory(new Date(2026, 8, 18), new Date(2026, 8, 19))).rejects.toThrow('503')
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

  it('is true when the feed is stuck multiple days behind', () => {
    expect(isNavStale('2026-09-18', new Date('2026-09-23T12:00:00'))).toBe(true)
  })

  // getMFNavHistory (lib/data.ts) reuses isNavStale a second time, anchored on
  // the fund's own latest nav_date instead of "today" — to check the stored
  // previous-NAV row is genuinely ~1 trading day back, not a stale gap. See #118.
  it('anchored on another NAV date (not today), catches a lagging previous-NAV', () => {
    expect(isNavStale('2026-09-17', new Date('2026-09-21T00:00:00'), 3)).toBe(true)
  })

  it('anchored on another NAV date, tolerates a genuine 1-day-back previous-NAV', () => {
    expect(isNavStale('2026-09-20', new Date('2026-09-21T00:00:00'), 3)).toBe(false)
  })
})
