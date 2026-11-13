import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { fetchAmfiSchemes } = vi.hoisted(() => ({ fetchAmfiSchemes: vi.fn() }))

// Keep the real parser; only the network call is faked.
vi.mock('../amfi', async importOriginal => ({
  ...(await importOriginal<typeof import('../amfi')>()),
  fetchAmfiSchemes,
}))

import { parseAmfiSchemes } from '../amfi'
import {
  needsSchemeSync, searchTerms, schemeTypeLine, holdingName, syncMfSchemes, searchMfSchemes, SEARCH_LIMIT, SCHEME_STALE_DAYS,
} from '../mf-schemes'

// Trimmed from the real NAVAll.txt layout: category header, fund house, 8-field rows.
const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Debt Scheme - Liquid Fund)

Example Mutual Fund

100001;INF879O01068;-;Example Liquid Fund;Direct Plan;Growth;1586.6305;12-Nov-2026
100002;INF879O01035;-;Example Liquid Fund;Regular Plan;Growth Option;1573.1361;12-Nov-2026

Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )

122639;INF879O01027;-;Example Flexi Cap Fund;Direct Plan;Growth;89.71;12-Nov-2026
122639;INF879O01027;-;Duplicate Of Above;Direct Plan;Growth;1.00;12-Nov-2026
abc;INF;-;Bad Code Fund;Direct Plan;Growth;1.00;12-Nov-2026
`

describe('parseAmfiSchemes', () => {
  const schemes = parseAmfiSchemes(SAMPLE)

  it('gives each row the category header above it', () => {
    expect(schemes.find(s => s.schemeCode === '100001')?.schemeType).toBe('Debt Scheme - Liquid Fund')
    expect(schemes.find(s => s.schemeCode === '122639')?.schemeType).toBe('Equity Scheme - Flexi Cap Fund')
  })

  it('composes name, plan and option, dropping a trailing "Option"', () => {
    expect(schemes.find(s => s.schemeCode === '100001')?.schemeName).toBe('Example Liquid Fund - Direct Plan - Growth')
    expect(schemes.find(s => s.schemeCode === '100002')?.schemeName).toBe('Example Liquid Fund - Regular Plan - Growth')
  })

  it('keeps one entry per scheme code (first wins) and skips non-numeric codes', () => {
    expect(schemes.map(s => s.schemeCode)).toEqual(['100001', '100002', '122639'])
    expect(schemes.find(s => s.schemeCode === '122639')?.schemeName).toContain('Flexi Cap')
  })

  it('returns nothing for the HTML form page AMFI sometimes sends', () => {
    expect(parseAmfiSchemes('<html><form>nope</form></html>')).toEqual([])
  })
})

describe('needsSchemeSync', () => {
  const now = new Date('2026-11-13T10:00:00Z')
  it('syncs when never synced', () => expect(needsSchemeSync(null, now)).toBe(true))
  it('syncs when older than the stale window', () => {
    const old = new Date(now.getTime() - (SCHEME_STALE_DAYS + 1) * 86_400_000).toISOString()
    expect(needsSchemeSync(old, now)).toBe(true)
  })
  it('does not sync inside the window', () => {
    expect(needsSchemeSync(new Date(now.getTime() - 86_400_000).toISOString(), now)).toBe(false)
  })
  it('syncs on an unparseable timestamp rather than trusting it', () => expect(needsSchemeSync('garbage', now)).toBe(true))
})

describe('searchTerms', () => {
  it('lowercases and splits on whitespace', () => expect(searchTerms('  Parag   PARIKH liq ')).toEqual(['parag', 'parikh', 'liq']))
  it('drops LIKE wildcards and filter-syntax characters', () => expect(searchTerms('a%b_c,d(e)*')).toEqual(['a', 'b', 'c', 'd', 'e']))
  it('caps the number of terms', () => expect(searchTerms('a b c d e f g h')).toHaveLength(5))
})

describe('holdingName', () => {
  it('drops the Direct Plan - Growth suffix', () => {
    expect(holdingName('Example Liquid Fund - Direct Plan - Growth')).toBe('Example Liquid Fund')
  })
  it('keeps the suffix for Regular or IDCW variants', () => {
    expect(holdingName('Example Liquid Fund - Regular Plan - Growth')).toBe('Example Liquid Fund - Regular Plan - Growth')
    expect(holdingName('Example Liquid Fund - Direct Plan - Monthly IDCW Payout')).toBe('Example Liquid Fund - Direct Plan - Monthly IDCW Payout')
  })
  it('leaves an already-short name alone', () => expect(holdingName('Example Flexi Cap Fund')).toBe('Example Flexi Cap Fund'))
})

describe('schemeTypeLine', () => {
  it('shows debt for a liquid fund with its category', () => {
    expect(schemeTypeLine({ name: 'Example Liquid Fund - Direct Plan - Growth', type: 'Debt Scheme - Liquid Fund' }))
      .toBe('Debt · Liquid Fund')
  })
  it('files an arbitrage fund under debt, matching the Portfolio', () => {
    expect(schemeTypeLine({ name: 'Some Arbitrage Fund - Direct Plan - Growth', type: 'Hybrid Scheme - Arbitrage Fund' }))
      .toBe('Debt · Arbitrage Fund')
  })
  it('shows the class alone when AMFI gives a bare header with no category', () => {
    expect(schemeTypeLine({ name: 'Some Close Ended Fund', type: 'Growth' })).toBe('Equity')
  })
  it('shows equity for a flexi cap fund', () => {
    expect(schemeTypeLine({ name: 'Example Flexi Cap Fund', type: 'Equity Scheme - Flexi Cap Fund' })).toBe('Equity · Flexi Cap Fund')
  })
})

/** Minimal chainable fake of the supabase calls lib/mf-schemes makes. */
function fakeService(opts: { synced: string | null; results?: unknown[]; upsertError?: string }) {
  const upserts: unknown[][] = []
  const ilikes: [string, string][] = []
  let limit = 0
  const service = {
    from: () => ({
      select: (cols: string) => {
        if (cols === 'synced_at') {
          const q = {
            order: () => q,
            limit: async () => ({ data: opts.synced ? [{ synced_at: opts.synced }] : [], error: null }),
          }
          return q
        }
        const q = {
          ilike: (col: string, v: string) => { ilikes.push([col, v]); return q },
          order: () => q,
          limit: async (n: number) => { limit = n; return { data: opts.results ?? [], error: null } },
        }
        return q
      },
      upsert: async (rows: unknown[]) => {
        upserts.push(rows)
        return { error: opts.upsertError ? { message: opts.upsertError } : null }
      },
    }),
  } as unknown as SupabaseClient
  return { service, upserts, ilikes, getLimit: () => limit }
}

const now = new Date('2026-11-13T10:00:00Z')
const fresh = '2026-11-12T10:00:00Z'

describe('syncMfSchemes', () => {
  beforeEach(() => { fetchAmfiSchemes.mockReset() })

  it('upserts every scheme in chunks of 1000 with one shared timestamp', async () => {
    fetchAmfiSchemes.mockResolvedValue(
      Array.from({ length: 2500 }, (_, i) => ({ schemeCode: String(i), schemeName: `Fund ${i}`, schemeType: 'Debt Scheme - Liquid Fund' })),
    )
    const { service, upserts } = fakeService({ synced: null })
    await syncMfSchemes(service, now)
    expect(upserts.map(u => u.length)).toEqual([1000, 1000, 500])
    expect(upserts[0][0]).toEqual({ scheme_code: '0', scheme_name: 'Fund 0', scheme_type: 'Debt Scheme - Liquid Fund', synced_at: now.toISOString() })
  })

  it('throws on a database error', async () => {
    fetchAmfiSchemes.mockResolvedValue([{ schemeCode: '1', schemeName: 'F', schemeType: '' }])
    await expect(syncMfSchemes(fakeService({ synced: null, upsertError: 'boom' }).service, now)).rejects.toThrow('boom')
  })
})

describe('searchMfSchemes', () => {
  beforeEach(() => { fetchAmfiSchemes.mockReset() })

  it('ignores queries under 3 characters without touching the network', async () => {
    const { service } = fakeService({ synced: null })
    expect(await searchMfSchemes(service, 'pa', now)).toEqual([])
    expect(fetchAmfiSchemes).not.toHaveBeenCalled()
  })

  it('syncs first when the master is empty, then matches every term, limited', async () => {
    fetchAmfiSchemes.mockResolvedValue([{ schemeCode: '1', schemeName: 'F', schemeType: '' }])
    const { service, upserts, ilikes, getLimit } = fakeService({
      synced: null,
      results: [{ scheme_code: '100001', scheme_name: 'Example Liquid Fund - Direct Plan - Growth', scheme_type: 'Debt Scheme - Liquid Fund' }],
    })
    const out = await searchMfSchemes(service, 'Example liquid', now)
    expect(upserts).toHaveLength(1)
    expect(ilikes).toEqual([['scheme_name', '%example%'], ['scheme_name', '%liquid%']])
    expect(getLimit()).toBe(SEARCH_LIMIT)
    expect(out).toEqual([{ code: '100001', name: 'Example Liquid Fund - Direct Plan - Growth', type: 'Debt Scheme - Liquid Fund' }])
  })

  it('does not sync a fresh master', async () => {
    const { service } = fakeService({ synced: fresh })
    await searchMfSchemes(service, 'parag', now)
    expect(fetchAmfiSchemes).not.toHaveBeenCalled()
  })

  it('searches the stale list when a refresh fails, but throws when there is no list at all', async () => {
    fetchAmfiSchemes.mockImplementation(() => { throw new Error('AMFI down') })
    const stale = '2026-10-01T00:00:00Z'
    let staleOut: unknown = 'unset'
    try { staleOut = await searchMfSchemes(fakeService({ synced: stale }).service, 'parag', now) } catch (e) { staleOut = `threw ${String(e)}` }
    let emptyOut: unknown = 'unset'
    try { emptyOut = await searchMfSchemes(fakeService({ synced: null }).service, 'parag', now) } catch (e) { emptyOut = `threw ${String(e)}` }
    expect({ staleOut, emptyOut }).toEqual({ staleOut: [], emptyOut: 'threw Error: AMFI down' })
  })
})
