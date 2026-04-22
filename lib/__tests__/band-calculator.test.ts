import { describe, it, expect } from 'vitest'
import { calculateBands, computeTranchePrices, trancheSuggestion, computeTrancheAmounts, stagedDeepCmp } from '../band-calculator'

// ── calculateBands ────────────────────────────────────────────────────────────

const noAdj = { quality: 0, stress: 0 }

describe('calculateBands — base multiples (quality=0, stress=0)', () => {
  it('Cap-Light Infra: buy 28–35×, trim 45×', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', ...noAdj, eps: 100 })!
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(2800)
    expect(r.buyHigh).toBeCloseTo(3500)
    expect(r.trimPrice).toBeCloseTo(4500)
  })

  it('Hospitals: buy 38–45×, trim 56×', () => {
    const r = calculateBands({ category: 'Hospitals', ...noAdj, eps: 50 })!
    expect(r.buyLow).toBeCloseTo(1900)
    expect(r.buyHigh).toBeCloseTo(2250)
    expect(r.trimPrice).toBeCloseTo(2800)
  })

  it('FMCG: buy 35–50×, trim 61×', () => {
    const r = calculateBands({ category: 'FMCG', ...noAdj, eps: 40 })!
    expect(r.buyLow).toBeCloseTo(1400)
    expect(r.buyHigh).toBeCloseTo(2000)
    expect(r.trimPrice).toBeCloseTo(2440)
  })

  it('Tobacco Corp: buy 20–25×, trim 31×', () => {
    const r = calculateBands({ category: 'Tobacco Corp', ...noAdj, eps: 20 })!
    expect(r.buyLow).toBeCloseTo(400)
    expect(r.buyHigh).toBeCloseTo(500)
    expect(r.trimPrice).toBeCloseTo(620)
  })

  it('Nifty 50 Index: buy 19–21×, mid from 22×, trim 23×', () => {
    const r = calculateBands({ category: 'Nifty 50 Index', ...noAdj, eps: 100 })!
    expect(r.buyLow).toBeCloseTo(1900)
    expect(r.buyHigh).toBeCloseTo(2100)   // mid(22) - 1 = 21
    expect(r.midLow).toBeCloseTo(2200)    // mid threshold = 22
    expect(r.trimPrice).toBeCloseTo(2300)
  })

  it('Nifty Next 50 Index: buy 18–20×, mid from 21×, trim 25×', () => {
    const r = calculateBands({ category: 'Nifty Next 50 Index', ...noAdj, eps: 100 })!
    expect(r.buyLow).toBeCloseTo(1800)
    expect(r.buyHigh).toBeCloseTo(2000)   // mid(21) - 1 = 20
    expect(r.midLow).toBeCloseTo(2100)    // mid threshold = 21
    expect(r.trimPrice).toBeCloseTo(2500)
  })

  it('Commodity → null (no PE table)', () => {
    expect(calculateBands({ category: 'Commodity', ...noAdj, eps: 100 })).toBeNull()
  })
})

describe('calculateBands — Quality adjustment (raises all multiples)', () => {
  it('quality=10 raises all prices by 10%', () => {
    const base = calculateBands({ category: 'Cap-Light Infra', quality: 0, stress: 0, eps: 100 })!
    const adj  = calculateBands({ category: 'Cap-Light Infra', quality: 10, stress: 0, eps: 100 })!
    expect(adj.buyLow).toBeCloseTo(base.buyLow * 1.10)
    expect(adj.buyHigh).toBeCloseTo(base.buyHigh * 1.10)
    expect(adj.midLow).toBeCloseTo(base.midLow * 1.10)
    expect(adj.midHigh).toBeCloseTo(base.midHigh * 1.10)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * 1.10)
  })

  it('quality=50 (max) raises all prices by 50%', () => {
    const base = calculateBands({ category: 'FMCG', quality: 0, stress: 0, eps: 40 })!
    const adj  = calculateBands({ category: 'FMCG', quality: 50, stress: 0, eps: 40 })!
    expect(adj.buyLow).toBeCloseTo(base.buyLow * 1.50)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * 1.50)
  })

  it('quality applies to index categories too', () => {
    const base = calculateBands({ category: 'Nifty 50 Index', quality: 0, stress: 0, eps: 100 })!
    const adj  = calculateBands({ category: 'Nifty 50 Index', quality: 20, stress: 0, eps: 100 })!
    expect(adj.buyLow).toBeCloseTo(base.buyLow * 1.20)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * 1.20)
  })
})

