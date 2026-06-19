import { describe, it, expect } from 'vitest'
import {
  calculateBands,
  computeGrowth,
  computeTranchePrices,
  trancheSuggestion,
  computeTrancheAmounts,
  stagedDeepCmp,
  deriveIndexEps,
  getCostOfEquity,
  getSizeMod,
  isBandStale,
  convictionMatrix,
  effectiveBands,
} from '../band-calculator'

// ── calculateBands — base multiples (no factor inputs → Path B, sizeMod=1, no ROCE → factor=1) ──

describe('calculateBands — base multiples', () => {
  it('Cap-Light Infra: buy 28–35×, trim 45×', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100 })!
    expect(r.anchorUsed).toBe('PE')
    expect(r.buyLow).toBeCloseTo(2800)
    expect(r.buyHigh).toBeCloseTo(3500)
    expect(r.trimPrice).toBeCloseTo(4500)
  })

  it('Hospitals: buy 38–45×, trim 56×', () => {
    const r = calculateBands({ category: 'Hospitals', eps: 50 })!
    expect(r.buyLow).toBeCloseTo(1900)
    expect(r.buyHigh).toBeCloseTo(2250)
    expect(r.trimPrice).toBeCloseTo(2800)
  })

  it('Branded Pharma: buy 20–26×, trim 33×', () => {
    const r = calculateBands({ category: 'Branded Pharma', eps: 50 })!
    expect(r.buyLow).toBeCloseTo(1000)
    expect(r.buyHigh).toBeCloseTo(1300)
    expect(r.trimPrice).toBeCloseTo(1650)
  })

  it('Tobacco Corp: buy 20–25×, trim 31×', () => {
    const r = calculateBands({ category: 'Tobacco Corp', eps: 20 })!
    expect(r.buyLow).toBeCloseTo(400)
    expect(r.buyHigh).toBeCloseTo(500)
    expect(r.trimPrice).toBeCloseTo(620)
  })

  it('factor=1 when no g/ke/mcap/roce provided', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100 })!
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.path).toBe('B')
    expect(r.rocePremium).toBe(false)
  })

  it('buyLow ≤ buyHigh for every stock category', () => {
    const categories = ['Cap-Light Infra', 'Hospitals', 'Tobacco Corp', 'Branded Pharma'] as const
    for (const category of categories) {
      const r = calculateBands({ category, eps: 50 })!
      expect(r.buyLow).toBeLessThanOrEqual(r.buyHigh)
    }
  })
})

// ── calculateBands — index ETF bands (v9 PE thresholds) ──────────────────────

describe('calculateBands — index ETF bands (v9 PE thresholds)', () => {
  it('Nifty 50 Index: buy 18–20×, mid 20–22×, trim 24×', () => {
    const r = calculateBands({ category: 'Nifty 50 Index', eps: 100 })!
    expect(r.path).toBe('index')
    expect(r.factor).toBe(1)
    expect(r.buyLow).toBeCloseTo(1800)
    expect(r.buyHigh).toBeCloseTo(2000)
    expect(r.midLow).toBeCloseTo(2000)
    expect(r.midHigh).toBeCloseTo(2200)
    expect(r.trimPrice).toBeCloseTo(2400)
  })

  it('Nifty Next 50 Index: buy 22–25×, mid 25–28×, trim 32×', () => {
    const r = calculateBands({ category: 'Nifty Next 50 Index', eps: 100 })!
    expect(r.path).toBe('index')
    expect(r.factor).toBe(1)
    expect(r.buyLow).toBeCloseTo(2200)
    expect(r.buyHigh).toBeCloseTo(2500)
    expect(r.midLow).toBeCloseTo(2500)
    expect(r.midHigh).toBeCloseTo(2800)
    expect(r.trimPrice).toBeCloseTo(3200)
  })

  it('index path ignores g/ke/mcap/roce inputs', () => {
    const r = calculateBands({ category: 'Nifty 50 Index', eps: 100, g: 0.15, ke: 0.12, mcap: 10000 })!
    expect(r.path).toBe('index')
    expect(r.factor).toBe(1)
    expect(r.buyLow).toBeCloseTo(1800)
  })
})

// ── getSizeMod ────────────────────────────────────────────────────────────────

