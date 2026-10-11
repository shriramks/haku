import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revalidateTag, createSupabaseServiceClient, getUserId, ensureStocks, getStocks, fyIdForDate } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  getUserId: vi.fn(),
  ensureStocks: vi.fn(),
  getStocks: vi.fn(),
  fyIdForDate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag, revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase-service', () => ({ createSupabaseServiceClient }))
vi.mock('@/lib/data', () => ({ getUserId, getPlanAllocations: vi.fn(), getTransactions: vi.fn(), getLatestSnapshot: vi.fn() }))
vi.mock('@/lib/fy-utils', () => ({ fyIdForDate }))
vi.mock('@/lib/stock-master', () => ({ ensureStocks, getStocks, isValidStockSymbol: (s: string) => /^[A-Za-z0-9][A-Za-z0-9.\-&_]{0,19}$/.test(s) }))
vi.mock('@/lib/stock-price-refresh', () => ({ refreshStockPrices: vi.fn() }))

import { addStockTransaction, updateStockTransaction, importStockTransactions } from '@/app/actions'

const NSE = { symbol: 'TCS', exchange: 'NSE', currency: 'INR', yahooSymbol: 'TCS.NS', region: 'india', name: '' }
const LSE = { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahooSymbol: 'VUAA.L', region: 'us', name: 'Vanguard S&P 500 UCITS ETF' }

function setup(rowSymbol = 'VUAA') {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const updateEq2 = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn((_patch: Record<string, unknown>) => ({ eq: () => ({ eq: updateEq2 }) }))
  const single = vi.fn().mockResolvedValue({ data: { symbol: rowSymbol } })
  const select = vi.fn(() => ({ eq: () => ({ eq: () => ({ single }) }) }))
  createSupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ insert, update, select })) })
  return { insert, update }
}

const trade = { exchange: 'NSE', trade_date: '2026-10-09', trade_type: 'buy' as const, quantity: 12, price: 110.42 }

