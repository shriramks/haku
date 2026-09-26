import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSupabaseServerClient = vi.fn()
const createSupabaseServiceClient = vi.fn()
const getStockPrices = vi.fn()
const fetchCmpBatch = vi.fn()
const fetchGoldPrice = vi.fn()

vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient }))
vi.mock('@/lib/supabase-service', () => ({ createSupabaseServiceClient }))
vi.mock('@/lib/data', () => ({ getStockPrices }))
vi.mock('@/lib/market-data', () => ({ fetchCmpBatch, fetchGoldPrice }))

import { GOLD_PRICE_KEY } from '@/lib/stock-prices'

type Txn = { symbol: string; trade_date: string; trade_type: 'buy' | 'sell'; quantity: number; amount: number }

function setup({
  user = { id: 'user-1' } as { id: string } | null,
  txns = [] as Txn[],
  txnError = null as { message: string } | null,
  upsertError = null as { message: string } | null,
  goldRows = [] as { id: string }[],
  goldError = null as { message: string } | null,
} = {}) {
  createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  })
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const eq = vi.fn().mockResolvedValue({ data: txnError ? null : txns, error: txnError })
  const select = vi.fn(() => ({ eq }))
  const goldLimit = vi.fn().mockResolvedValue({ data: goldError ? null : goldRows, error: goldError })
  const goldEq = vi.fn(() => ({ limit: goldLimit }))
  const goldSelect = vi.fn(() => ({ eq: goldEq }))
  createSupabaseServiceClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'transactions') return { select }
      if (table === 'sgb_transactions') return { select: goldSelect }
      return { upsert }
    }),
  })
  return { upsert, select, eq, goldSelect, goldEq }
}

async function post() {
  const { POST } = await import('./route')
  return POST()
}

const buy = (symbol: string, quantity = 10): Txn => ({ symbol, trade_date: '2026-01-01', trade_type: 'buy', quantity, amount: quantity * 100 })