describe('getSizeMod', () => {
  it('<50k → 1.00', () => expect(getSizeMod(49_999)).toBe(1.00))
  it('=50k → 0.97', () => expect(getSizeMod(50_000)).toBe(0.97))
  it('<1L → 0.97', () => expect(getSizeMod(99_999)).toBe(0.97))
  it('=1L → 0.94', () => expect(getSizeMod(100_000)).toBe(0.94))
  it('<2L → 0.94', () => expect(getSizeMod(199_999)).toBe(0.94))
  it('=2L → 0.90', () => expect(getSizeMod(200_000)).toBe(0.90))
  it('very large → 0.90', () => expect(getSizeMod(10_000_000)).toBe(0.90))
})

describe('shared helper functions', () => {
  describe('computeGrowth', () => {
    it('computes 3-year CAGR from PAT values', () => {
      expect(computeGrowth(172.8, 100)).toBeCloseTo(0.2, 6)
    })

    it('returns null when current PAT is missing', () => {
      expect(computeGrowth(null, 100)).toBeNull()
    })

    it('returns null when prior PAT is zero or negative', () => {
      expect(computeGrowth(100, 0)).toBeNull()
      expect(computeGrowth(100, -50)).toBeNull()
    })
  })

  describe('deriveIndexEps', () => {
    it('derives ETF per-unit earnings as CMP / index PE', () => {
      // NIFTYBEES ~273 at index PE 20.8 → one PE point ≈ ₹13.13
      expect(deriveIndexEps(273, 20.8)).toBeCloseTo(13.125, 2)
    })

    it('returns null when CMP or index PE is missing or invalid', () => {
      expect(deriveIndexEps(null, 20.8)).toBeNull()
      expect(deriveIndexEps(273, null)).toBeNull()
      expect(deriveIndexEps(273, 0)).toBeNull()
    })
  })

  describe('getCostOfEquity', () => {
    it('adds the default ERP to risk-free rate', () => {
      expect(getCostOfEquity(0.07)).toBeCloseTo(0.12)
    })
  })

  describe('isBandStale', () => {
    it('returns true when financial inputs were updated after bands were generated', () => {
      expect(isBandStale('2026-05-01T10:00:00.000Z', '2026-05-01T10:05:00.000Z')).toBe(true)
    })

    it('returns false when generated timestamp is newer or timestamps are missing', () => {
      expect(isBandStale('2026-05-01T10:05:00.000Z', '2026-05-01T10:00:00.000Z')).toBe(false)
      expect(isBandStale(null, '2026-05-01T10:00:00.000Z')).toBe(false)
      expect(isBandStale('2026-05-01T10:00:00.000Z', null)).toBe(false)
    })
  })
})

// ── calculateBands — Path A (Damodaran stable-growth DDM) ───────────────────

describe('calculateBands — Path A', () => {
  it('uses Path A when Ke > g and Ke-g >= 0.02', () => {
    const r = calculateBands({ category: 'Tobacco Corp', eps: 20, g: 0.08, ke: 0.12 })!
    expect(r.path).toBe('A')
  })

  it('ITC example: g=0.08, Ke=0.12 → PE_intrinsic=27, factor=clamp(27/22.5,0.60,1.00)=1.00', () => {
    const r = calculateBands({ category: 'Tobacco Corp', eps: 16.4, g: 0.08, ke: 0.12, roce3yrAvg: 36.8 })!
    expect(r.path).toBe('A')
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.rocePremium).toBe(false)
    expect(r.buyLow).toBeCloseTo(328)
    expect(r.buyHigh).toBeCloseTo(410)
  })

  it('clamps factor to 0.60 minimum when PE_intrinsic << midpoint', () => {
    // g=-0.01, Ke=0.12 → ke-g=0.13 → PE_intrinsic=0.99/0.13≈7.62, midpoint=22.5
    // factor = clamp(7.62/22.5, 0.60, 1.00) = 0.60
    const r = calculateBands({ category: 'Tobacco Corp', eps: 20, g: -0.01, ke: 0.12 })!
    expect(r.path).toBe('A')
    expect(r.factor).toBeCloseTo(0.60)
  })

  it('clamps factor to 1.00 maximum when PE_intrinsic >> midpoint', () => {
    // g=0.115, Ke=0.12 → ke-g=0.005 < 0.02 → Path B, not A
    // so test with ke-g=0.03: g=0.09, ke=0.12 → PE_intrinsic=1.09/0.03≈36.3, midpoint=22.5
    // factor = clamp(36.3/22.5, 0.60, 1.00) = 1.00
    const r = calculateBands({ category: 'Tobacco Corp', eps: 20, g: 0.09, ke: 0.12 })!
    expect(r.path).toBe('A')
    expect(r.factor).toBeCloseTo(1.00)
  })

  it('falls to Path B when Ke == g', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.12, ke: 0.12 })!
    expect(r.path).toBe('B')
  })

  it('falls to Path B when Ke-g < 0.02', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.11, ke: 0.12 })!
    expect(r.path).toBe('B')
  })

  it('falls to Path B when g > Ke', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12 })!
    expect(r.path).toBe('B')
  })

  it('falls to Path B when ke is null', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.08 })!
    expect(r.path).toBe('B')
  })
})

