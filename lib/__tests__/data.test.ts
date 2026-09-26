import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCurrentFY } from '../fy-utils'
import type { FiscalYear } from '../types'

// --- user_id isolation tests ---

// vi.hoisted ensures these are available inside vi.mock factory closures
const { TEST_USER_ID, OTHER_USER_ID } = vi.hoisted(() => ({
  TEST_USER_ID: 'test-user-123',
  OTHER_USER_ID: 'other-user-456',
}))

vi.mock('react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react')>()
  return { ...mod, cache: (fn: unknown) => fn }
})

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: vi.fn(),
}))

vi.mock('../supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: TEST_USER_ID } } },
      }),
    },
  }),
}))

vi.mock('../supabase-service', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

import { createSupabaseServiceClient } from '../supabase-service'
import {
  getAllocations, getTransactions, getTransactionsBySymbol,
  getSymbolAllocations, getBuyBands, getBuyTranches, getMFNavHistory, getStockPrices,
} from '../data'

// Builds a chainable Supabase query mock that records eq() calls
function makeQueryMock() {
  const eqCalls: [string, string][] = []
  const mock: Record<string, unknown> = {}
  const chain = () => mock
  mock.select = chain
  mock.order = chain
  mock.or = chain
  mock.eq = (col: string, val: string) => { eqCalls.push([col, val]); return mock }
  mock.maybeSingle = vi.fn().mockResolvedValue({ data: null })
  // Make the mock thenable so await works on query chains
  mock.then = (resolve: (v: { data: never[] }) => void) => Promise.resolve({ data: [] as never[] }).then(resolve)
  mock._eqCalls = eqCalls
  return mock
}

describe('data.ts — user_id isolation', () => {
  let queryMock: ReturnType<typeof makeQueryMock>

  beforeEach(() => {
    queryMock = makeQueryMock()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: () => queryMock,
    } as never)
  })

  function assertUserIdFilter() {
    const eqCalls = queryMock._eqCalls as [string, string][]
    const userIdCall = eqCalls.find(([col]) => col === 'user_id')
    expect(userIdCall, 'query must include .eq("user_id", ...)').toBeDefined()
    expect(userIdCall![1]).toBe(TEST_USER_ID)
    expect(userIdCall![1]).not.toBe(OTHER_USER_ID)
  }

  it('getAllocations filters by user_id', async () => {
    await getAllocations('fy-1')
    assertUserIdFilter()
  })

  it('getTransactions filters by user_id', async () => {
    await getTransactions('fy-1')
    assertUserIdFilter()
  })

  it('getTransactionsBySymbol filters by user_id', async () => {
    await getTransactionsBySymbol('ITC')
    assertUserIdFilter()
  })

  it('getSymbolAllocations filters by user_id', async () => {
    await getSymbolAllocations('ITC')
    assertUserIdFilter()
  })

  it('getBuyTranches filters by user_id', async () => {
    await getBuyTranches('fy-1')
    assertUserIdFilter()
  })
})

function mkFY(label: string, start: string, end: string): FiscalYear {
  return {
    id: `fy-${label}`, user_id: 'u1', label,
    start_date: start, end_date: end,
    total_budget_inr: 1_000_000,
    unallocated_carryover_inr: null,
    deploy_capital_inr: null,
  }
}

const FY24 = mkFY('FY24', '2023-04-01', '2024-03-31')
const FY25 = mkFY('FY25', '2024-04-01', '2025-03-31')
const FY26 = mkFY('FY26', '2025-04-01', '2026-03-31')

describe('getCurrentFY', () => {
  it('returns null for empty array', () => {
    expect(getCurrentFY([])).toBeNull()
  })

  it('returns matching FY when fyParam matches a label', () => {
    expect(getCurrentFY([FY24, FY25, FY26], 'FY25')).toBe(FY25)
  })

  it('falls back to most recent FY when fyParam does not match', () => {
    expect(getCurrentFY([FY24, FY25, FY26], 'FY99')).toBe(FY26)
  })

  it('returns single-element array when fyParam does not match', () => {
    expect(getCurrentFY([FY25], 'FY99')).toBe(FY25)
  })

  it('finds current FY by today date when no fyParam', () => {
    // FY26 covers 2025-04-01 to 2026-03-31; today (2026-04-07) is in FY27 if it existed
    // Use a range that definitely contains today
    const fyNow = mkFY('FYNOW', '2020-01-01', '2099-12-31')
    expect(getCurrentFY([FY24, FY25, fyNow], undefined)).toBe(fyNow)
  })

  it('falls back to most recent FY when no FY contains today', () => {
    // All FYs are in the past (well before 2026-04-07)
    const oldFY1 = mkFY('OLD1', '2010-04-01', '2011-03-31')
    const oldFY2 = mkFY('OLD2', '2011-04-01', '2012-03-31')
    // Array is ordered ascending by start_date; most recent = last element
    const result = getCurrentFY([oldFY1, oldFY2], undefined)
    expect(result).toBe(oldFY2)
  })
})