describe('stock transaction writes carry the trade-date rate (#153)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserId.mockResolvedValue('user-1')
    fyIdForDate.mockResolvedValue('fy-1')
    ensureStocks.mockImplementation(async (symbols: string[]) =>
      Object.fromEntries(symbols.map(s => [s, s === 'VUAA' ? LSE : { ...NSE, symbol: s }])))
    getStocks.mockImplementation(async (symbols: string[]) =>
      Object.fromEntries(symbols.map(s => [s, s === 'VUAA' ? LSE : { ...NSE, symbol: s }])))
  })

  it('add: a USD trade stores its rate and the master venue, and revalidates transactions', async () => {
    const { insert } = setup()
    const res = await addStockTransaction({ ...trade, symbol: 'VUAA', fx_rate: 104.47 })
    expect(res.error).toBeNull()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'VUAA', exchange: 'LSE', fx_rate: 104.47, user_id: 'user-1', fy_id: 'fy-1',
    }))
    expect(revalidateTag).toHaveBeenCalledWith('transactions', {})
  })

  it('add: a USD trade without a rate is rejected and writes nothing', async () => {
    const { insert } = setup()
    const res = await addStockTransaction({ ...trade, symbol: 'VUAA' })
    expect(res.error).toBe('Enter the rate')
    expect(insert).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('add: an INR trade is stored at rate 1 even if the caller sent one', async () => {
    const { insert } = setup()
    await addStockTransaction({ ...trade, symbol: 'TCS', price: 4000, fx_rate: 83 })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'TCS', exchange: 'NSE', fx_rate: 1 }))
  })

  it('add: ensures the master row with VUAA known, so a first buy creates it', async () => {
    setup()
    await addStockTransaction({ ...trade, symbol: 'VUAA', fx_rate: 104.47 })
    expect(ensureStocks).toHaveBeenCalledWith(['VUAA'], { VUAA: expect.objectContaining({ currency: 'USD', yahooSymbol: 'VUAA.L' }) })
  })

  it('update: the row own instrument decides the rate; USD keeps the edit, tag revalidated', async () => {
    const { update } = setup('VUAA')
    const res = await updateStockTransaction('t1', { quantity: 10, price: 100, trade_date: '2026-10-09', fx_rate: 105 })
    expect(res.error).toBeNull()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 10, price: 100, fx_rate: 105, fy_id: 'fy-1' }))
    expect(revalidateTag).toHaveBeenCalledWith('transactions', {})
  })

  it('update: an INR row stays at rate 1', async () => {
    const { update } = setup('TCS')
    await updateStockTransaction('t1', { quantity: 10, price: 100, trade_date: '2026-10-09', fx_rate: 5 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ fx_rate: 1 }))
  })

  it('update: a USD edit without a rate is rejected', async () => {
    const { update } = setup('VUAA')
    const res = await updateStockTransaction('t1', { quantity: 10, price: 100, trade_date: '2026-10-09' })
    expect(res.error).toBe('Enter the rate')
    expect(update).not.toHaveBeenCalled()
  })

  it('add: writes only whitelisted fields; extra client-supplied columns are dropped', async () => {
    const { insert } = setup()
    await addStockTransaction({
      ...trade, symbol: 'TCS', price: 4000,
      ...({ user_id: 'someone-else', id: 'forced', advance_fy_id: 'x', notes: 'n', fy_id: 'evil' } as object),
    })
    const row = insert.mock.calls[0][0]
    expect(Object.keys(row).sort()).toEqual(
      ['exchange', 'fx_rate', 'fy_id', 'price', 'quantity', 'symbol', 'trade_date', 'trade_type', 'user_id'])
    expect(row.user_id).toBe('user-1')
    expect(row.fy_id).toBe('fy-1')
  })

  it('add: rejects a bad symbol, trade type, date, quantity or price before any write', async () => {
    const { insert } = setup()
    const bad = [
      { symbol: '../x' }, { symbol: 'TCS', trade_type: 'hold' }, { symbol: 'TCS', trade_date: '10/09/2026' },
      { symbol: 'TCS', quantity: -1 }, { symbol: 'TCS', price: 0 }, { symbol: 'TCS', quantity: NaN },
    ]
    for (const b of bad) {
      const res = await addStockTransaction({ ...trade, ...b } as never)
      expect(res.error).not.toBeNull()
    }
    expect(insert).not.toHaveBeenCalled()
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('update: only quantity, price, date, rate and fy_id are written; symbol / user_id in the patch are ignored', async () => {
    const { update } = setup('VUAA')
    await updateStockTransaction('t1', {
      quantity: 10, price: 100, trade_date: '2026-10-09', fx_rate: 105,
      ...({ symbol: 'HACK', user_id: 'someone-else' } as object),
    } as never)
    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual(['fx_rate', 'fy_id', 'price', 'quantity', 'trade_date'])
  })

  it('import: rows are whitelisted and an invalid row fails the batch before the master is touched', async () => {
    const { insert } = setup()
    await importStockTransactions([{ ...trade, symbol: 'TCS', price: 4000, ...({ user_id: 'x', id: 'y' } as object) }], false)
    expect(Object.keys(insert.mock.calls[0][0][0]).sort())
      .toEqual(['exchange', 'fx_rate', 'fy_id', 'price', 'quantity', 'symbol', 'trade_date', 'trade_type', 'user_id'])

    ensureStocks.mockClear(); insert.mockClear()
    const res = await importStockTransactions([{ ...trade, symbol: 'TCS', price: 4000 }, { ...trade, symbol: 'TCS', quantity: 0 }], false)
    expect(res.error).not.toBeNull()
    expect(ensureStocks).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('import: rows get their instrument rate, one revalidation, and a USD row without a rate fails the batch', async () => {
    const { insert } = setup()
    const ok = await importStockTransactions([
      { ...trade, symbol: 'TCS', price: 4000 },
      { ...trade, symbol: 'VUAA', fx_rate: 104.47 },
    ], false)
    expect(ok.error).toBeNull()
    expect(insert.mock.calls[0][0].map((r: { symbol: string; fx_rate: number }) => [r.symbol, r.fx_rate])).toEqual([['TCS', 1], ['VUAA', 104.47]])
    expect(revalidateTag).toHaveBeenCalledTimes(1)

    insert.mockClear()
    const bad = await importStockTransactions([{ ...trade, symbol: 'VUAA' }], false)
    expect(bad.error).toBe('Enter the rate for VUAA')
    expect(insert).not.toHaveBeenCalled()
  })
})