// ── calculateBands — Path B (empirical) ─────────────────────────────────────

describe('calculateBands — Path B', () => {
  it('uses Path B when g > Ke', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12 })!
    expect(r.path).toBe('B')
  })

  it('applies sizeMod from mcap (mcap=18737 < 50k → sizeMod=1.00)', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12, mcap: 18737 })!
    expect(r.path).toBe('B')
    // No ROCE → factor = min(1.00, 1.00) = 1.00
    expect(r.factor).toBeCloseTo(1.00)
  })

  it('applies sizeMod for large-cap (mcap=250000 ≥ 2L → sizeMod=0.90)', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12, mcap: 250_000 })!
    expect(r.path).toBe('B')
    expect(r.factor).toBeCloseTo(0.90)
    expect(r.buyLow).toBeCloseTo(2800 * 0.90)
  })

  it('defaults sizeMod to 1.00 when mcap is null', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12 })!
    expect(r.factor).toBeCloseTo(1.00)
  })
})

// ── calculateBands — ROCE premium ────────────────────────────────────────────

describe('calculateBands — ROCE premium', () => {
  it('Cap-Light threshold=22% → premium when ROCE > 44%', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12, mcap: 18737, roce3yrAvg: 44.1 })!
    expect(r.rocePremium).toBe(true)
    expect(r.factor).toBeCloseTo(1.15)
  })

  it('no premium when ROCE ≤ 44% (Cap-Light)', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12, mcap: 18737, roce3yrAvg: 43.9 })!
    expect(r.rocePremium).toBe(false)
    expect(r.factor).toBeCloseTo(1.00)
  })

  it('Tobacco Corp threshold=20% → premium when ROCE > 40%', () => {
    const r = calculateBands({ category: 'Tobacco Corp', eps: 20, g: 0.15, ke: 0.12, roce3yrAvg: 40.1 })!
    expect(r.rocePremium).toBe(true)
    expect(r.factor).toBeCloseTo(1.15)
  })

  it('Hospitals threshold=16% → premium when ROCE > 32%', () => {
    const r = calculateBands({ category: 'Hospitals', eps: 50, g: 0.20, ke: 0.12, roce3yrAvg: 32.1 })!
    expect(r.rocePremium).toBe(true)
  })

  it('Branded Pharma threshold=18% → premium when ROCE > 36%', () => {
    const r = calculateBands({ category: 'Branded Pharma', eps: 50, g: 0.20, ke: 0.12, roce3yrAvg: 36.1 })!
    expect(r.rocePremium).toBe(true)
  })

  it('ROCE premium caps factor at 1.15', () => {
    // Path B sizeMod=1.00, ROCE premium → min(1.00*1.15, 1.15)=1.15
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12, roce3yrAvg: 50 })!
    expect(r.factor).toBeCloseTo(1.15)
  })

  it('ROCE premium on Path A when ROCE qualifies', () => {
    // ITC: Path A factor=1.00, ROCE=36.8 vs 40 threshold — no premium
    // Use ROCE=41 > 40 to trigger premium
    const r = calculateBands({ category: 'Tobacco Corp', eps: 16.4, g: 0.08, ke: 0.12, roce3yrAvg: 41 })!
    expect(r.path).toBe('A')
    expect(r.rocePremium).toBe(true)
    expect(r.factor).toBeCloseTo(1.15)
  })

  it('no premium when roce3yrAvg is null', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 100, g: 0.15, ke: 0.12 })!
    expect(r.rocePremium).toBe(false)
  })
})

