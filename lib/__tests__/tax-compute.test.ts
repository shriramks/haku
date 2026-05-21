import { describe, it, expect } from 'vitest'
import { computeStockGains, computeMFGains, computeGoldGains } from '../tax-compute'
import type { Transaction } from '../types'
import type { MFTransaction, SGBTransaction } from '../portfolio-types'

const FY26  = { start: '2025-04-01', end: '2026-03-31' }
const AS_OF = '2026-05-21'

// ── Builders ─────────────────────────────────────────────────────────────────

function stkBuy(date: string, qty: number, price: number): Transaction {
  return { id: Math.random().toString(), symbol: 'ITC', exchange: 'NSE', trade_date: date, trade_type: 'buy', quantity: qty, price, amount: qty * price, fy_id: null, notes: '' }
}
function stkSell(date: string, qty: number, price: number): Transaction {
  return { id: Math.random().toString(), symbol: 'ITC', exchange: 'NSE', trade_date: date, trade_type: 'sell', quantity: qty, price, amount: qty * price, fy_id: null, notes: '' }
}
function mfBuy(date: string, units: number, nav: number): MFTransaction {
  return { id: Math.random().toString(), fund_id: 'fund1', trade_date: date, trade_type: 'buy', units, nav, amount: units * nav }
}
function mfSell(date: string, units: number, nav: number): MFTransaction {
  return { id: Math.random().toString(), fund_id: 'fund1', trade_date: date, trade_type: 'sell', units, nav, amount: units * nav }
}
function gldBuy(date: string, grams: number, price: number): SGBTransaction {
  return { id: Math.random().toString(), trade_date: date, trade_type: 'buy', grams, price_per_gram: price, amount: grams * price, maturity_date: null, gold_type: 'sgb', name: 'SGB Series I' }
}
function gldSell(date: string, grams: number, price: number): SGBTransaction {
  return { id: Math.random().toString(), trade_date: date, trade_type: 'sell', grams, price_per_gram: price, amount: grams * price, maturity_date: null, gold_type: 'sgb', name: 'SGB Series I' }
}

// ── computeStockGains — basic FIFO ───────────────────────────────────────────

