import { describe, it, expect } from 'vitest'
import { heldSymbols, resolveCmp, buildPriceUpdate, type StockPriceInfo } from '../stock-prices'

const buy  = (symbol: string, trade_date: string, quantity: number, amount = quantity * 100) =>
  ({ symbol, trade_date, trade_type: 'buy' as const, quantity, amount })
const sell = (symbol: string, trade_date: string, quantity: number, amount = quantity * 100) =>
  ({ symbol, trade_date, trade_type: 'sell' as const, quantity, amount })

describe('heldSymbols', () => {
  it('returns symbols with a positive net quantity, sorted', () => {
    expect(heldSymbols([
      buy('TCS', '2026-01-01', 10),
      buy('CAMS', '2026-01-02', 5),
    ])).toEqual(['CAMS', 'TCS'])
  })

  it('drops a symbol that was fully sold', () => {
    expect(heldSymbols([
      buy('TCS', '2026-01-01', 10),
      sell('TCS', '2026-02-01', 10),
      buy('CAMS', '2026-01-02', 5),
    ])).toEqual(['CAMS'])
  })

  it('keeps a symbol that was partly sold', () => {
    expect(heldSymbols([buy('TCS', '2026-01-01', 10), sell('TCS', '2026-02-01', 4)])).toEqual(['TCS'])
  })

  it('orders by trade date, not input order (a sell listed before its buy still nets out)', () => {
    expect(heldSymbols([sell('TCS', '2026-02-01', 10), buy('TCS', '2026-01-01', 10)])).toEqual([])
  })

  it('returns [] for no transactions', () => {
    expect(heldSymbols([])).toEqual([])
  })
})

describe('resolveCmp', () => {
  const saved: Record<string, StockPriceInfo> = {
    TCS: { cmp: 4000, prevClose: 3950, fetchedAt: '2026-09-26T10:00:00.000Z' },
  }

  it('prefers the saved price over the band snapshot', () => {
    expect(resolveCmp('TCS', saved, 3500)).toBe(4000)
  })

  it('falls back to the band snapshot when there is no saved row', () => {
    expect(resolveCmp('CAMS', saved, 3500)).toBe(3500)
  })

  it('returns null when neither exists', () => {
    expect(resolveCmp('CAMS', saved, null)).toBeNull()
    expect(resolveCmp('CAMS', saved, undefined)).toBeNull()
  })
})

describe('buildPriceUpdate', () => {
  const at = '2026-09-26T10:00:00.000Z'

  it('builds a row per symbol that came back with a price', () => {
    const { rows, failed } = buildPriceUpdate(
      ['TCS', 'CAMS'],
      { prices: { TCS: 4000, CAMS: 800 }, prevClose: { TCS: 3950, CAMS: null } },
      {},
      at,
    )
    expect(failed).toEqual([])
    expect(rows).toEqual([
      { symbol: 'TCS',  cmp: 4000, prev_close: 3950, fetched_at: at },
      { symbol: 'CAMS', cmp: 800,  prev_close: null, fetched_at: at },
    ])
  })

  it('reports a symbol with no fetched price as failed and writes no row for it', () => {
    const { rows, failed } = buildPriceUpdate(
      ['TCS', 'CAMS'],
      { prices: { TCS: 4000 }, prevClose: { TCS: 3950 } },
      {},
      at,
    )
    expect(failed).toEqual(['CAMS'])
    expect(rows.map(r => r.symbol)).toEqual(['TCS'])
  })

  it('treats a missing prevClose entry as null, not undefined', () => {
    const { rows } = buildPriceUpdate(['TCS'], { prices: { TCS: 4000 }, prevClose: {} }, {}, at)
    expect(rows[0].prev_close).toBeNull()
  })

  it('counts a symbol as moved when its price changed or it had no saved row', () => {
    const previous: Record<string, StockPriceInfo> = {
      TCS:  { cmp: 3990, prevClose: 3950, fetchedAt: at },
      CAMS: { cmp: 800,  prevClose: 790,  fetchedAt: at },
    }
    const { moved } = buildPriceUpdate(
      ['TCS', 'CAMS', 'ITC'],
      { prices: { TCS: 4000, CAMS: 800, ITC: 450 }, prevClose: {} },
      previous,
      at,
    )
    expect(moved).toEqual(['TCS', 'ITC'])
  })

  it('does not count sub-precision float noise as movement', () => {
    const previous: Record<string, StockPriceInfo> = { TCS: { cmp: 4000.55, prevClose: null, fetchedAt: at } }
    const { moved } = buildPriceUpdate(['TCS'], { prices: { TCS: 4000.550000001 }, prevClose: {} }, previous, at)
    expect(moved).toEqual([])
  })

  it('still upserts an unchanged price so fetched_at advances', () => {
    const previous: Record<string, StockPriceInfo> = { TCS: { cmp: 4000, prevClose: 3950, fetchedAt: '2026-09-25T10:00:00.000Z' } }
    const { rows, moved } = buildPriceUpdate(['TCS'], { prices: { TCS: 4000 }, prevClose: { TCS: 3950 } }, previous, at)
    expect(moved).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].fetched_at).toBe(at)
  })
})
