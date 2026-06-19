import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchNseIndex } from '../nse'

const NSE_RESPONSE = {
  data: [
    { index: 'NIFTY 50', last: 24198.5, pe: 22.45, pb: 3.8, dy: 1.2 },
    { index: 'NIFTY NEXT 50', last: 67432.1, pe: 31.2, pb: 4.1, dy: 0.9 },
    { index: 'NIFTY BANK', last: 52000.0, pe: 14.1, pb: 2.5, dy: 0.5 },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchNseIndex', () => {
  it('returns level and pe for NIFTY 50', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NSE_RESPONSE,
    }))

    const result = await fetchNseIndex('NIFTY 50')

    expect(result.level).toBe(24198.5)
    expect(result.pe).toBe(22.45)
    expect(result.asOf).toBeTruthy()
  })

  it('returns level and pe for NIFTY NEXT 50', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NSE_RESPONSE,
    }))

    const result = await fetchNseIndex('NIFTY NEXT 50')

    expect(result.level).toBe(67432.1)
    expect(result.pe).toBe(31.2)
  })

  it('calls the correct URL with NSE Referer header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NSE_RESPONSE,
    })
    vi.stubGlobal('fetch', mockFetch)

    await fetchNseIndex('NIFTY 50')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.nseindia.com/api/allIndices',
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: 'https://www.nseindia.com',
        }),
      }),
    )
  })

  it('throws when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(fetchNseIndex('NIFTY 50')).rejects.toThrow('NSE fetch failed: 429')
  })

  it('throws when index name is not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NSE_RESPONSE,
    }))
    await expect(fetchNseIndex('NIFTY MIDCAP 150')).rejects.toThrow(
      '"NIFTY MIDCAP 150" not found in NSE response',
    )
  })

  it('throws when PE is outside the sane consolidated range (basis guard)', async () => {
    // PE 50 would mean a standalone-basis flip or parse error — bands must not compute.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 'NIFTY 50', last: 24198.5, pe: 50 }] }),
    }))
    await expect(fetchNseIndex('NIFTY 50')).rejects.toThrow('outside sane range')
  })
})