describe('calculateBands — Stress adjustment (lowers all multiples)', () => {
  it('stress=20 lowers all prices by 20%', () => {
    const base = calculateBands({ category: 'Cap-Light Infra', quality: 0, stress: 0, eps: 100 })!
    const adj  = calculateBands({ category: 'Cap-Light Infra', quality: 0, stress: 20, eps: 100 })!
    expect(adj.buyLow).toBeCloseTo(base.buyLow * 0.80)
    expect(adj.buyHigh).toBeCloseTo(base.buyHigh * 0.80)
    expect(adj.midLow).toBeCloseTo(base.midLow * 0.80)
    expect(adj.midHigh).toBeCloseTo(base.midHigh * 0.80)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * 0.80)
  })

  it('stress=50 (max) halves all prices', () => {
    const base = calculateBands({ category: 'Hospitals', quality: 0, stress: 0, eps: 50 })!
    const adj  = calculateBands({ category: 'Hospitals', quality: 0, stress: 50, eps: 50 })!
    expect(adj.buyLow).toBeCloseTo(base.buyLow * 0.50)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * 0.50)
  })
})

describe('calculateBands — Combined quality + stress', () => {
  it('quality=15, stress=20 → factor = 1.15 × 0.80 = 0.92', () => {
    const base   = calculateBands({ category: 'Cap-Light Infra', quality: 0, stress: 0, eps: 100 })!
    const adj    = calculateBands({ category: 'Cap-Light Infra', quality: 15, stress: 20, eps: 100 })!
    const factor = 1.15 * 0.80
    expect(adj.buyLow).toBeCloseTo(base.buyLow * factor)
    expect(adj.buyHigh).toBeCloseTo(base.buyHigh * factor)
    expect(adj.trimPrice).toBeCloseTo(base.trimPrice * factor)
  })

  it('quality and stress both at 0 is identical to noAdj', () => {
    const a = calculateBands({ category: 'FMCG', quality: 0, stress: 0, eps: 40 })!
    const b = calculateBands({ category: 'FMCG', ...noAdj, eps: 40 })!
    expect(a.buyLow).toBeCloseTo(b.buyLow)
    expect(a.trimPrice).toBeCloseTo(b.trimPrice)
  })

  it('buyLow ≤ buyHigh for every category × quality × stress combo', () => {
    const categories = ['Cap-Light Infra', 'Hospitals', 'FMCG', 'Tobacco Corp'] as const
    const cases = [
      { quality: 0, stress: 0 }, { quality: 20, stress: 0 },
      { quality: 0, stress: 30 }, { quality: 15, stress: 20 },
    ]
    for (const category of categories) {
      for (const adj of cases) {
        const r = calculateBands({ category, ...adj, eps: 50 })!
        expect(r.buyLow).toBeLessThanOrEqual(r.buyHigh)
      }
    }
  })
})

describe('calculateBands — input clamping', () => {
  it('quality above 50 is clamped to 50', () => {
    const a = calculateBands({ category: 'FMCG', quality: 50, stress: 0, eps: 40 })!
    const b = calculateBands({ category: 'FMCG', quality: 99, stress: 0, eps: 40 })!
    expect(a.buyLow).toBeCloseTo(b.buyLow)
  })

  it('stress above 50 is clamped to 50', () => {
    const a = calculateBands({ category: 'FMCG', quality: 0, stress: 50, eps: 40 })!
    const b = calculateBands({ category: 'FMCG', quality: 0, stress: 99, eps: 40 })!
    expect(a.buyLow).toBeCloseTo(b.buyLow)
  })

  it('negative quality treated as 0', () => {
    const a = calculateBands({ category: 'FMCG', quality: 0, stress: 0, eps: 40 })!
    const b = calculateBands({ category: 'FMCG', quality: -10, stress: 0, eps: 40 })!
    expect(a.buyLow).toBeCloseTo(b.buyLow)
  })
})

describe('calculateBands — null/missing eps', () => {
  it('eps missing → null', () => {
    expect(calculateBands({ category: 'FMCG', ...noAdj })).toBeNull()
  })
  it('eps null → null', () => {
    expect(calculateBands({ category: 'FMCG', ...noAdj, eps: null })).toBeNull()
  })
  it('eps 0 → null', () => {
    expect(calculateBands({ category: 'FMCG', ...noAdj, eps: 0 })).toBeNull()
  })
  it('eps negative → null', () => {
    expect(calculateBands({ category: 'FMCG', ...noAdj, eps: -10 })).toBeNull()
  })
  it('unknown category → null', () => {
    expect(calculateBands({ category: 'Commodity', ...noAdj, eps: 100 })).toBeNull()
  })
})

// ── stagedDeepCmp ─────────────────────────────────────────────────────────────

