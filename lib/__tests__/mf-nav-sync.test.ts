import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { fetchAmfiNavHistory, fetchAmfiLatestNavs } = vi.hoisted(() => ({
  fetchAmfiNavHistory: vi.fn(),
  fetchAmfiLatestNavs: vi.fn(),
}))

// Keep the real isNavStale (latestNavRows depends on it); only the network calls are faked.
vi.mock('../amfi', async importOriginal => ({
  ...(await importOriginal<typeof import('../amfi')>()),
  fetchAmfiNavHistory,
  fetchAmfiLatestNavs,
}))

import { latestNavRows, planNavUpdates, syncMfNav, type MfNavRow } from '../mf-nav-sync'

const row = (schemeCode: string, navDate: string, nav: number) => ({ schemeCode, navDate, nav })
const codes = (...c: string[]) => new Set(c)

describe('latestNavRows', () => {
  it('takes the newest NAV and the one before it', () => {
    expect(latestNavRows([row('1', '2026-09-22', 50), row('1', '2026-09-21', 49)], codes('1'))).toEqual([
      { scheme_code: '1', nav: 50, prev_nav: 49, nav_date: '2026-09-22' },
    ])
  })

  it('does not depend on the input row order', () => {
    const rows = [row('1', '2026-09-19', 48), row('1', '2026-09-22', 50), row('1', '2026-09-21', 49)]
    expect(latestNavRows(rows, codes('1'))).toEqual([
      { scheme_code: '1', nav: 50, prev_nav: 49, nav_date: '2026-09-22' },
    ])
  })

  it('accepts a weekend gap of 3 days as a genuine previous NAV', () => {
    const [r] = latestNavRows([row('1', '2026-09-22', 50), row('1', '2026-09-19', 49)], codes('1'))
    expect(r.prev_nav).toBe(49)
  })

  it('nulls prev_nav when the two newest rows are more than 4 days apart', () => {
    const [r] = latestNavRows([row('1', '2026-09-22', 50), row('1', '2026-09-10', 45)], codes('1'))
    expect(r).toEqual({ scheme_code: '1', nav: 50, prev_nav: null, nav_date: '2026-09-22' })
  })

  it('leaves prev_nav null when the scheme has a single row', () => {
    const [r] = latestNavRows([row('1', '2026-09-22', 50)], codes('1'))
    expect(r.prev_nav).toBeNull()
  })

  it('ignores rows older than the previous one', () => {
    const rows = [row('1', '2026-09-22', 50), row('1', '2026-09-19', 49), row('1', '2026-09-18', 999)]
    expect(latestNavRows(rows, codes('1'))[0].prev_nav).toBe(49)
  })

  it('treats a repeated date as one row, never as the previous NAV', () => {
    const rows = [row('1', '2026-09-22', 50), row('1', '2026-09-22', 50), row('1', '2026-09-21', 49)]
    expect(latestNavRows(rows, codes('1'))[0].prev_nav).toBe(49)
    expect(latestNavRows([row('1', '2026-09-22', 50), row('1', '2026-09-22', 50)], codes('1'))[0].prev_nav).toBeNull()
  })

  it('keeps schemes independent and drops schemes that are not in mf_funds', () => {
    const rows = [
      row('1', '2026-09-22', 50), row('1', '2026-09-21', 49),
      row('2', '2026-09-21', 10),
      row('3', '2026-09-22', 999),
    ]
    const out = latestNavRows(rows, codes('1', '2'))
    expect(out.map(r => r.scheme_code).sort()).toEqual(['1', '2'])
    expect(out.find(r => r.scheme_code === '2')).toEqual({ scheme_code: '2', nav: 10, prev_nav: null, nav_date: '2026-09-21' })
  })

  it('produces nothing for a scheme with no row in the window', () => {
    expect(latestNavRows([row('1', '2026-09-22', 50)], codes('1', '2'))).toHaveLength(1)
    expect(latestNavRows([], codes('1'))).toEqual([])
  })
})

const saved = (schemeCode: string, navDate: string, nav: number, prevNav: number | null = null): MfNavRow =>
  ({ scheme_code: schemeCode, nav, prev_nav: prevNav, nav_date: navDate })

