import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createSupabaseServiceClient, getStockPrices, getUserId, fetchCmpBatch, ensureStocks } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  getStockPrices: vi.fn(),
  getUserId: vi.fn(),
  fetchCmpBatch: vi.fn(),
  ensureStocks: vi.fn(),
}))

vi.mock('../supabase-service', () => ({ createSupabaseServiceClient }))
vi.mock('../data', () => ({ getStockPrices, getUserId }))
vi.mock('../market-data', () => ({ fetchCmpBatch }))
vi.mock('../stock-master', () => ({ ensureStocks }))

import { refreshStockPrices } from '../stock-price-refresh'

function setup(ownedByTable: Record<string, string[]> = {}, upsertError: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const kindFilters: string[] = []   // tables whose query was narrowed with .eq('kind', 'stock')
  createSupabaseServiceClient.mockReturnValue({
    from: vi.fn((table: string) => ({
      upsert,
      select: () => ({
        eq: () => ({
          in: () => {
            const result = { data: (ownedByTable[table] ?? []).map(symbol => ({ symbol })), error: null }
            // awaitable as is, and also chainable with one more .eq (the plan table's kind filter)
            return Object.assign(Promise.resolve(result), {
              eq: (col: string, val: string) => { if (col === 'kind' && val === 'stock') kindFilters.push(table); return Promise.resolve(result) },
            })
          },
        }),
      }),
    })),
  })
  return { upsert, kindFilters }
}

describe('refreshStockPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserId.mockResolvedValue('user-1')
    getStockPrices.mockResolvedValue({})
    ensureStocks.mockImplementation(async (symbols: string[]) =>
      Object.fromEntries(symbols.map(s => [s, { symbol: s, yahooSymbol: `${s}.NS` }])))
    fetchCmpBatch.mockResolvedValue({
      prices: { TCS: 4000 }, prevClose: { TCS: 3950 }, changePercent: {}, week52: { TCS: { low: 3000, high: 4200 } },
    })
  })

  it('returns null when signed out', async () => {
    getUserId.mockResolvedValue(null)
    expect(await refreshStockPrices(['TCS'])).toBeNull()
    expect(fetchCmpBatch).not.toHaveBeenCalled()
  })

  it('saves fetched prices to stock_prices and returns them with 52w', async () => {
    const { upsert } = setup({ buy_bands: ['TCS'] })
    const out = await refreshStockPrices(['TCS'])
    expect(out).toEqual({ prices: { TCS: 4000 }, week52: { TCS: { low: 3000, high: 4200 } } })
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ symbol: 'TCS', cmp: 4000, prev_close: 3950 })],
      { onConflict: 'symbol' },
    )
  })

  it('ignores symbols the caller has no row for', async () => {
    setup({ transactions: ['TCS'] })
    await refreshStockPrices(['TCS', 'EVIL'])
    expect(ensureStocks).toHaveBeenCalledWith(['TCS'], {}, 'user-1')
    expect(fetchCmpBatch).toHaveBeenCalledWith([{ symbol: 'TCS', yahooSymbol: 'TCS.NS' }])
  })

  it('counts only stock plan rows as owned: a PPF or fund row is never priced', async () => {
    const { kindFilters } = setup({ stock_allocations: ['TCS'] })
    await refreshStockPrices(['TCS'])
    expect(kindFilters).toEqual(['stock_allocations'])
  })

  it('fetches nothing when no requested symbol is owned', async () => {
    const { upsert } = setup()
    expect(await refreshStockPrices(['EVIL'])).toEqual({ prices: {}, week52: {} })
    expect(fetchCmpBatch).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not write a row for a symbol the fetch returned no price for', async () => {
    const { upsert } = setup({ buy_bands: ['TCS', 'INFY'] })
    await refreshStockPrices(['TCS', 'INFY'])
    const rows = upsert.mock.calls[0][0] as { symbol: string }[]
    expect(rows.map(r => r.symbol)).toEqual(['TCS'])
  })

  it('returns null when the instrument master cannot be read or written', async () => {
    setup({ buy_bands: ['TCS'] })
    ensureStocks.mockResolvedValue(null)
    expect(await refreshStockPrices(['TCS'])).toBeNull()
    expect(fetchCmpBatch).not.toHaveBeenCalled()
  })

  it('returns null when the save fails', async () => {
    setup({ buy_bands: ['TCS'] }, { message: 'boom' })
    expect(await refreshStockPrices(['TCS'])).toBeNull()
  })
})