describe('stagedDeepCmp — staged buy price cap in deep value', () => {
  const buyLow = 320

  it('no prior buys → returns liveCmp unchanged', () => {
    expect(stagedDeepCmp(290, buyLow, null)).toBe(290)
  })

  it('CMP above buyLow (not deep) → returns liveCmp unchanged', () => {
    expect(stagedDeepCmp(350, buyLow, 299)).toBe(350)
  })

  it('CMP null → returns null', () => {
    expect(stagedDeepCmp(null, buyLow, 299)).toBeNull()
  })

  it('deep zone: CMP above minBuyPrice → capped at minBuyPrice - snap', () => {
    // CMP=310, buyLow=320 (deep), minBuyPrice=299 (<500 → snap=5) → min(310, 294) = 294
    expect(stagedDeepCmp(310, buyLow, 299)).toBe(294)
  })

  it('deep zone: CMP below minBuyPrice → CMP wins', () => {
    // CMP=280, minBuyPrice=299 → min(280, 294) = 280
    expect(stagedDeepCmp(280, buyLow, 299)).toBe(280)
  })

  it('deep zone: high-priced stock uses ₹10 snap unit', () => {
    // buyLow=650, CMP=610, minBuyPrice=590 (≥500 → snap=10) → min(610, 580) = 580
    expect(stagedDeepCmp(610, 650, 590)).toBe(580)
  })

  it('CMP exactly at buyLow is not deep', () => {
    expect(stagedDeepCmp(buyLow, buyLow, 299)).toBe(buyLow)
  })
})

// ── computeTranchePrices ──────────────────────────────────────────────────────

describe('computeTranchePrices', () => {
  it('CMP null: prices span full buy zone [buyLow, buyHigh]', () => {
    const prices = computeTranchePrices(1000, 1500, null, 3)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1500)
    })
  })

  it('CMP above buy zone: prices span full buy zone [buyLow, buyHigh]', () => {
    const prices = computeTranchePrices(1000, 1500, 2000, 3)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1500)
    })
  })

  it('CMP inside buy zone (no 52wk low): floor = buyLow, ceiling = CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 1200, 3)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1200)
    })
  })

  it('CMP inside buy zone (52wk low > buyLow): floor = 52wkLow', () => {
    const prices = computeTranchePrices(1000, 1500, 1200, 3, 1100)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1100)
      expect(p).toBeLessThanOrEqual(1200)
    })
  })

  it('CMP inside buy zone (52wk low < buyLow): floor = buyLow', () => {
    const prices = computeTranchePrices(1000, 1500, 1200, 3, 900)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1200)
    })
  })

  it('CMP below buy zone (deep): spreads 2–3 tranches at/below CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 800, 3)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    expect(prices.length).toBeLessThanOrEqual(3)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(800))
  })

  it('24wkLow >= CMP: falls back to buyLow floor, spreads normally', () => {
    const prices = computeTranchePrices(1000, 1500, 1150, 3, 1200)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(1000)
      expect(p).toBeLessThanOrEqual(1150)
    })
  })

  it('24wkLow = CMP exactly: spreads across buy zone, not single tranche', () => {
    const prices = computeTranchePrices(600, 720, 680, 5, 680)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(600)
      expect(p).toBeLessThanOrEqual(680)
    })
  })

  it('prices < ₹500 snap to nearest ₹5', () => {
    const prices = computeTranchePrices(200, 400, null, 3)
    prices.forEach(p => expect(p % 5).toBe(0))
  })

  it('prices ≥ ₹500 snap to nearest ₹10', () => {
    const prices = computeTranchePrices(1000, 1500, null, 3)
    prices.forEach(p => expect(p % 10).toBe(0))
  })

  it('returns deduplicated prices', () => {
    const prices = computeTranchePrices(1000, 1010, null)
    expect(prices.length).toBe(new Set(prices).size)
  })

  it('no price exceeds CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 1200, 4)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(1200))
  })

  it('index ETF deep zone: spreads multiple tranches when CMP < buyLow', () => {
    const buyLow = 684, buyHigh = 836, cmp = 676
    const prices = computeTranchePrices(buyLow, buyHigh, cmp, 4, null, true)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(cmp))
  })

  it('non-index deep zone: 2–3 tranches at/below CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 850, 4, null, false)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    expect(prices.length).toBeLessThanOrEqual(3)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(850))
  })

  it('index ETF deep zone: 52wk low respected as floor in spread', () => {
    const buyLow = 684, buyHigh = 836, cmp = 630, fiftyTwoWeekLow = 610
    const prices = computeTranchePrices(buyLow, buyHigh, cmp, 4, fiftyTwoWeekLow, true)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(fiftyTwoWeekLow)
      expect(p).toBeLessThanOrEqual(cmp)
    })
  })

  it('index ETF deep zone: 52wk low above CMP is ignored', () => {
    const prices = computeTranchePrices(684, 836, 630, 4, 640, true)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(630))
  })

  it('stress-compressed buyHigh: 52wkLow above shrunken zone falls back to buyLow floor', () => {
    // stress adjustment shrinks zone; 52wkLow ends up above buyHigh → must fall back to buyLow
    // Normal: buyLow=700, buyHigh=850. Stress compressed: buyLow=630, buyHigh=765.
    // 52wkLow=800, CMP=900 (above zone). floor=max(800,630)=800 > ceiling=765 → fallback to buyLow
    const prices = computeTranchePrices(630, 765, 900, 3, 800)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(630)
      expect(p).toBeLessThanOrEqual(775) // 765 rounds to 770 at ₹10 snap
    })
  })
})

