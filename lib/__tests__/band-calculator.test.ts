import { describe, it, expect } from 'vitest'
import { calculateBands, getBandSignal, computeTrancheprices, trancheSuggestion, computeTrancheAmounts } from '../band-calculator'
import type { BuyBand } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkBand(overrides: Partial<BuyBand> = {}): BuyBand {
  return {
    id: 'b1', symbol: 'TEST', exchange: 'NSE',
    anchor_type: 'PE',
    eps: null, bvps: null, ebitda: null, net_debt: null,
    shares: null, embedded_value: null,
    buy_low: 1000, buy_high: 1500, mid_low: 1501, mid_high: 2000,
    trim_price: 2500, manual_cmp: null,
    last_updated_at: '', generated_at: '', is_current: true, notes: '',
    ...overrides,
  }
}

// ── getBandSignal ─────────────────────────────────────────────────────────────

describe('getBandSignal', () => {
  it('returns unknown when cmp is null', () => {
    expect(getBandSignal(mkBand({ manual_cmp: null }))).toBe('unknown')
  })

  it('returns unknown when buy_low is null', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1200, buy_low: null }))).toBe('unknown')
  })

  it('returns unknown when trim_price is null', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1200, trim_price: null }))).toBe('unknown')
  })

  it('returns deep when cmp < buy_low', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 900 }))).toBe('deep')
  })

  it('returns buy when cmp is at buy_low boundary', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1000 }))).toBe('buy')
  })

  it('returns buy when cmp is within buy zone', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1250 }))).toBe('buy')
  })

  it('returns buy when cmp equals buy_high', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1500 }))).toBe('buy')
  })

  it('returns hold when cmp is in mid zone', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 1700 }))).toBe('hold')
  })

  it('returns hold when cmp equals mid_high', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 2000 }))).toBe('hold')
  })

  it('returns trim when cmp exceeds mid_high', () => {
    expect(getBandSignal(mkBand({ manual_cmp: 2600 }))).toBe('trim')
  })
})

// ── calculateBands ────────────────────────────────────────────────────────────

const normal = { twoWeakQuarters: false, twoStrongQuarters: false }

describe('calculateBands — Cap-Light Infra (bear/normal/bull)', () => {
  const base = { category: 'Cap-Light Infra' as const, ...normal }

  it('normal: full buy range 28–35×', () => {
    const r = calculateBands({ ...base, eps: 100 })!
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(28 * 100)
    expect(r.buyHigh).toBeCloseTo(35 * 100)
    expect(r.trimPrice).toBe(45 * 100)
  })

  it('bear: compresses buyHigh to midpoint (31.5×), trim unchanged', () => {
    const r = calculateBands({ ...base, eps: 100, twoWeakQuarters: true })!
    expect(r.isTightened).toBe(true)
    expect(r.buyLow).toBeCloseTo(28 * 100)
    expect(r.buyHigh).toBeCloseTo(31.5 * 100)
    expect(r.trimPrice).toBe(45 * 100)
  })

  it('bull: uses premium overlay (32–38×)', () => {
    const r = calculateBands({ ...base, eps: 100, twoStrongQuarters: true })!
    expect(r.isPremium).toBe(true)
    expect(r.buyLow).toBeCloseTo(32 * 100)
    expect(r.buyHigh).toBeCloseTo(38 * 100)
    expect(r.midLow).toBeCloseTo(39 * 100)
    expect(r.trimPrice).toBe(48 * 100)
  })

  it('bear wins when both flags set', () => {
    const r = calculateBands({ ...base, eps: 100, twoWeakQuarters: true, twoStrongQuarters: true })!
    expect(r.isTightened).toBe(true)
    expect(r.isPremium).toBe(false)
  })

  it('returns null when eps missing', () => {
    expect(calculateBands({ ...base })).toBeNull()
  })
})

