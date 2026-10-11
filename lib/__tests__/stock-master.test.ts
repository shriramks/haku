import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createSupabaseServiceClient } = vi.hoisted(() => ({ createSupabaseServiceClient: vi.fn() }))
vi.mock('../supabase-service', () => ({ createSupabaseServiceClient }))

import { ensureStocks, getStocks, isValidStockSymbol, nseStock } from '../stock-master'

const row = (symbol: string, yahoo_symbol: string, exchange = 'NSE', currency = 'INR', region = 'india') =>
  ({ symbol, exchange, currency, yahoo_symbol, region, name: '' })

function setup(existing: ReturnType<typeof row>[], { readError = null as { message: string } | null, upsertError = null as { message: string } | null } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })
  const inFn = vi.fn((_col: string, symbols: string[]) =>
    Promise.resolve({ data: readError ? null : existing.filter(r => symbols.includes(r.symbol)), error: readError }))
  createSupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ select: () => ({ in: inFn }), upsert })) })
  return { upsert, inFn }
}

describe('isValidStockSymbol', () => {
  it('accepts tickers, including & and -', () => {
    for (const s of ['TCS', 'M&M', 'BAJAJ-AUTO', 'VUAA', 'NIFTYBEES']) expect(isValidStockSymbol(s)).toBe(true)
  })
  it('rejects reserved keys and malformed input', () => {
    for (const s of ['_GOLD_INR_PER_GRAM', '_USDINR', '', 'a b', 'US:TCS', 'x'.repeat(21)]) expect(isValidStockSymbol(s)).toBe(false)
  })
})

describe('getStocks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keys rows by symbol and maps columns; absent symbols are simply missing', async () => {
    setup([row('VUAA', 'VUAA.L', 'LSE', 'USD', 'us')])
    expect(await getStocks(['VUAA', 'NEWCO'])).toEqual({
      VUAA: { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahooSymbol: 'VUAA.L', region: 'us', name: '' },
    })
  })

  it('does not query for an empty list', async () => {
    const { inFn } = setup([])
    expect(await getStocks([])).toEqual({})
    expect(inFn).not.toHaveBeenCalled()
  })
})

describe('ensureStocks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates missing symbols as NSE / INR / SYMBOL.NS without overwriting existing rows', async () => {
    const { upsert } = setup([row('TCS', 'TCS.NS')])
    const out = await ensureStocks(['TCS', 'NEWCO'])
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual([row('NEWCO', 'NEWCO.NS')])
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'symbol', ignoreDuplicates: true })
    expect(out?.NEWCO).toEqual(nseStock('NEWCO'))
    expect(out?.TCS.yahooSymbol).toBe('TCS.NS')
  })

  it('uses full details from `known` when the caller has them', async () => {
    const { upsert } = setup([])
    const vuaa = { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahooSymbol: 'VUAA.L', region: 'us' as const, name: 'Vanguard S&P 500 UCITS ETF' }
    await ensureStocks(['VUAA'], { VUAA: vuaa })
    expect(upsert.mock.calls[0][0]).toEqual([
      { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahoo_symbol: 'VUAA.L', region: 'us', name: 'Vanguard S&P 500 UCITS ETF' },
    ])
  })

  it('writes nothing when every symbol already has a row', async () => {
    const { upsert } = setup([row('TCS', 'TCS.NS')])
    await ensureStocks(['TCS'])
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never writes an invalid or reserved symbol', async () => {
    const { upsert } = setup([])
    const out = await ensureStocks(['_GOLD_INR_PER_GRAM', 'a b'])
    expect(out).toEqual({})
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns null when the master cannot be read, without writing', async () => {
    const { upsert } = setup([], { readError: { message: 'db down' } })
    expect(await ensureStocks(['TCS'])).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns null when the write fails', async () => {
    setup([], { upsertError: { message: 'boom' } })
    expect(await ensureStocks(['TCS'])).toBeNull()
  })
})