describe('computeTranchePrices — deep zone 5% steps', () => {
  it('count=3 → 3 prices, all ≤ CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 800, 3)
    expect(prices).toHaveLength(3)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(800))
    expect(new Set(prices).size).toBe(prices.length)
  })

  it('count=2 → 2 prices', () => {
    const prices = computeTranchePrices(1000, 1500, 800, 2)
    expect(prices).toHaveLength(2)
    prices.forEach(p => expect(p).toBeLessThanOrEqual(800))
  })

  it('count capped at 3 even if caller requests more', () => {
    const prices = computeTranchePrices(1000, 1500, 800, 8)
    expect(prices.length).toBeLessThanOrEqual(3)
  })
})

// ── trancheSuggestion ─────────────────────────────────────────────────────────

describe('trancheSuggestion', () => {
  it('capped at 2% of total capital', () => {
    expect(trancheSuggestion(5_000_000, 1_000_000)).toBeLessThanOrEqual(20_000)
  })

  it('at least 1% of total capital when remaining is large', () => {
    expect(trancheSuggestion(5_000_000, 1_000_000)).toBeGreaterThanOrEqual(10_000)
  })

  it('floors at 1% of capital when remaining is very small', () => {
    expect(trancheSuggestion(5_000, 1_000_000)).toBe(10_000)
  })
})

// ── computeTrancheAmounts ─────────────────────────────────────────────────────

describe('computeTrancheAmounts — conviction-weighted sizing', () => {
  it('returns empty for count=0', () => {
    expect(computeTrancheAmounts(100_000, 0)).toEqual([])
  })

  it('returns empty for remaining=0', () => {
    expect(computeTrancheAmounts(0, 3)).toEqual([])
  })

  it('single tranche gets full remaining', () => {
    const [amt] = computeTrancheAmounts(47_300, 1)
    expect(amt).toBeCloseTo(47_300)
  })

  it('amounts sum exactly to remaining', () => {
    for (const count of [2, 3, 4, 5, 8]) {
      const remaining = 100_000
      const total = computeTrancheAmounts(remaining, count).reduce((s, a) => s + a, 0)
      expect(total).toBeCloseTo(remaining, 5)
    }
  })

  it('amounts are strictly increasing (deeper tranches get more capital)', () => {
    const amounts = computeTrancheAmounts(100_000, 4)
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]).toBeGreaterThan(amounts[i - 1])
    }
  })

  it('3-tranche: weights 1/6, 2/6, 3/6', () => {
    const remaining = 47_300
    const [a, b, c] = computeTrancheAmounts(remaining, 3)
    expect(a).toBeCloseTo(remaining * 1 / 6)
    expect(b).toBeCloseTo(remaining * 2 / 6)
    expect(c).toBeCloseTo(remaining * 3 / 6)
  })

  it('2-tranche: falls back to linear → 1/3 and 2/3', () => {
    const remaining = 90_000
    const [a, b] = computeTrancheAmounts(remaining, 2)
    expect(a).toBeCloseTo(remaining * 1 / 3)
    expect(b).toBeCloseTo(remaining * 2 / 3)
  })

  it('8-tranche: quadratic (max 64/204 ≈ 31% ≤ 40%) → last is 64× first', () => {
    const amounts = computeTrancheAmounts(360_000, 8)
    expect(amounts[7] / amounts[0]).toBeCloseTo(64)
  })

  it('4-tranche: falls back to linear (max 53% > 40%) → last is 4× first', () => {
    const amounts = computeTrancheAmounts(100_000, 4)
    expect(amounts[3] / amounts[0]).toBeCloseTo(4)
  })

  it('5-tranche: falls back to linear (max 45% > 40%) → last is 5× first', () => {
    const amounts = computeTrancheAmounts(100_000, 5)
    expect(amounts[4] / amounts[0]).toBeCloseTo(5)
  })

  it('equal=true: all tranches get identical amounts', () => {
    const amounts = computeTrancheAmounts(90_000, 3, true)
    expect(amounts).toHaveLength(3)
    amounts.forEach(a => expect(a).toBeCloseTo(30_000))
  })

  it('equal=true: sums to remaining', () => {
    const total = computeTrancheAmounts(47_300, 4, true).reduce((s, a) => s + a, 0)
    expect(total).toBeCloseTo(47_300)
  })
})
