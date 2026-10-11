import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserId, ensureStocks, fetchYahooInstrument, yahooListingExists } = vi.hoisted(() => ({
  getUserId: vi.fn(),
  ensureStocks: vi.fn(),
  fetchYahooInstrument: vi.fn(),
  yahooListingExists: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase-service', () => ({ createSupabaseServiceClient: vi.fn() }))
vi.mock('@/lib/data', () => ({ getUserId, getPlanAllocations: vi.fn(), getTransactions: vi.fn(), getLatestSnapshot: vi.fn() }))
vi.mock('@/lib/fy-utils', () => ({ fyIdForDate: vi.fn() }))
vi.mock('@/lib/stock-master', () => ({
  ensureStocks, getStocks: vi.fn(),
  isValidStockSymbol: (s: string) => /^[A-Za-z0-9][A-Za-z0-9.\-&_]{0,19}$/.test(s),
}))
vi.mock('@/lib/market-data', () => ({ fetchYahooInstrument, yahooListingExists }))
vi.mock('@/lib/stock-price-refresh', () => ({ refreshStockPrices: vi.fn() }))

import { lookupInstrument, registerInstrument } from '@/app/actions'

const VUAA_QUOTE = { price: 112.4, currency: 'USD', exchange: 'LSE', name: 'Vanguard S&P 500 UCITS ETF' }
const VUAA_ROW = { symbol: 'VUAA', exchange: 'LSE', currency: 'USD', yahooSymbol: 'VUAA.L', region: 'us', name: 'Vanguard S&P 500 UCITS ETF' }

describe('lookupInstrument (#154)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserId.mockResolvedValue('user-1')
  })

  it('returns what Yahoo says the ticker is and writes nothing', async () => {
    fetchYahooInstrument.mockResolvedValue(VUAA_QUOTE)
    const res = await lookupInstrument('vuaa.l')
    expect(fetchYahooInstrument).toHaveBeenCalledWith('VUAA.L')
    expect(res).toEqual({
      instrument: { yahooSymbol: 'VUAA.L', name: VUAA_QUOTE.name, exchange: 'LSE', currency: 'USD', price: 112.4 },
      error: null,
    })
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('reports no quote for an unknown or malformed ticker without calling Yahoo for the latter', async () => {
    fetchYahooInstrument.mockResolvedValue(null)
    expect((await lookupInstrument('NOPE.L')).error).toBe('No quote found')
    fetchYahooInstrument.mockClear()
    expect((await lookupInstrument('../x?y=1')).error).toBe('No quote found')
    expect(fetchYahooInstrument).not.toHaveBeenCalled()
  })

  it('rejects a quote that is not USD', async () => {
    fetchYahooInstrument.mockResolvedValue({ ...VUAA_QUOTE, currency: 'EUR' })
    const res = await lookupInstrument('VUAA.MI')
    expect(res.instrument).toBeNull()
    expect(res.error).toBe('EUR quotes are not supported')
  })

  it('requires a signed-in user', async () => {
    getUserId.mockResolvedValue(null)
    expect((await lookupInstrument('VUAA.L')).error).toBe('Not signed in')
    expect(fetchYahooInstrument).not.toHaveBeenCalled()
  })
})

describe('registerInstrument (#154)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserId.mockResolvedValue('user-1')
    fetchYahooInstrument.mockResolvedValue(VUAA_QUOTE)
    yahooListingExists.mockResolvedValue(false)
  })

  it('creates the master row from the server-side quote, never from client-supplied fields', async () => {
    ensureStocks.mockResolvedValue({ VUAA: VUAA_ROW })
    const res = await registerInstrument('vuaa', 'VUAA.L')
    expect(ensureStocks).toHaveBeenCalledWith(['VUAA'], { VUAA: VUAA_ROW })
    expect(res).toEqual({ exchange: 'LSE', name: VUAA_QUOTE.name, error: null })
  })

  it('refuses a symbol that is not the ticker itself, so one user cannot point another symbol at it', async () => {
    const res = await registerInstrument('NEWNSECO', 'VUAA.L')
    expect(res.exchange).toBeNull()
    expect(res.error).toBe('Symbol must be VUAA')
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('refuses a symbol that already resolves as an NSE listing', async () => {
    yahooListingExists.mockResolvedValue(true)   // VUAA.NS quotes too
    const res = await registerInstrument('VUAA', 'VUAA.L')
    expect(res.error).toBe('VUAA is an Indian listing')
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('fails closed when Yahoo cannot say whether the NSE listing exists', async () => {
    yahooListingExists.mockResolvedValue(null)
    const res = await registerInstrument('VUAA', 'VUAA.L')
    expect(res.exchange).toBeNull()
    expect(res.error).toBe('Could not verify the symbol, try again')
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('refuses a symbol already mapped to a different ticker', async () => {
    ensureStocks.mockResolvedValue({ VUAA: { ...VUAA_ROW, yahooSymbol: 'VUAA.MI' } })
    const res = await registerInstrument('VUAA', 'VUAA.L')
    expect(res.exchange).toBeNull()
    expect(res.error).toBe('VUAA is already set up as VUAA.MI')
  })

  it('does not touch the master when the quote cannot be confirmed', async () => {
    fetchYahooInstrument.mockResolvedValue(null)
    const res = await registerInstrument('VUAA', 'VUAA.L')
    expect(res.error).toBe('No quote found')
    expect(ensureStocks).not.toHaveBeenCalled()
  })

  it('rejects an invalid app symbol and an unauthenticated caller', async () => {
    expect((await registerInstrument('_USDINR', 'VUAA.L')).error).toBe('Invalid symbol')
    getUserId.mockResolvedValue(null)
    expect((await registerInstrument('VUAA', 'VUAA.L')).error).toBe('Not signed in')
    expect(ensureStocks).not.toHaveBeenCalled()
  })
})