// 2026-09-25 is a Friday, 2026-09-28 the Monday after.
describe('planNavUpdates', () => {
  const plan = (feed: ReturnType<typeof row>[], savedRows: MfNavRow[], ...c: string[]) =>
    planNavUpdates(feed, savedRows, codes(...c))

  it('skips a scheme whose feed date equals the saved date', () => {
    expect(plan([row('1', '2026-09-25', 50)], [saved('1', '2026-09-25', 50, 49)], '1')).toEqual({ rolled: [], fallback: new Set() })
  })

  it('skips a scheme whose feed date is older than the saved date', () => {
    expect(plan([row('1', '2026-09-24', 49)], [saved('1', '2026-09-25', 50)], '1')).toEqual({ rolled: [], fallback: new Set() })
  })

  it('rolls forward when the feed is exactly 1 day after the saved date', () => {
    expect(plan([row('1', '2026-09-25', 51)], [saved('1', '2026-09-24', 50, 49)], '1').rolled).toEqual([
      { scheme_code: '1', nav: 51, prev_nav: 50, nav_date: '2026-09-25' },
    ])
  })

  it('rolls forward Friday → Monday', () => {
    const out = plan([row('1', '2026-09-28', 51)], [saved('1', '2026-09-25', 50)], '1')
    expect(out.rolled).toEqual([{ scheme_code: '1', nav: 51, prev_nav: 50, nav_date: '2026-09-28' }])
    expect(out.fallback.size).toBe(0)
  })

  it('does not treat a 3-day gap from a non-Friday as consecutive (Tue → Fri)', () => {
    const out = plan([row('1', '2026-09-25', 51)], [saved('1', '2026-09-22', 50)], '1')
    expect(out.rolled).toEqual([])
    expect(out.fallback).toEqual(new Set(['1']))
  })

  it('falls back on a wider gap: a skipped tap day would mislabel a 2-day move as 1D (Tue → Thu)', () => {
    const out = plan([row('1', '2026-09-24', 51)], [saved('1', '2026-09-22', 50)], '1')
    expect(out.rolled).toEqual([])
    expect(out.fallback).toEqual(new Set(['1']))
  })

  it('falls back when Friday → Tuesday spans a Monday holiday', () => {
    expect(plan([row('1', '2026-09-29', 51)], [saved('1', '2026-09-25', 50)], '1').fallback).toEqual(new Set(['1']))
  })

  it('falls back for a scheme with no saved row', () => {
    expect(plan([row('1', '2026-09-25', 50)], [], '1')).toEqual({ rolled: [], fallback: new Set(['1']) })
  })

  it('leaves a scheme absent from the feed alone', () => {
    expect(plan([row('1', '2026-09-25', 50)], [saved('2', '2026-09-24', 9)], '1', '2')).toEqual({
      rolled: [],
      fallback: new Set(['1']),
    })
  })

  it('ignores feed schemes that are not in mf_funds', () => {
    expect(plan([row('9', '2026-09-25', 7)], [], '1')).toEqual({ rolled: [], fallback: new Set() })
  })

  it('decides each scheme independently', () => {
    const out = plan(
      [row('1', '2026-09-25', 51), row('2', '2026-09-25', 10), row('3', '2026-09-25', 30)],
      [saved('1', '2026-09-24', 50), saved('2', '2026-09-25', 10), saved('3', '2026-09-22', 29)],
      '1', '2', '3',
    )
    expect(out.rolled.map(r => r.scheme_code)).toEqual(['1'])
    expect(out.fallback).toEqual(new Set(['3']))
  })
})

function makeService({
  funds = [{ scheme_code: '1' }, { scheme_code: '2' }] as { scheme_code: string }[],
  navs = [] as { scheme_code: string; nav: number | string; prev_nav: number | string | null; nav_date: string }[],
  fundError = null as { message: string } | null,
  navsError = null as { message: string } | null,
  upsertError = null as { message: string } | null,
} = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const fundSelect = vi.fn().mockResolvedValue({ data: fundError ? null : funds, error: fundError })
  const inFn = vi.fn().mockResolvedValue({ data: navsError ? null : navs, error: navsError })
  const navSelect = vi.fn(() => ({ in: inFn }))
  const from = vi.fn((table: string) => (table === 'mf_funds' ? { select: fundSelect } : { select: navSelect, upsert }))
  return { service: { from } as unknown as SupabaseClient, from, fundSelect, navSelect, inFn, upsert }
}