describe('POST /api/portfolio/prices/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStockPrices.mockResolvedValue({})
    fetchGoldPrice.mockResolvedValue(null)
  })

  it('returns 401 and touches nothing when signed out', async () => {
    const { upsert } = setup({ user: null })
    const res = await post()
    expect(res.status).toBe(401)
    expect(fetchCmpBatch).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("reads only the caller's own transactions, with specific columns", async () => {
    const { select, eq } = setup({ txns: [buy('TCS')] })
    fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000 }, prevClose: { TCS: 3950 } })
    await post()
    expect(select).toHaveBeenCalledWith('symbol, trade_date, trade_type, quantity, amount')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('fetches held symbols only and upserts a row per symbol that returned a price', async () => {
    const { upsert } = setup({
      txns: [
        buy('TCS'),
        buy('CAMS'),
        buy('SOLD'),
        { symbol: 'SOLD', trade_date: '2026-02-01', trade_type: 'sell', quantity: 10, amount: 1000 },
      ],
    })
    fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000, CAMS: 800 }, prevClose: { TCS: 3950, CAMS: null } })

    const res = await post()
    const body = await res.json()

    expect(fetchCmpBatch).toHaveBeenCalledWith(['CAMS', 'TCS'])
    const [rows, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'symbol' })
    expect(rows).toEqual([
      expect.objectContaining({ symbol: 'CAMS', cmp: 800,  prev_close: null }),
      expect.objectContaining({ symbol: 'TCS',  cmp: 4000, prev_close: 3950 }),
    ])
    expect(body.stocks).toEqual({ requested: 2, updated: 2, moved: 2, failed: [] })
    expect(body.gold).toBe('skipped')
    expect(typeof body.fetchedAt).toBe('string')
  })

  it('never writes a row for a symbol Yahoo returned nothing for, and reports it failed', async () => {
    const { upsert } = setup({ txns: [buy('TCS'), buy('CAMS')] })
    fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000 }, prevClose: { TCS: 3950 } })

    const body = await (await post()).json()

    const [rows] = upsert.mock.calls[0]
    expect(rows.map((r: { symbol: string }) => r.symbol)).toEqual(['TCS'])
    expect(body.stocks.failed).toEqual(['CAMS'])
    expect(body.stocks.updated).toBe(1)
  })

  it('does not upsert at all when every fetch failed, and still answers 200', async () => {
    const { upsert } = setup({ txns: [buy('TCS')] })
    fetchCmpBatch.mockResolvedValue({ prices: {}, prevClose: {} })
    const res = await post()
    expect(res.status).toBe(200)
    expect(upsert).not.toHaveBeenCalled()
    expect((await res.json()).stocks).toEqual({ requested: 1, updated: 0, moved: 0, failed: ['TCS'] })
  })

  it('makes no market-data call and no write when there are no holdings', async () => {
    const { upsert } = setup({ txns: [] })
    const res = await post()
    expect(fetchCmpBatch).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect((await res.json()).stocks).toEqual({ requested: 0, updated: 0, moved: 0, failed: [] })
  })

  it('returns 500 when the upsert fails', async () => {
    setup({ txns: [buy('TCS')], upsertError: { message: 'boom' } })
    fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000 }, prevClose: {} })
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })

  it('returns 500 when the transactions read fails', async () => {
    setup({ txnError: { message: 'db down' } })
    const res = await post()
    expect(res.status).toBe(500)
    expect(fetchCmpBatch).not.toHaveBeenCalled()
  })

  describe('gold', () => {
    const goldHolder = { goldRows: [{ id: 'g1' }] }

    it("checks only the caller's own gold transactions, one row is enough", async () => {
      const { goldSelect, goldEq } = setup(goldHolder)
      fetchGoldPrice.mockResolvedValue({ pricePerGram: 9000, prevPricePerGram: 8900 })
      await post()
      expect(goldSelect).toHaveBeenCalledWith('id')
      expect(goldEq).toHaveBeenCalledWith('user_id', 'user-1')
    })

    it('fetches gold and saves it under the reserved key in the same upsert as the stocks', async () => {
      const { upsert } = setup({ ...goldHolder, txns: [buy('TCS')] })
      fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000 }, prevClose: { TCS: 3950 } })
      fetchGoldPrice.mockResolvedValue({ pricePerGram: 9000, prevPricePerGram: 8900 })

      const body = await (await post()).json()

      expect(upsert).toHaveBeenCalledTimes(1)
      const [rows] = upsert.mock.calls[0]
      expect(rows).toEqual([
        expect.objectContaining({ symbol: 'TCS', cmp: 4000 }),
        expect.objectContaining({ symbol: GOLD_PRICE_KEY, cmp: 9000, prev_close: 8900 }),
      ])
      expect(body.gold).toBe('updated')
      // gold is not counted among the stock figures
      expect(body.stocks).toEqual({ requested: 1, updated: 1, moved: 1, failed: [] })
    })

    it('saves gold with no prior price when Yahoo gave none', async () => {
      const { upsert } = setup(goldHolder)
      fetchGoldPrice.mockResolvedValue({ pricePerGram: 9000, prevPricePerGram: null })
      await post()
      expect(upsert.mock.calls[0][0]).toEqual([
        expect.objectContaining({ symbol: GOLD_PRICE_KEY, cmp: 9000, prev_close: null }),
      ])
    })

    it('saves gold even when the caller holds no stocks', async () => {
      const { upsert } = setup({ ...goldHolder, txns: [] })
      fetchGoldPrice.mockResolvedValue({ pricePerGram: 9000, prevPricePerGram: 8900 })
      const body = await (await post()).json()
      expect(fetchCmpBatch).not.toHaveBeenCalled()
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(body.gold).toBe('updated')
    })

    it('never writes a gold row when the gold fetch fails, and stocks still save', async () => {
      const { upsert } = setup({ ...goldHolder, txns: [buy('TCS')] })
      fetchCmpBatch.mockResolvedValue({ prices: { TCS: 4000 }, prevClose: {} })
      fetchGoldPrice.mockResolvedValue(null)

      const res = await post()
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(upsert.mock.calls[0][0].map((r: { symbol: string }) => r.symbol)).toEqual(['TCS'])
      expect(body.gold).toBe('failed')
    })

    it('does not upsert at all when gold failed and there is nothing else to save', async () => {
      const { upsert } = setup(goldHolder)
      fetchGoldPrice.mockResolvedValue(null)
      const res = await post()
      expect(upsert).not.toHaveBeenCalled()
      expect((await res.json()).gold).toBe('failed')
    })

    it('makes no gold call when the caller has no gold transactions', async () => {
      setup({ goldRows: [] })
      const body = await (await post()).json()
      expect(fetchGoldPrice).not.toHaveBeenCalled()
      expect(body.gold).toBe('skipped')
    })

    it('returns 500 when the gold transactions read fails', async () => {
      setup({ goldError: { message: 'db down' } })
      const res = await post()
      expect(res.status).toBe(500)
      expect(fetchGoldPrice).not.toHaveBeenCalled()
    })
  })
})
