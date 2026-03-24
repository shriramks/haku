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

describe('calculateBands — PE anchor (IT/Technology)', () => {
  // Table: buyLow: 20, buyHigh: 26, midLow: 27, midHigh: 32, trim: 33
  const base = { category: 'IT/Technology' as const, twoWeakQuarters: false, twoStrongQuarters: false, isHospitalRampPhase: false }

  it('returns correct band with eps=100', () => {
    const r = calculateBands({ ...base, eps: 100 })
    expect(r).not.toBeNull()
    expect(r!.anchorUsed).toBe('PE')
    expect(r!.buyLow).toBe(20 * 100)
    expect(r!.buyHigh).toBe(26 * 100)
    expect(r!.midLow).toBe(27 * 100)
    expect(r!.midHigh).toBe(32 * 100)
    expect(r!.trimPrice).toBe(33 * 100)
  })

  it('returns null when eps is missing', () => {
    expect(calculateBands({ ...base })).toBeNull()
  })

  it('returns null when eps is zero', () => {
    expect(calculateBands({ ...base, eps: 0 })).toBeNull()
  })

  it('tightens all buy/mid prices by 10% when twoWeakQuarters', () => {
    const r = calculateBands({ ...base, eps: 100, twoWeakQuarters: true })!
    expect(r.isTightened).toBe(true)
    expect(r.buyLow).toBeCloseTo(20 * 100 * 0.9)
    expect(r.trimPrice).toBe(33 * 100)   // trim unchanged
  })

  it('expands buy/mid prices by 10% when twoStrongQuarters', () => {
    const r = calculateBands({ ...base, eps: 100, twoStrongQuarters: true })!
    expect(r.isPremium).toBe(true)
    expect(r.buyLow).toBeCloseTo(20 * 100 * 1.1)
    expect(r.trimPrice).toBe(33 * 100)   // trim unchanged
  })

  it('tighten takes precedence over premium when both set', () => {
    const r = calculateBands({ ...base, eps: 100, twoWeakQuarters: true, twoStrongQuarters: true })!
    expect(r.isTightened).toBe(true)
    expect(r.isPremium).toBe(false)
  })
})

describe('calculateBands — PE anchor (Nifty 50 Index)', () => {
  // Table: buyLow: 18, buyHigh: 20, midLow: 20, midHigh: 22, trim: 24
  const base = { category: 'Nifty 50 Index' as const, twoWeakQuarters: false, twoStrongQuarters: false, isHospitalRampPhase: false }

  it('returns correct band with eps=100', () => {
    const r = calculateBands({ ...base, eps: 100 })!
    expect(r).not.toBeNull()
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(18 * 100)
    expect(r.buyHigh).toBeCloseTo(20 * 100)
    expect(r.trimPrice).toBeCloseTo(24 * 100)
  })

  it('returns null when eps is missing', () => {
    expect(calculateBands({ ...base })).toBeNull()
  })
})

describe('calculateBands — PE anchor (Nifty Next 50 Index)', () => {
  // Table: buyLow: 18, buyHigh: 21, midLow: 21, midHigh: 25, trim: 28
  const base = { category: 'Nifty Next 50 Index' as const, twoWeakQuarters: false, twoStrongQuarters: false, isHospitalRampPhase: false }

  it('returns correct band with eps=100', () => {
    const r = calculateBands({ ...base, eps: 100 })!
    expect(r).not.toBeNull()
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(18 * 100)
    expect(r.buyHigh).toBeCloseTo(21 * 100)
    expect(r.trimPrice).toBeCloseTo(28 * 100)
  })
})

describe('calculateBands — EV/EBITDA anchor (Hospitals ramp phase)', () => {
  // Table: buyLow: 18, buyHigh: 22, midLow: 23, midHigh: 28, trim: 29
  const base = { category: 'Hospitals' as const, twoWeakQuarters: false, twoStrongQuarters: false }

  it('returns correct band with ebitda=500Cr, netDebt=100Cr, shares=20Cr', () => {
    const r = calculateBands({ ...base, isHospitalRampPhase: true, ebitda: 500, netDebt: 100, shares: 20 })!
    expect(r).not.toBeNull()
    expect(r.anchorUsed).toBe('EV/EBITDA')
    expect(r.buyLow).toBeCloseTo((18 * 500 - 100) / 20)
  })

  it('returns null when ebitda is missing', () => {
    expect(calculateBands({ ...base, isHospitalRampPhase: true, shares: 20 })).toBeNull()
  })

  it('returns null when shares is zero', () => {
    expect(calculateBands({ ...base, isHospitalRampPhase: true, ebitda: 500, shares: 0 })).toBeNull()
  })
})

describe('calculateBands — Hospitals (EV in ramp, PE out of ramp)', () => {
  const base = { category: 'Hospitals' as const, twoWeakQuarters: false, twoStrongQuarters: false }

  it('uses EV/EBITDA during ramp phase', () => {
    const r = calculateBands({ ...base, isHospitalRampPhase: true, ebitda: 500, shares: 20, netDebt: 100 })!
    expect(r.anchorUsed).toBe('EV/EBITDA')
  })

  it('uses PE outside ramp phase', () => {
    const r = calculateBands({ ...base, isHospitalRampPhase: false, eps: 50 })!
    expect(r.anchorUsed).toBe('PE')
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
