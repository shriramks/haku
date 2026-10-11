import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCmpBatch, fetchCmp, fetchYearChart, fetchGoldPrice, goldPerGram } from '../market-data'

// Yahoo chart response for one symbol
const chart = (price: number | undefined, chartPreviousClose?: number) => ({
  ok: true,
  json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose } }] } }),
})

function mockYahoo(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const key = Object.keys(responses).find(k => url.includes(encodeURIComponent(k)))
    if (!key) throw new Error(`unexpected url ${url}`)
    return responses[key]
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('goldPerGram', () => {
  it('converts USD per troy oz to INR per gram', () => {
    // 31.1035 g per troy oz: $3,110.35/oz at 80 INR/USD = 100 USD/g × 80
    expect(goldPerGram(3110.35, 80)).toBeCloseTo(8000, 6)
  })
})

describe('fetchGoldPrice', () => {
  it('returns today and prior per-gram prices from GC=F × USDINR=X', async () => {
    mockYahoo({
      'GC=F': chart(3110.35, 3000),
      'USDINR=X': chart(80, 79),
    })
    const q = await fetchGoldPrice()
    expect(q?.pricePerGram).toBeCloseTo(8000, 6)
    expect(q?.prevPricePerGram).toBeCloseTo((3000 / 31.1035) * 79, 6)
  })

  it('has no prior price when either prior close is missing', async () => {
    mockYahoo({ 'GC=F': chart(3110.35, undefined), 'USDINR=X': chart(80, 79) })
    expect((await fetchGoldPrice())?.prevPricePerGram).toBeNull()

    mockYahoo({ 'GC=F': chart(3110.35, 3000), 'USDINR=X': chart(80, undefined) })
    expect((await fetchGoldPrice())?.prevPricePerGram).toBeNull()
  })

  it('returns null when either leg answers non-OK', async () => {
    mockYahoo({ 'GC=F': { ok: false, json: async () => ({}) }, 'USDINR=X': chart(80, 79) })
    expect(await fetchGoldPrice()).toBeNull()
  })

  it('returns null when a leg has no price', async () => {
    mockYahoo({ 'GC=F': chart(undefined), 'USDINR=X': chart(80, 79) })
    expect(await fetchGoldPrice()).toBeNull()
  })

  it('returns null when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchGoldPrice()).toBeNull()
  })

  it('never reads from the Next fetch cache — the Prices button must get the live price', async () => {
    const fetchMock = mockYahoo({ 'GC=F': chart(3110.35, 3000), 'USDINR=X': chart(80, 79) })
    await fetchGoldPrice()
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit & { next?: unknown }][]) {
      expect(init.next).toBeUndefined()
    }
  })
})

describe('instrument-agnostic fetchers (#152)', () => {
  const v7 = (result: object[]) => ({ ok: true, json: async () => ({ quoteResponse: { result } }) })
  const stubByUrl = (handler: (url: string) => unknown) => {
    const fetchMock = vi.fn(async (url: string) => handler(String(url)))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const urls = (m: ReturnType<typeof stubByUrl>) => m.mock.calls.map(c => String(c[0]))

  it('fetchCmpBatch asks Yahoo for the given symbols as-is and keys the result by plain symbol', async () => {
    const fetchMock = stubByUrl(() => v7([
      { symbol: 'VUAA.L', regularMarketPrice: 110, regularMarketPreviousClose: 109 },
      { symbol: 'TCS.NS', regularMarketPrice: 4000, regularMarketPreviousClose: 3950 },
    ]))
    const out = await fetchCmpBatch([
      { symbol: 'VUAA', yahooSymbol: 'VUAA.L' },
      { symbol: 'TCS', yahooSymbol: 'TCS.NS' },
    ])
    expect(urls(fetchMock)[0]).toContain('symbols=VUAA.L,TCS.NS')
    expect(out.prices).toEqual({ VUAA: 110, TCS: 4000 })
    expect(out.prevClose).toEqual({ VUAA: 109, TCS: 3950 })
  })

  it('fetchCmpBatch falls back to per-symbol charts on the given Yahoo symbol, never adding a suffix', async () => {
    const fetchMock = stubByUrl(url => (url.includes('/v7/') ? v7([]) : chart(110)))
    const out = await fetchCmpBatch([{ symbol: 'VUAA', yahooSymbol: 'VUAA.L' }])
    expect(urls(fetchMock).some(u => u.includes('/chart/VUAA.L'))).toBe(true)
    expect(urls(fetchMock).some(u => u.includes('.NS'))).toBe(false)
    expect(out.prices).toEqual({ VUAA: 110 })
  })

  it('fetchCmp and fetchYearChart use the Yahoo symbol exactly as given', async () => {
    const fetchMock = stubByUrl(() => chart(110))
    expect(await fetchCmp('VUAA.L')).toBe(110)
    await fetchYearChart('VUAA.L')
    for (const u of urls(fetchMock)) {
      expect(u).toContain('/chart/VUAA.L')
      expect(u).not.toContain('.NS')
    }
  })
})