// ── calculateBands — worked examples (Ke=0.12, risk_free=0.07) ───────────────

describe('calculateBands — worked examples', () => {
  it('ITC (Tobacco Corp): Path A, factor=1.00, no ROCE premium', () => {
    const r = calculateBands({ category: 'Tobacco Corp', eps: 16.4, g: 0.08, ke: 0.12, roce3yrAvg: 36.8 })!
    expect(r.path).toBe('A')
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.rocePremium).toBe(false)
    expect(r.buyLow).toBeCloseTo(328)
    expect(r.buyHigh).toBeCloseTo(410)
    expect(r.midLow).toBeCloseTo(426.4, 0)
    expect(r.midHigh).toBeCloseTo(492, 0)
    expect(r.trimPrice).toBeCloseTo(508.4, 0)
  })

  it('CAMS (Cap-Light Infra): Path B, sizeMod=1.00, ROCE premium → factor=1.15', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 18.1, g: 0.15, ke: 0.12, mcap: 18_737, roce3yrAvg: 54.8 })!
    expect(r.path).toBe('B')
    expect(r.factor).toBeCloseTo(1.15)
    expect(r.rocePremium).toBe(true)
    expect(r.buyLow).toBeCloseTo(582.82, 2)
    expect(r.buyHigh).toBeCloseTo(728.525, 3)
    expect(r.midLow).toBeCloseTo(749.34, 2)
    expect(r.midHigh).toBeCloseTo(915.86, 2)
    expect(r.trimPrice).toBeCloseTo(936.675, 3)
  })

  it('IEX (Cap-Light Infra): Path B, sizeMod=1.00, no ROCE premium → factor=1.00', () => {
    const r = calculateBands({ category: 'Cap-Light Infra', eps: 5.53, g: 0.14, ke: 0.12, mcap: 11_185 })!
    expect(r.path).toBe('B')
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.rocePremium).toBe(false)
    expect(r.buyLow).toBeCloseTo(154.84, 0)
    expect(r.buyHigh).toBeCloseTo(193.55, 0)
  })

  it('NH (Hospitals): Path B, sizeMod=1.00, ROCE=20.8% < 32% → no premium', () => {
    const r = calculateBands({ category: 'Hospitals', eps: 39.5, g: 0.21, ke: 0.12, mcap: 36_137, roce3yrAvg: 20.8 })!
    expect(r.path).toBe('B')
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.rocePremium).toBe(false)
    expect(r.buyLow).toBeCloseTo(1501)
    expect(r.buyHigh).toBeCloseTo(1777.5, 0)
  })

  it('Caplin Point (Branded Pharma): Path B, sizeMod=1.00, no ROCE premium → factor=1.00', () => {
    const r = calculateBands({ category: 'Branded Pharma', eps: 80, g: 0.20, ke: 0.12, mcap: 13_070 })!
    expect(r.path).toBe('B')
    expect(r.factor).toBeCloseTo(1.00)
    expect(r.buyLow).toBeCloseTo(1600)
    expect(r.buyHigh).toBeCloseTo(2080)
    expect(r.midLow).toBeCloseTo(2160)
    expect(r.midHigh).toBeCloseTo(2560)
    expect(r.trimPrice).toBeCloseTo(2640)
  })
})

// ── calculateBands — null/missing eps ────────────────────────────────────────

