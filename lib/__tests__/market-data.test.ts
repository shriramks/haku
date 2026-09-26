import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGoldPrice, goldPerGram } from '../market-data'

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
