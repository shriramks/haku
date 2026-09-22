import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseAmfiNavAll, parseAmfiNavHistory, fetchAmfiNavHistory, isNavStale, parseMfapiDate, fetchMfapiHistory } from '../amfi'

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

  it('is true when the feed is stuck multiple days behind (the mfapi.in bug this guards)', () => {
    expect(isNavStale('2026-09-18', new Date('2026-09-23T12:00:00'))).toBe(true)
  })

  // PortfolioClient.tsx reuses isNavStale a second time, anchored on AMFI's own
  // date instead of "today," with maxDays=3 (no holiday grace) — to check
  // mfapi.in's previous-NAV is genuinely ~1 trading day before AMFI's current,
  // not "today" itself. See #114.
  it('anchored on another NAV date (not today), catches a lagging previous-NAV', () => {
    // The live case that prompted this: AMFI fresh at 21-Sep, mfapi.in's
    // previous-NAV still dated 17-Sep — a 4-day gap, not a genuine 1-day move.
    expect(isNavStale('2026-09-17', new Date('2026-09-21T00:00:00'), 3)).toBe(true)
  })

  it('anchored on another NAV date, tolerates a genuine 1-day-back previous-NAV', () => {
    expect(isNavStale('2026-09-20', new Date('2026-09-21T00:00:00'), 3)).toBe(false)
  })
})

describe('parseMfapiDate', () => {
  it('parses mfapi.in\'s DD-MM-YYYY format', () => {
    expect(parseMfapiDate('18-09-2026')).toBe('2026-09-18')
  })

  it('returns null for an unrecognised format', () => {
    expect(parseMfapiDate('18-Sep-2026')).toBeNull()
    expect(parseMfapiDate('not-a-date')).toBeNull()
  })
})

describe('fetchMfapiHistory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses the latest and previous NAV entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        data: [
          { date: '18-09-2026', nav: '89.85690' },
          { date: '17-09-2026', nav: '89.71690' },
        ],
      }),
    }))
    const result = await fetchMfapiHistory('122639')
    expect(result).toEqual({ nav: 89.8569, date: '2026-09-18', prevNav: 89.7169, prevDate: '2026-09-17' })
  })

  it('returns all-null on fetch failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const result = await fetchMfapiHistory('122639')
    expect(result).toEqual({ nav: null, date: null, prevNav: null, prevDate: null })
  })

  it('passes an AbortController signal so a hang can be cut short', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) })
    vi.stubGlobal('fetch', mockFetch)
    await fetchMfapiHistory('122639')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.mfapi.in/mf/122639',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })
})
