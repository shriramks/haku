import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSupabaseServerClient = vi.fn()
const createSupabaseServiceClient = vi.fn()
const getStockPrices = vi.fn()
const fetchCmpBatch = vi.fn()

vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient }))
vi.mock('@/lib/supabase-service', () => ({ createSupabaseServiceClient }))
vi.mock('@/lib/data', () => ({ getStockPrices }))
vi.mock('@/lib/market-data', () => ({ fetchCmpBatch }))

type Txn = { symbol: string; trade_date: string; trade_type: 'buy' | 'sell'; quantity: number; amount: number }

function setup({ user = { id: 'user-1' } as { id: string } | null, txns = [] as Txn[], txnError = null as { message: string } | null, upsertError = null as { message: string } | null } = {}) {
  createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  })
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const eq = vi.fn().mockResolvedValue({ data: txnError ? null : txns, error: txnError })
  const select = vi.fn(() => ({ eq }))
  createSupabaseServiceClient.mockReturnValue({
    from: vi.fn((table: string) => (table === 'transactions' ? { select } : { upsert })),
  })
  return { upsert, select, eq }
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
})