// --- getMFNavHistory ---

type NavRow = { scheme_code: string; nav_date: string; nav: number }

// mf_nav_history query only chains .in()/.gte()/.order() before resolving —
// no .eq(), unlike makeQueryMock above (this table isn't user-scoped).
function makeNavHistoryMock(rows: NavRow[]) {
  const mock: Record<string, unknown> = {}
  const chain = () => mock
  mock.select = chain
  mock.in = chain
  mock.gte = chain
  mock.order = chain
  mock.then = (resolve: (v: { data: NavRow[] }) => void) => Promise.resolve({ data: rows }).then(resolve)
  return mock
}

describe('getMFNavHistory', () => {
  it('returns {} without querying when no scheme codes given', async () => {
    const fromSpy = vi.fn()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromSpy } as never)
    const result = await getMFNavHistory([])
    expect(result).toEqual({})
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('sets nav + prevNav when the two most recent rows are within 4 days', () => {
    return withRows(
      [{ scheme_code: '100001', nav_date: '2026-09-22', nav: 50 },
       { scheme_code: '100001', nav_date: '2026-09-19', nav: 49 }],  // Sat/Sun gap, 3 days
      async () => {
        const result = await getMFNavHistory(['100001'])
        expect(result['100001']).toEqual({ nav: 50, prevNav: 49, navDate: '2026-09-22' })
      }
    )
  })

  it('nulls prevNav when the gap between the two rows exceeds 4 days', () => {
    return withRows(
      [{ scheme_code: '100001', nav_date: '2026-09-22', nav: 50 },
       { scheme_code: '100001', nav_date: '2026-09-10', nav: 45 }],  // 12-day gap — feed was stuck
      async () => {
        const result = await getMFNavHistory(['100001'])
        expect(result['100001']).toEqual({ nav: 50, prevNav: null, navDate: '2026-09-22' })
      }
    )
  })

  it('leaves prevNav null when only one row exists for a scheme', () => {
    return withRows(
      [{ scheme_code: '100001', nav_date: '2026-09-22', nav: 50 }],
      async () => {
        const result = await getMFNavHistory(['100001'])
        expect(result['100001']).toEqual({ nav: 50, prevNav: null, navDate: '2026-09-22' })
      }
    )
  })

  it('ignores rows beyond the two most recent per scheme', () => {
    return withRows(
      [{ scheme_code: '100001', nav_date: '2026-09-22', nav: 50 },
       { scheme_code: '100001', nav_date: '2026-09-19', nav: 49 },
       { scheme_code: '100001', nav_date: '2026-09-18', nav: 999 }],  // would corrupt prevNav if not skipped
      async () => {
        const result = await getMFNavHistory(['100001'])
        expect(result['100001'].prevNav).toBe(49)
      }
    )
  })

  function withRows(rows: NavRow[], run: () => Promise<void>) {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: () => makeNavHistoryMock(rows),
    } as never)
    return run()
  }
})

// --- getStockPrices ---

type PriceRow = { symbol: string; cmp: number | string; prev_close: number | string | null; fetched_at: string }

// stock_prices query only chains .select()/.in() — public table, no user_id filter.
function makeStockPricesMock(rows: PriceRow[]) {
  const mock: Record<string, unknown> = {}
  const chain = () => mock
  mock.select = chain
  mock.in = chain
  mock.then = (resolve: (v: { data: PriceRow[] }) => void) => Promise.resolve({ data: rows }).then(resolve)
  return mock
}

describe('getStockPrices', () => {
  it('returns {} without querying when no symbols given', async () => {
    const fromSpy = vi.fn()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromSpy } as never)
    expect(await getStockPrices([])).toEqual({})
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('keys rows by symbol and maps column names', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: () => makeStockPricesMock([
        { symbol: 'TCS', cmp: 4000, prev_close: 3950, fetched_at: '2026-09-26T10:00:00+00:00' },
      ]),
    } as never)
    expect(await getStockPrices(['TCS'])).toEqual({
      TCS: { cmp: 4000, prevClose: 3950, fetchedAt: '2026-09-26T10:00:00+00:00' },
    })
  })

  it('keeps a null prev_close null and coerces numeric strings to numbers', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: () => makeStockPricesMock([
        { symbol: 'CAMS', cmp: '812.5000', prev_close: null, fetched_at: '2026-09-26T10:00:00+00:00' },
      ]),
    } as never)
    const result = await getStockPrices(['CAMS'])
    expect(result.CAMS.cmp).toBe(812.5)
    expect(result.CAMS.prevClose).toBeNull()
  })

  it('omits symbols with no saved row', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: () => makeStockPricesMock([]),
    } as never)
    expect(await getStockPrices(['NEWCO'])).toEqual({})
  })
})