describe('calculateBands — Hospitals (bear/normal/bull, always PE)', () => {
  const base = { category: 'Hospitals' as const, ...normal }

  it('normal: full buy range 38–45×', () => {
    const r = calculateBands({ ...base, eps: 50 })!
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(38 * 50)
    expect(r.buyHigh).toBeCloseTo(45 * 50)
    expect(r.trimPrice).toBe(56 * 50)
  })

  it('bear: buyHigh compresses to 41.5×, trim unchanged', () => {
    const r = calculateBands({ ...base, eps: 50, twoWeakQuarters: true })!
    expect(r.buyHigh).toBeCloseTo(41.5 * 50)
    expect(r.trimPrice).toBe(56 * 50)
  })

  it('bull: buyLow shifts to 41.5× (upper half, no premium defined)', () => {
    const r = calculateBands({ ...base, eps: 50, twoStrongQuarters: true })!
    expect(r.isPremium).toBe(true)
    expect(r.buyLow).toBeCloseTo(41.5 * 50)
    expect(r.buyHigh).toBeCloseTo(45 * 50)
    expect(r.trimPrice).toBe(56 * 50)
  })
})

describe('calculateBands — Nifty 50 Index (flags ignored)', () => {
  const base = { category: 'Nifty 50 Index' as const, ...normal }

  it('returns correct band', () => {
    const r = calculateBands({ ...base, eps: 100 })!
    expect(r.buyLow).toBeCloseTo(18 * 100)
    expect(r.buyHigh).toBeCloseTo(20 * 100)
    expect(r.trimPrice).toBeCloseTo(24 * 100)
  })

  it('bear flag ignored — same as normal', () => {
    const bear = calculateBands({ ...base, eps: 100, twoWeakQuarters: true })!
    const norm = calculateBands({ ...base, eps: 100 })!
    expect(bear.buyHigh).toBeCloseTo(norm.buyHigh)
    expect(bear.isTightened).toBe(false)
  })

  it('bull flag ignored — same as normal', () => {
    const bull = calculateBands({ ...base, eps: 100, twoStrongQuarters: true })!
    const norm = calculateBands({ ...base, eps: 100 })!
    expect(bull.buyLow).toBeCloseTo(norm.buyLow)
    expect(bull.isPremium).toBe(false)
  })
})

describe('calculateBands — FMCG', () => {
  const base = { category: 'FMCG' as const, ...normal }

  it('normal: full buy range 35–50×', () => {
    const r = calculateBands({ ...base, eps: 40 })!
    expect(r.buyLow).toBeCloseTo(35 * 40)
    expect(r.buyHigh).toBeCloseTo(50 * 40)
    expect(r.trimPrice).toBe(61 * 40)
  })

  it('bear: buyHigh → 42.5×', () => {
    const r = calculateBands({ ...base, eps: 40, twoWeakQuarters: true })!
    expect(r.buyHigh).toBeCloseTo(42.5 * 40)
    expect(r.trimPrice).toBe(61 * 40)
  })

  it('bull: buyLow → 42.5× (upper half)', () => {
    const r = calculateBands({ ...base, eps: 40, twoStrongQuarters: true })!
    expect(r.buyLow).toBeCloseTo(42.5 * 40)
    expect(r.buyHigh).toBeCloseTo(50 * 40)
  })
})

describe('calculateBands — Tobacco Corp', () => {
  const base = { category: 'Tobacco Corp' as const, ...normal }

  it('normal: full buy range 20–25×', () => {
    const r = calculateBands({ ...base, eps: 20 })!
    expect(r.buyLow).toBeCloseTo(20 * 20)
    expect(r.buyHigh).toBeCloseTo(25 * 20)
    expect(r.trimPrice).toBe(31 * 20)
  })

  it('bear: buyHigh → 22.5×', () => {
    const r = calculateBands({ ...base, eps: 20, twoWeakQuarters: true })!
    expect(r.buyHigh).toBeCloseTo(22.5 * 20)
  })
})

describe('calculateBands — Commodity (no bands)', () => {
  it('returns null', () => {
    expect(calculateBands({ category: 'Commodity', ...normal, eps: 100 })).toBeNull()
  })
})

// ── computeTrancheprices ──────────────────────────────────────────────────────

