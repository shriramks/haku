import { describe, it, expect } from 'vitest'
import { computeMFLots } from '../mf-compute'

type T = { trade_type: 'buy' | 'sell'; units: number; nav: number }

function buy(units: number, nav: number): T  { return { trade_type: 'buy',  units, nav } }
function sell(units: number, nav: number): T { return { trade_type: 'sell', units, nav } }

// ── buys only ────────────────────────────────────────────────────────────────

describe('computeMFLots — buys only', () => {
  it('no transactions → zero units and invested', () => {
    expect(computeMFLots([])).toEqual({ units: 0, invested: 0 })
  })

  it('single buy → units and invested equal the lot', () => {
    const r = computeMFLots([buy(100, 50)])
    expect(r.units).toBeCloseTo(100)
    expect(r.invested).toBeCloseTo(5000)
  })

  it('multiple buys accumulate across lots', () => {
    const r = computeMFLots([buy(100, 50), buy(50, 80)])
    expect(r.units).toBeCloseTo(150)
    expect(r.invested).toBeCloseTo(100 * 50 + 50 * 80)  // 9000
  })
})

// ── FIFO lot consumption ─────────────────────────────────────────────────────

describe('computeMFLots — FIFO cost basis', () => {
  it('partial sell consumes oldest lot first', () => {
    // lot1: 100 @ 50, lot2: 100 @ 100 — sell 60 should eat entirely from lot1
    const r = computeMFLots([buy(100, 50), buy(100, 100), sell(60, 120)])
    expect(r.units).toBeCloseTo(140)
    // remaining: 40 from lot1 @ 50 + 100 from lot2 @ 100
    expect(r.invested).toBeCloseTo(40 * 50 + 100 * 100)  // 12000
  })

  it('sell spanning two lots consumes both in order', () => {
    // lot1: 50 @ 40, lot2: 100 @ 80 — sell 80 exhausts lot1 and takes 30 from lot2
    const r = computeMFLots([buy(50, 40), buy(100, 80), sell(80, 90)])
    expect(r.units).toBeCloseTo(70)
    expect(r.invested).toBeCloseTo(70 * 80)  // remaining 70 from lot2 @ 80
  })

  it('full exit → zero units and invested', () => {
    const r = computeMFLots([buy(100, 50), sell(100, 120)])
    expect(r.units).toBeCloseTo(0)
    expect(r.invested).toBeCloseTo(0)
  })

  it('buy-sell-buy: cost basis reflects only the re-entry lot', () => {
    // buy 100@50, sell all, buy 60@80 → invested = 60×80
    const r = computeMFLots([buy(100, 50), sell(100, 70), buy(60, 80)])
    expect(r.units).toBeCloseTo(60)
    expect(r.invested).toBeCloseTo(60 * 80)  // 4800
  })

  it('invested never uses sell NAV — only original buy NAV matters', () => {
    // buy 100 @ 50, sell 40 @ 200 (big appreciation) → remaining cost is still @ buy NAV
    const r = computeMFLots([buy(100, 50), sell(40, 200)])
    expect(r.units).toBeCloseTo(60)
    expect(r.invested).toBeCloseTo(60 * 50)  // 3000, not affected by sell NAV of 200
  })
})

// ── matched buy/sell pairs (fully redeemed fund) ─────────────────────────────

describe('computeMFLots — fully redeemed fund', () => {
  it('every buy matched by equal sell on same date → zero units', () => {
    // mirrors the HDFC balanced fund scenario that showed 293 phantom units
    // when buys are correctly ordered before sells on the same date
    const txns = [
      buy(36.643,  136.45),  sell(36.643,  136.45),
      buy(36.231,  138.002), sell(36.231,  138.002),
      buy(292.396, 139.366), sell(292.396, 139.366),
      buy(254.786, 140.314), sell(254.786, 140.314),
      buy(69.866,  143.132), buy(223.570, 143.132),
      sell(223.570, 143.132), sell(69.866, 143.132),
      buy(69.239,  144.427), sell(69.239,  144.427),
      buy(68.328,  146.353), sell(68.328,  146.353),
      buy(66.564,  150.232), sell(66.564,  150.232),
    ]
    const r = computeMFLots(txns)
    expect(r.units).toBeCloseTo(0, 2)
    expect(r.invested).toBeCloseTo(0, 2)
  })

  it('sell before buy in array (wrong order) leaves phantom units', () => {
    // this documents the ordering bug: sell arrives before buy in array, finds empty lots
    // the page.tsx sort (buys before sells on same date) prevents this in practice
    const r = computeMFLots([sell(100, 50), buy(100, 50)])
    expect(r.units).toBeCloseTo(100)  // phantom — sell was dropped
  })
})

// ── oversell guard ───────────────────────────────────────────────────────────

describe('computeMFLots — oversell', () => {
  it('sell more than held → units and invested floor at 0', () => {
    const r = computeMFLots([buy(50, 100), sell(80, 120)])
    expect(r.units).toBeCloseTo(0)
    expect(r.invested).toBeCloseTo(0)
  })

  it('sell with empty lots → gracefully ignored', () => {
    const r = computeMFLots([sell(100, 50)])
    expect(r.units).toBeCloseTo(0)
    expect(r.invested).toBeCloseTo(0)
  })
})
