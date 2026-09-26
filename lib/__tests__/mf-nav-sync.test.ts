import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { fetchAmfiNavHistory } = vi.hoisted(() => ({ fetchAmfiNavHistory: vi.fn() }))

// Keep the real isNavStale (latestNavRows depends on it); only the network call is faked.
vi.mock('../amfi', async importOriginal => ({
  ...(await importOriginal<typeof import('../amfi')>()),
  fetchAmfiNavHistory,
}))

import { latestNavRows, syncMfNav } from '../mf-nav-sync'

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

function makeService({
  funds = [{ scheme_code: '1' }, { scheme_code: '2' }] as { scheme_code: string }[],
  fundError = null as { message: string } | null,
  upsertError = null as { message: string } | null,
} = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const select = vi.fn().mockResolvedValue({ data: fundError ? null : funds, error: fundError })
  const from = vi.fn((table: string) => (table === 'mf_funds' ? { select } : { upsert }))
  return { service: { from } as unknown as SupabaseClient, from, select, upsert }
}

describe('syncMfNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches a 10-day window ending now', async () => {
    fetchAmfiNavHistory.mockResolvedValue([])
    const now = new Date(2026, 8, 26, 12)
    await syncMfNav(makeService().service, now)
    const [from, to] = fetchAmfiNavHistory.mock.calls[0]
    expect(to).toBe(now)
    expect(from).toEqual(new Date(2026, 8, 16, 12))
  })

  it("upserts one mf_navs row per known scheme, keyed on scheme_code, from every user's funds", async () => {
    fetchAmfiNavHistory.mockResolvedValue([
      row('1', '2026-09-25', 50), row('1', '2026-09-24', 49),
      row('2', '2026-09-25', 10),
      row('9', '2026-09-25', 7),
    ])
    const { service, from, select, upsert } = makeService()

    await syncMfNav(service)

    expect(from).toHaveBeenCalledWith('mf_funds')
    expect(select).toHaveBeenCalledWith('scheme_code')
    expect(from).toHaveBeenCalledWith('mf_navs')
    const [rows, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'scheme_code' })
    expect(rows).toEqual([
      { scheme_code: '1', nav: 50, prev_nav: 49, nav_date: '2026-09-25' },
      { scheme_code: '2', nav: 10, prev_nav: null, nav_date: '2026-09-25' },
    ])
  })

  it('does not write when AMFI returned nothing for a known scheme', async () => {
    fetchAmfiNavHistory.mockResolvedValue([row('9', '2026-09-25', 7)])
    const { service, upsert } = makeService()
    await syncMfNav(service)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the AMFI fetch fails, without touching the table', async () => {
    fetchAmfiNavHistory.mockRejectedValue(new Error('AMFI NAV history fetch failed: 503'))
    const { service, upsert } = makeService()
    await expect(syncMfNav(service)).rejects.toThrow('503')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the mf_funds read fails', async () => {
    fetchAmfiNavHistory.mockResolvedValue([row('1', '2026-09-25', 50)])
    const { service, upsert } = makeService({ fundError: { message: 'db down' } })
    await expect(syncMfNav(service)).rejects.toThrow('db down')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws when the upsert fails', async () => {
    fetchAmfiNavHistory.mockResolvedValue([row('1', '2026-09-25', 50)])
    const { service } = makeService({ upsertError: { message: 'boom' } })
    await expect(syncMfNav(service)).rejects.toThrow('boom')
  })
})