describe('computeTrancheprices — whole number prices', () => {
  it('all prices are integers', () => {
    const prices = computeTrancheprices(1000, 1500, null)
    expect(prices.every(p => Number.isInteger(p))).toBe(true)
  })

  it('CMP null: returns 3 prices within upper half of buy zone', () => {
    const prices = computeTrancheprices(1000, 1500, null, 1500, 2000, 3)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1500)
    })
  })

  it('CMP above buy zone: returns prices within upper half of buy zone', () => {
    const prices = computeTrancheprices(1000, 1500, 2000, 1500, 2500, 3)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1500)
    })
  })

  it('CMP inside buy zone: all prices at or below CMP', () => {
    const prices = computeTrancheprices(1000, 1500, 1200, 1500, 2000, 3)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(1200))
  })

  it('CMP below buy zone (deep): prices span CMP to buyLow', () => {
    const prices = computeTrancheprices(1000, 1500, 800, 1500, 2000, 3)
    expect(prices[0]).toBeGreaterThanOrEqual(800)
    expect(prices[prices.length - 1]).toBeLessThanOrEqual(1000)
  })

  it('returns deduplicated prices (no duplicates in very narrow band)', () => {
    const prices = computeTrancheprices(1000, 1010, null)
    const unique = [...new Set(prices)]
    expect(prices.length).toBe(unique.length)
  })
})

// ── trancheSuggestion ─────────────────────────────────────────────────────────

describe('trancheSuggestion', () => {
  it('is capped at 2% of total capital', () => {
    const result = trancheSuggestion(5_000_000, 1_000_000)
    expect(result).toBeLessThanOrEqual(1_000_000 * 0.02)
  })

  it('is at least 1% of total capital when remaining is large', () => {
    const result = trancheSuggestion(5_000_000, 1_000_000)
    expect(result).toBeGreaterThanOrEqual(1_000_000 * 0.01)
  })

  it('floors at 1% of capital when remaining is very small', () => {
    // remaining*0.33 < 1% of capital → floor kicks in
    const result = trancheSuggestion(5_000, 1_000_000)
    expect(result).toBe(1_000_000 * 0.01)  // = 10_000
  })
})

// ── computeTrancheAmounts ─────────────────────────────────────────────────────

describe('computeTrancheAmounts — conviction-weighted sizing', () => {
  it('returns empty array for count=0', () => {
    expect(computeTrancheAmounts(100_000, 0)).toEqual([])
  })

  it('returns empty array for remaining=0', () => {
    expect(computeTrancheAmounts(0, 3)).toEqual([])
  })

  it('single tranche gets the full remaining amount', () => {
    const [amt] = computeTrancheAmounts(47_300, 1)
    expect(amt).toBeCloseTo(47_300)
  })

  it('amounts sum exactly to remaining', () => {
    for (const count of [2, 3, 4, 5, 8]) {
      const remaining = 100_000
      const amounts = computeTrancheAmounts(remaining, count)
      const total = amounts.reduce((s, a) => s + a, 0)
      expect(total).toBeCloseTo(remaining, 5)
    }
  })

  it('amounts are strictly increasing (deeper tranches get more capital)', () => {
    const amounts = computeTrancheAmounts(100_000, 4)
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]).toBeGreaterThan(amounts[i - 1])
    }
  })

  it('3-tranche split: weights 1/6, 2/6, 3/6 of remaining', () => {
    const remaining = 47_300
    const [a, b, c] = computeTrancheAmounts(remaining, 3)
    expect(a).toBeCloseTo(remaining * 1 / 6)
    expect(b).toBeCloseTo(remaining * 2 / 6)
    expect(c).toBeCloseTo(remaining * 3 / 6)
  })

  it('2-tranche split: weights 1/3 and 2/3', () => {
    const remaining = 90_000
    const [a, b] = computeTrancheAmounts(remaining, 2)
    expect(a).toBeCloseTo(remaining * 1 / 3)
    expect(b).toBeCloseTo(remaining * 2 / 3)
  })

  it('8-tranche split: last amount is 8× the first', () => {
    const amounts = computeTrancheAmounts(360_000, 8)
    expect(amounts[7] / amounts[0]).toBeCloseTo(8)
  })
})