describe('computeStockGains — FIFO', () => {
  it('no transactions → empty realised and unrealised', () => {
    const r = computeStockGains([], 'ITC', null, FY26, AS_OF)
    expect(r.realised).toEqual([])
    expect(r.unrealised).toEqual([])
  })

  it('buy only → no realised, one unrealised position', () => {
    const r = computeStockGains([stkBuy('2025-06-01', 100, 500)], 'ITC', 600, FY26, AS_OF)
    expect(r.realised).toHaveLength(0)
    expect(r.unrealised).toHaveLength(1)
    expect(r.unrealised[0].qty).toBe(100)
    expect(r.unrealised[0].costPerUnit).toBe(500)
    expect(r.unrealised[0].currentValue).toBeCloseTo(60_000)
    expect(r.unrealised[0].gain).toBeCloseTo(10_000)
  })

  it('sell within FY → one realised gain entry with correct values', () => {
    const txns = [stkBuy('2023-06-01', 100, 500), stkSell('2025-06-01', 50, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised).toHaveLength(1)
    const g = r.realised[0]
    expect(g.qty).toBe(50)
    expect(g.saleValue).toBeCloseTo(50 * 700)
    expect(g.purchaseCost).toBeCloseTo(50 * 500)
    expect(g.gain).toBeCloseTo(50 * 200)
  })

  it('partial sell: oldest lot consumed first', () => {
    // lot1: 100@500 (older), lot2: 100@800 — sell 60 takes only from lot1
    const txns = [stkBuy('2023-01-01', 100, 500), stkBuy('2024-01-01', 100, 800), stkSell('2025-06-01', 60, 1000)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised).toHaveLength(1)
    expect(r.realised[0].purchaseDate).toBe('2023-01-01')
    expect(r.realised[0].qty).toBe(60)
    expect(r.unrealised).toHaveLength(2)
    expect(r.unrealised[0].qty).toBeCloseTo(40)   // remainder of lot1
    expect(r.unrealised[1].qty).toBe(100)          // lot2 untouched
  })

  it('sell spanning two lots → two realised entries', () => {
    // lot1: 50@500, lot2: 100@800 — sell 80 exhausts lot1 and takes 30 from lot2
    const txns = [stkBuy('2023-01-01', 50, 500), stkBuy('2024-01-01', 100, 800), stkSell('2025-06-01', 80, 1000)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised).toHaveLength(2)
    expect(r.realised[0].purchaseDate).toBe('2023-01-01')
    expect(r.realised[0].qty).toBe(50)
    expect(r.realised[1].purchaseDate).toBe('2024-01-01')
    expect(r.realised[1].qty).toBe(30)
  })

  it('loss lot: sell below cost → negative gain', () => {
    const txns = [stkBuy('2023-06-01', 100, 500), stkSell('2025-06-01', 100, 400)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised[0].gain).toBeCloseTo(-10_000)
  })

  it('full exit → no unrealised positions', () => {
    const txns = [stkBuy('2023-06-01', 100, 500), stkSell('2025-06-01', 100, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.unrealised).toHaveLength(0)
  })

  it('oversell: lots exhausted before quantity met → no crash', () => {
    const txns = [stkBuy('2025-06-01', 50, 500), stkSell('2025-08-01', 100, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised[0].qty).toBe(50)  // only 50 available
    expect(r.unrealised).toHaveLength(0)
  })
})

// ── computeStockGains — LTCG / STCG classification ───────────────────────────
// 2023-06-01 → 2024-05-30 = 364 days (STCG)
// 2023-06-01 → 2024-05-31 = 365 days (LTCG)

describe('computeStockGains — gain type', () => {
  const FY25 = { start: '2024-04-01', end: '2025-03-31' }

  it('364 days → STCG', () => {
    const txns = [stkBuy('2023-06-01', 100, 500), stkSell('2024-05-30', 100, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY25, AS_OF)
    expect(r.realised[0].holdingDays).toBe(364)
    expect(r.realised[0].gainType).toBe('STCG')
  })

  it('365 days → LTCG', () => {
    const txns = [stkBuy('2023-06-01', 100, 500), stkSell('2024-05-31', 100, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY25, AS_OF)
    expect(r.realised[0].holdingDays).toBe(365)
    expect(r.realised[0].gainType).toBe('LTCG')
  })
})

// ── computeStockGains — FY range filter ──────────────────────────────────────

describe('computeStockGains — FY range', () => {
  it('sell outside FY → not in realised output', () => {
    const txns = [stkBuy('2023-01-01', 100, 500), stkSell('2024-06-01', 50, 700)]  // FY25 sell, reporting FY26
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised).toHaveLength(0)
  })

  it('FY25 sell excluded but still advances FIFO; FY26 sell consumes the correct remaining lot', () => {
    const txns = [
      stkBuy('2023-01-01', 100, 500),
      stkSell('2024-06-01', 30, 700),  // FY25 — excluded from output, FIFO still runs
      stkSell('2025-06-01', 40, 800),  // FY26 — included
    ]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.realised).toHaveLength(1)
    expect(r.realised[0].qty).toBe(40)
    expect(r.realised[0].purchaseDate).toBe('2023-01-01')
  })

  it('unrealised reflects all remaining lots regardless of FY filter', () => {
    const txns = [stkBuy('2023-01-01', 100, 500), stkSell('2024-06-01', 30, 700)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.unrealised[0].qty).toBeCloseTo(70)  // 30 consumed by FY25 sell
  })
})

// ── computeStockGains — unrealised positions ─────────────────────────────────

describe('computeStockGains — unrealised', () => {
  it('gain type uses asOf date for holding period', () => {
    // buy 2024-05-01, asOf 2026-05-21 → 751 days → LTCG
    const r = computeStockGains([stkBuy('2024-05-01', 100, 500)], 'ITC', 600, FY26, '2026-05-21')
    expect(r.unrealised[0].gainType).toBe('LTCG')
  })

  it('currentValue and gain are null when no CMP', () => {
    const r = computeStockGains([stkBuy('2025-06-01', 100, 500)], 'ITC', null, FY26, AS_OF)
    expect(r.unrealised[0].currentValue).toBeNull()
    expect(r.unrealised[0].gain).toBeNull()
  })

  it('multiple open lots produce one unrealised entry per lot', () => {
    const txns = [stkBuy('2024-01-01', 50, 400), stkBuy('2025-01-01', 80, 600)]
    const r = computeStockGains(txns, 'ITC', null, FY26, AS_OF)
    expect(r.unrealised).toHaveLength(2)
  })
})

// ── computeMFGains — grandfathering ──────────────────────────────────────────

describe('computeMFGains — grandfathering', () => {
  // Scenario A: FMV (120) > actual cost (50), sell at 200
  // effective cost = max(50, min(120, 200)) = 120 → gain = (200-120)*100
  it('LTCG pre-2018: effective cost steps up to FMV when FMV > actual cost', () => {
    const txns = [mfBuy('2016-06-01', 100, 50), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', 120, null, FY26, AS_OF)
    expect(r.realised[0].gainType).toBe('LTCG')
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 120)
    expect(r.realised[0].gain).toBeCloseTo(100 * (200 - 120))
  })

  // Scenario B: actual cost (150) > FMV (120), sell at 200
  // effective cost = max(150, min(120, 200)) = 150 → use actual cost
  it('LTCG pre-2018: actual cost used when actual cost > FMV', () => {
    const txns = [mfBuy('2016-06-01', 100, 150), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', 120, null, FY26, AS_OF)
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 150)
    expect(r.realised[0].gain).toBeCloseTo(100 * 50)
  })

  // Scenario C: FMV (300) > sale price (200) → effective cost capped at sale price → gain = 0
  it('LTCG pre-2018: effective cost capped at sale price when FMV > sale price (no artificial loss)', () => {
    const txns = [mfBuy('2016-06-01', 100, 50), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', 300, null, FY26, AS_OF)  // fmvJan2018 = 300
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 200)
    expect(r.realised[0].gain).toBeCloseTo(0)
  })

  it('STCG on pre-2018 lot: grandfathering not applied', () => {
    const FY19 = { start: '2018-04-01', end: '2019-03-31' }
    const txns = [mfBuy('2018-01-01', 100, 50), mfSell('2018-06-01', 100, 80)]  // ~150 days → STCG
    const r = computeMFGains(txns, 'fund1', 120, null, FY19, AS_OF)
    expect(r.realised[0].gainType).toBe('STCG')
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 50)  // actual cost, no step-up
  })

  it('post-2018 lot: grandfathering never applied even for LTCG', () => {
    const txns = [mfBuy('2019-01-01', 100, 80), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', 200, null, FY26, AS_OF)
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 80)
  })

  it('fmvJan2018 null → actual cost used for pre-2018 lots (grandfather skipped)', () => {
    const txns = [mfBuy('2016-06-01', 100, 50), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', null, null, FY26, AS_OF)  // fmvJan2018 = null
    expect(r.realised[0].purchaseCost).toBeCloseTo(100 * 50)
  })

  it('mixed pre- and post-2018 lots: grandfather applies only to pre-2018 portion', () => {
    // lot1: pre-2018, 50 units @ 40, FMV = 100 → effective cost = 100
    // lot2: post-2018, 50 units @ 120 → effective cost = 120
    // sell 100 units @ 200
    const txns = [mfBuy('2016-06-01', 50, 40), mfBuy('2019-01-01', 50, 120), mfSell('2026-01-01', 100, 200)]
    const r = computeMFGains(txns, 'fund1', 100, null, FY26, AS_OF)
    expect(r.realised).toHaveLength(2)
    expect(r.realised[0].purchaseCost).toBeCloseTo(50 * 100)   // pre-2018, FMV-based
    expect(r.realised[1].purchaseCost).toBeCloseTo(50 * 120)   // post-2018, actual cost
  })
})

// ── computeGoldGains — 3-year LTCG threshold ─────────────────────────────────
// 2021-01-01 → 2023-12-31 = 1094 days (STCG)
// 2021-01-01 → 2024-01-01 = 1095 days (LTCG)

describe('computeGoldGains — LTCG/STCG', () => {
  const FY24 = { start: '2023-04-01', end: '2024-03-31' }

  it('1094 days → STCG', () => {
    const txns = [gldBuy('2021-01-01', 10, 4000), gldSell('2023-12-31', 10, 6000)]
    const r = computeGoldGains(txns, 'sgb', null, FY24, AS_OF)
    expect(r.realised[0].holdingDays).toBe(1094)
    expect(r.realised[0].gainType).toBe('STCG')
  })

  it('1095 days → LTCG', () => {
    const txns = [gldBuy('2021-01-01', 10, 4000), gldSell('2024-01-01', 10, 6000)]
    const r = computeGoldGains(txns, 'sgb', null, FY24, AS_OF)
    expect(r.realised[0].holdingDays).toBe(1095)
    expect(r.realised[0].gainType).toBe('LTCG')
  })

  it('unrealised gold uses 1095-day threshold', () => {
    // buy 2022-01-01, asOf 2026-05-21 → 1601 days → LTCG
    const r = computeGoldGains([gldBuy('2022-01-01', 10, 4000)], 'sgb', 7000, FY26, '2026-05-21')
    expect(r.unrealised[0].gainType).toBe('LTCG')
    expect(r.unrealised[0].gain).toBeCloseTo(10 * (7000 - 4000))
  })

  it('gold gain and unrealised computed in grams', () => {
    const txns = [gldBuy('2021-01-01', 10, 4000), gldSell('2024-01-01', 6, 6000)]
    const r = computeGoldGains(txns, 'sgb', 7000, FY24, AS_OF)
    expect(r.realised[0].qty).toBe(6)
    expect(r.realised[0].saleValue).toBeCloseTo(6 * 6000)
    expect(r.realised[0].gain).toBeCloseTo(6 * (6000 - 4000))
    expect(r.unrealised[0].qty).toBeCloseTo(4)
    expect(r.unrealised[0].currentValue).toBeCloseTo(4 * 7000)
  })
})