describe('calculateBands — null/missing eps', () => {
  it('eps missing → null', () => {
    expect(calculateBands({ category: 'Cap-Light Infra' })).toBeNull()
  })
  it('eps null → null', () => {
    expect(calculateBands({ category: 'Cap-Light Infra', eps: null })).toBeNull()
  })
  it('eps 0 → null', () => {
    expect(calculateBands({ category: 'Cap-Light Infra', eps: 0 })).toBeNull()
  })
  it('eps negative → null', () => {
    expect(calculateBands({ category: 'Cap-Light Infra', eps: -10 })).toBeNull()
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

  it('CMP below buy zone (deep): spreads tranches at/below CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 800, 3)
    expect(prices.length).toBeGreaterThanOrEqual(2)
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

  it('non-index deep zone: count drives tranche count', () => {
    const prices = computeTranchePrices(1000, 1500, 850, 4, null, false)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    expect(prices.length).toBeLessThanOrEqual(4)
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
    const prices = computeTranchePrices(630, 765, 900, 3, 800)
    expect(prices.length).toBeGreaterThan(1)
    prices.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(630)
      expect(p).toBeLessThanOrEqual(775)
    })
  })
})

describe('computeTranchePrices — deep zone parameterised spread', () => {
  it('count=3, default deepExtension=0.05 → 3 prices, all ≤ CMP', () => {
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

  it('count=7, deepExtension=0.10 → up to 7 prices spread across 10% below CMP', () => {
    const prices = computeTranchePrices(1000, 1500, 1000, 7, null, false, null, 0.10)
    expect(prices.length).toBeGreaterThanOrEqual(2)
    expect(prices.length).toBeLessThanOrEqual(7)
    prices.forEach(p => {
      expect(p).toBeLessThanOrEqual(1000)
      expect(p).toBeGreaterThanOrEqual(1000 * 0.90 - 10)
    })
  })
})

// ── convictionMatrix ──────────────────────────────────────────────────────────

describe('convictionMatrix', () => {
  const BUY_LOW = 800, BUY_HIGH = 1000

  it('MID zone → blocked regardless of signal', () => {
    expect(convictionMatrix('MID', 'ADD_AGGRESSIVELY', BUY_LOW, BUY_HIGH).trancheCount).toBe(0)
    expect(convictionMatrix('MID', 'WAIT', BUY_LOW, BUY_HIGH).trancheCount).toBe(0)
  })

  it('WATCH zone → blocked', () => {
    expect(convictionMatrix('WATCH', 'ADD_AGGRESSIVELY', BUY_LOW, BUY_HIGH).trancheCount).toBe(0)
  })

  it('TRIM zone → blocked', () => {
    expect(convictionMatrix('TRIM', 'TRIM', BUY_LOW, BUY_HIGH).trancheCount).toBe(0)
  })

  it('DEEP_VALUE + ADD_AGGRESSIVELY → 7 tranches, cubic, 10% extension', () => {
    const p = convictionMatrix('DEEP_VALUE', 'ADD_AGGRESSIVELY', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(7)
    expect(p.weightMode).toBe('cubic')
    expect(p.deepExtension).toBe(0.10)
    expect(p.ceilingOverride).toBeNull()
  })

  it('DEEP_VALUE + ADD_SLOWLY → 4 tranches, quadratic, 7% extension', () => {
    const p = convictionMatrix('DEEP_VALUE', 'ADD_SLOWLY', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(4)
    expect(p.weightMode).toBe('quadratic')
    expect(p.deepExtension).toBe(0.07)
  })

  it('DEEP_VALUE + WAIT → 3 tranches, equal, 5% extension', () => {
    const p = convictionMatrix('DEEP_VALUE', 'WAIT', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(3)
    expect(p.weightMode).toBe('equal')
    expect(p.deepExtension).toBe(0.05)
  })

  it('DEEP_VALUE + INSUFFICIENT_DATA → treated as WAIT', () => {
    const p = convictionMatrix('DEEP_VALUE', 'INSUFFICIENT_DATA', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(3)
    expect(p.weightMode).toBe('equal')
  })

  it('BUY + ADD_AGGRESSIVELY → 5 tranches, cubic', () => {
    const p = convictionMatrix('BUY', 'ADD_AGGRESSIVELY', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(5)
    expect(p.weightMode).toBe('cubic')
    expect(p.ceilingOverride).toBeNull()
  })

  it('BUY + ADD_SLOWLY → 4 tranches, quadratic', () => {
    const p = convictionMatrix('BUY', 'ADD_SLOWLY', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(4)
    expect(p.weightMode).toBe('quadratic')
  })

  it('BUY + WAIT → 2 tranches, equal, ceiling at zone midpoint', () => {
    const p = convictionMatrix('BUY', 'WAIT', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(2)
    expect(p.weightMode).toBe('equal')
    expect(p.ceilingOverride).toBeCloseTo(900)
  })

  it('BUY + INSUFFICIENT_DATA → treated as WAIT (2 tranches, equal)', () => {
    const p = convictionMatrix('BUY', 'INSUFFICIENT_DATA', BUY_LOW, BUY_HIGH)
    expect(p.trancheCount).toBe(2)
    expect(p.weightMode).toBe('equal')
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

  it("'equal': all tranches get identical amounts", () => {
    const amounts = computeTrancheAmounts(90_000, 3, 'equal')
    expect(amounts).toHaveLength(3)
    amounts.forEach(a => expect(a).toBeCloseTo(30_000))
  })

  it("'equal': sums to remaining", () => {
    const total = computeTrancheAmounts(47_300, 4, 'equal').reduce((s, a) => s + a, 0)
    expect(total).toBeCloseTo(47_300)
  })

  it("'cubic': amounts are strongly bottom-heavy without linear fallback", () => {
    // 3 tranches: weights 1, 8, 27 → total 36; last = 27/36 = 75% of capital
    const amounts = computeTrancheAmounts(36_000, 3, 'cubic')
    expect(amounts[0]).toBeCloseTo(1_000)
    expect(amounts[1]).toBeCloseTo(8_000)
    expect(amounts[2]).toBeCloseTo(27_000)
  })

  it("'cubic': sums to remaining", () => {
    for (const count of [2, 3, 5, 7]) {
      const total = computeTrancheAmounts(100_000, count, 'cubic').reduce((s, a) => s + a, 0)
      expect(total).toBeCloseTo(100_000, 5)
    }
  })

  it("'cubic': strictly increasing (deeper tranches get more capital)", () => {
    const amounts = computeTrancheAmounts(100_000, 5, 'cubic')
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]).toBeGreaterThan(amounts[i - 1])
    }
  })
})

describe('effectiveBands — risk overlay single source', () => {
  const raw = {
    buy_low: 100, buy_high: 120,
    mid_low: 121, mid_high: 140, trim_price: 150,
  }

  it('passes raw values through when no overlay (null multiplier)', () => {
    const eb = effectiveBands({ ...raw, risk_multiplier: null })
    expect(eb).toMatchObject({
      buyLow: 100, buyHigh: 120, midLow: 121, midHigh: 140, trimPrice: 150,
      riskMultiplier: null, hasOverlay: false,
    })
  })

  it('treats a multiplier of 1 as no overlay', () => {
    const eb = effectiveBands({ ...raw, risk_multiplier: 1 })
    expect(eb.hasOverlay).toBe(false)
    expect(eb.riskMultiplier).toBeNull()
    expect(eb.buyLow).toBe(100)
  })

  it('scales every band by the multiplier when overlay is active', () => {
    const eb = effectiveBands({ ...raw, risk_multiplier: 0.9 })
    expect(eb.hasOverlay).toBe(true)
    expect(eb.riskMultiplier).toBe(0.9)
    expect(eb.buyLow).toBeCloseTo(90)
    expect(eb.buyHigh).toBeCloseTo(108)
    expect(eb.midLow).toBeCloseTo(108.9)
    expect(eb.midHigh).toBeCloseTo(126)
    expect(eb.trimPrice).toBeCloseTo(135)
  })

  it('falls back to buy_high for missing mid bands (legacy rows), then scales', () => {
    const eb = effectiveBands({
      buy_low: 100, buy_high: 120, trim_price: 150, risk_multiplier: 0.9,
    })
    expect(eb.midLow).toBeCloseTo(108)   // 120 * 0.9
    expect(eb.midHigh).toBeCloseTo(108)  // 120 * 0.9
  })

  it('returns all-null for a null band row', () => {
    const eb = effectiveBands(null)
    expect(eb).toMatchObject({
      buyLow: null, buyHigh: null, midLow: null, midHigh: null,
      trimPrice: null, riskMultiplier: null, hasOverlay: false,
    })
  })

  it('preserves nulls (does not coerce) when scaling', () => {
    const eb = effectiveBands({ buy_low: 100, buy_high: 120, risk_multiplier: 0.9 })
    expect(eb.trimPrice).toBeNull()
  })
})