describe('syncMfNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAmfiNavHistory.mockResolvedValue([])
  })

  it("reads every user's funds, then the saved rows for exactly those schemes", async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50)])
    const { service, from, fundSelect, navSelect, inFn } = makeService({ navs: [saved('1', '2026-09-25', 50)] })

    await syncMfNav(service)

    expect(from).toHaveBeenCalledWith('mf_funds')
    expect(fundSelect).toHaveBeenCalledWith('scheme_code')
    expect(from).toHaveBeenCalledWith('mf_navs')
    expect(navSelect).toHaveBeenCalledWith('scheme_code, nav, prev_nav, nav_date')
    expect(inFn).toHaveBeenCalledWith('scheme_code', ['1', '2'])
  })

  it('rolls forward from the feed alone — no history window when nothing needs one', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 51), row('2', '2026-09-25', 10), row('9', '2026-09-25', 7)])
    const { service, upsert } = makeService({
      navs: [saved('1', '2026-09-24', 50, 49), saved('2', '2026-09-25', 10, 9.9)],
    })

    await syncMfNav(service)

    expect(fetchAmfiNavHistory).not.toHaveBeenCalled()
    const [rows, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'scheme_code' })
    expect(rows).toEqual([{ scheme_code: '1', nav: 51, prev_nav: 50, nav_date: '2026-09-25' }])
  })

  it('coerces numeric strings from the saved read before using them as prev_nav', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 51)])
    const { service, upsert } = makeService({ navs: [{ scheme_code: '1', nav: '50.1234', prev_nav: null, nav_date: '2026-09-24' }] })
    await syncMfNav(service)
    expect(upsert.mock.calls[0][0]).toEqual([{ scheme_code: '1', nav: 51, prev_nav: 50.1234, nav_date: '2026-09-25' }])
  })

  it('writes nothing when every scheme is already current', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50), row('2', '2026-09-25', 10)])
    const { service, upsert } = makeService({ navs: [saved('1', '2026-09-25', 50), saved('2', '2026-09-25', 10)] })
    await syncMfNav(service)
    expect(fetchAmfiNavHistory).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('fetches the 10-day window ending now, only for schemes the fast path could not settle', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 51), row('2', '2026-09-25', 10)])
    // Scheme 2 was last saved Tue → a Thu-sized gap, so it needs the exact window.
    fetchAmfiNavHistory.mockResolvedValue([
      row('1', '2026-09-25', 51), row('1', '2026-09-24', 50),
      row('2', '2026-09-25', 10), row('2', '2026-09-24', 9.9),
    ])
    const { service, upsert } = makeService({ navs: [saved('1', '2026-09-24', 50), saved('2', '2026-09-22', 9.5)] })
    const now = new Date(2026, 8, 26, 12)

    await syncMfNav(service, now)

    const [from, to] = fetchAmfiNavHistory.mock.calls[0]
    expect(to).toBe(now)
    expect(from).toEqual(new Date(2026, 8, 16, 12))
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual([
      { scheme_code: '1', nav: 51, prev_nav: 50, nav_date: '2026-09-25' },
      { scheme_code: '2', nav: 10, prev_nav: 9.9, nav_date: '2026-09-25' },
    ])
  })

  it('takes a scheme with no saved row from the window, with its own previous NAV', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50)])
    fetchAmfiNavHistory.mockResolvedValue([row('1', '2026-09-25', 50), row('1', '2026-09-24', 49)])
    const { service, upsert } = makeService()
    await syncMfNav(service)
    expect(upsert.mock.calls[0][0]).toEqual([{ scheme_code: '1', nav: 50, prev_nav: 49, nav_date: '2026-09-25' }])
  })

  it('does not write when the window has nothing for the fallback schemes', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50)])
    fetchAmfiNavHistory.mockResolvedValue([row('9', '2026-09-25', 7)])
    const { service, upsert } = makeService()
    await syncMfNav(service)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('still saves the rolled-forward rows when the fallback window fetch fails, then throws', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 51), row('2', '2026-09-25', 10)])
    fetchAmfiNavHistory.mockRejectedValue(new Error('AMFI NAV history had no NAV rows'))
    const { service, upsert } = makeService({ navs: [saved('1', '2026-09-24', 50)] })

    await expect(syncMfNav(service)).rejects.toThrow('no NAV rows')

    expect(upsert.mock.calls[0][0]).toEqual([{ scheme_code: '1', nav: 51, prev_nav: 50, nav_date: '2026-09-25' }])
  })

  it('throws when the latest feed fails, without touching the table', async () => {
    fetchAmfiLatestNavs.mockRejectedValue(new Error('AMFI latest NAV fetch failed: 503'))
    const { service, upsert } = makeService()
    await expect(syncMfNav(service)).rejects.toThrow('503')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the mf_funds read fails', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50)])
    const { service, upsert } = makeService({ fundError: { message: 'db down' } })
    await expect(syncMfNav(service)).rejects.toThrow('db down')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the saved mf_navs read fails', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 50)])
    const { service, upsert } = makeService({ navsError: { message: 'navs down' } })
    await expect(syncMfNav(service)).rejects.toThrow('navs down')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the upsert fails', async () => {
    fetchAmfiLatestNavs.mockResolvedValue([row('1', '2026-09-25', 51)])
    const { service } = makeService({ navs: [saved('1', '2026-09-24', 50)], upsertError: { message: 'boom' } })
    await expect(syncMfNav(service)).rejects.toThrow('boom')
  })
})
