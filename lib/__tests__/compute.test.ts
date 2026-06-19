import { describe, it, expect } from 'vitest'
import { computeStockRows, computeAllTimeHoldings, seqCost } from '../compute'
import type { StockAllocation, Transaction, BuyBand } from '../types'

const FY25 = 'fy25-id'
const FY26 = 'fy26-id'

function mkAlloc(symbol: string, pct: number, fyId = FY25): StockAllocation {
  return {
    id: `alloc-${symbol}`, fy_id: fyId, user_id: 'u1',
    symbol, exchange: 'NSE',
    allocation_pct: pct, category: 'large',
  }
}

function mkTxn(
  symbol: string,
  type: 'buy' | 'sell',
  qty: number,
  price: number,
  fyId = FY25,
): Transaction {
  return {
    id: Math.random().toString(), symbol, exchange: 'NSE',
    trade_date: '2025-06-01', trade_type: type,
    quantity: qty, price, amount: qty * price,
    fy_id: fyId, notes: '',
  }
}

function mkBand(symbol: string, overrides: Partial<BuyBand> = {}): BuyBand {
  return {
    id: `band-${symbol}`, symbol, anchor_type: 'PE',
    pat_now: null, pat_3yr_ago: null, roce_3yr_avg: null, mcap: null, index_level: null, index_pe: null,
    eps: null, buy_low: null, buy_high: null, mid_low: null, mid_high: null, trim_price: null,
    cmp: null, week_52_low: null, week_52_high: null, last_updated_at: '', generated_at: '', is_current: true, notes: '',
    ...overrides,
  }
}

const noBands: BuyBand[] = []
const totalBudget = 1_000_000

// ── computeStockRows — basic spend ────────────────────────────────────────────

describe('computeStockRows — basic spend', () => {
  it('spent = net buys minus sell proceeds', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const txns   = [mkTxn('INFY', 'buy', 100, 1500), mkTxn('INFY', 'sell', 20, 1600)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.spent).toBe(100 * 1500 - 20 * 1600)
  })

  it('sells also reduce qty', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const txns   = [mkTxn('INFY', 'buy', 100, 1500), mkTxn('INFY', 'sell', 20, 1600)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.qty).toBe(80)
  })

  it('remaining = budget - spent', () => {
    const allocs = [mkAlloc('INFY', 10)]   // budget = 10% of 1_000_000 = 100_000
    const txns   = [mkTxn('INFY', 'buy', 100, 500)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.budget).toBe(100_000)
    expect(row.spent).toBe(50_000)
    expect(row.remaining).toBe(50_000)
  })

  it('sell-high-buy-low: sell proceeds free up budget for rebuy', () => {
    const allocs = [mkAlloc('ITC', 20)]   // budget = 200_000
    const txns   = [
      mkTxn('ITC', 'buy',  100, 1000),
      mkTxn('ITC', 'sell', 100, 1100),
      mkTxn('ITC', 'buy',  200,  900),
    ]
    const [row] = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.spent).toBe(100*1000 - 100*1100 + 200*900)   // 170_000
    expect(row.qty).toBe(200)
  })
})

// ── computeStockRows — qty ────────────────────────────────────────────────────

describe('computeStockRows — qty calculation', () => {
  it('net qty = bought - sold', () => {
    const allocs = [mkAlloc('TCS', 12)]
    const txns   = [mkTxn('TCS', 'buy', 100, 3500), mkTxn('TCS', 'sell', 30, 3600)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.qty).toBe(70)
  })

  it('qty does not go below zero', () => {
    const allocs = [mkAlloc('TCS', 12)]
    const txns   = [mkTxn('TCS', 'buy', 10, 3500), mkTxn('TCS', 'sell', 20, 3600)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.qty).toBe(0)
  })
})

// ── computeStockRows — currentCost (all-time invested) ───────────────────────

// currentCost = FY sequential cost (same scope as budget/remaining)
// qty/avgCost = all-time sequential (for unrealised PnL)
describe('computeStockRows — currentCost (FY-scoped)', () => {
  it('currentCost = FY buy cost when no sells', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const txns   = [mkTxn('INFY', 'buy', 100, 1500)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.currentCost).toBe(150_000)
  })

  it('full FY harvest: currentCost=0, nothing held from this FY', () => {
    const allocs = [mkAlloc('ITC', 10)]
    const txns   = [mkTxn('ITC', 'buy', 100, 400), mkTxn('ITC', 'sell', 100, 380)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.currentCost).toBe(0)
  })

  it('FY harvest + re-entry: currentCost = re-entry cost only', () => {
    const allocs = [mkAlloc('ITC', 10)]
    const txns   = [
      mkTxn('ITC', 'buy',  100, 400),
      mkTxn('ITC', 'sell', 100, 380),
      mkTxn('ITC', 'buy',   50, 360),
    ]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.currentCost).toBe(50 * 360)  // 18000 — old pre-harvest cost doesn't bleed in
  })

  it('no FY transactions → currentCost=0 even if all-time holdings have prior-FY buys', () => {
    // Stock accumulated in FY25, no activity in FY26
    const allocs  = [mkAlloc('CAMS', 10, FY26)]
    const fyTxns  : Transaction[] = []
    const allTime = computeAllTimeHoldings([mkTxn('CAMS', 'buy', 100, 1500, FY25)])
    const [row]   = computeStockRows(allocs, fyTxns, noBands, totalBudget, allTime)
    expect(row.currentCost).toBe(0)       // nothing deployed this FY
    expect(row.qty).toBe(100)             // but shares are still held (all-time)
    expect(row.avgCost).toBe(1500)        // and avg cost is known for unrealised PnL
    expect(row.spent).toBe(0)
  })

  it('all-time holdings do not affect currentCost — only qty/avgCost', () => {
    const allocs   = [mkAlloc('INFY', 10, FY26)]
    const fyTxns   = [mkTxn('INFY', 'buy', 50, 1800, FY26)]
    const allTime  = computeAllTimeHoldings([mkTxn('INFY', 'buy', 100, 1500, FY25), mkTxn('INFY', 'buy', 50, 1800, FY26)])
    const [row]    = computeStockRows(allocs, fyTxns, noBands, totalBudget, allTime)
    expect(row.currentCost).toBe(50 * 1800)   // FY26 only
    expect(row.qty).toBe(150)                  // all-time
    expect(row.avgCost).toBe(1600)             // all-time avg
    expect(row.spent).toBe(50 * 1800)
  })
})


// ── seqCost ───────────────────────────────────────────────────────────────────

describe('seqCost', () => {
  it('no transactions → qty=0, cost=0, avgCost=0', () => {
    const r = seqCost([])
    expect(r).toEqual({ qty: 0, cost: 0, avgCost: 0, buyAvgCost: 0 })
  })

  it('buys only → qty and cost accumulate', () => {
    const txns = [mkTxn('X', 'buy', 100, 500), mkTxn('X', 'buy', 50, 600)]
    const r = seqCost(txns)
    expect(r.qty).toBe(150)
    expect(r.cost).toBe(100 * 500 + 50 * 600)
    expect(r.avgCost).toBeCloseTo((100 * 500 + 50 * 600) / 150)
  })

  it('partial sell retires proportional cost', () => {
    // Buy 100 at ₹500 → cost ₹50k, avg ₹500. Sell 40 → retires 40×500=₹20k.
    const txns = [mkTxn('X', 'buy', 100, 500), mkTxn('X', 'sell', 40, 600)]
    const r = seqCost(txns)
    expect(r.qty).toBe(60)
    expect(r.cost).toBeCloseTo(60 * 500)   // remaining 60 shares at ₹500
    expect(r.avgCost).toBeCloseTo(500)
  })

  it('full exit → qty=0, cost=0', () => {
    const txns = [mkTxn('X', 'buy', 100, 400), mkTxn('X', 'sell', 100, 450)]
    const r = seqCost(txns)
    expect(r.qty).toBe(0)
    expect(r.cost).toBe(0)
    expect(r.avgCost).toBe(0)
  })

  it('exit then re-entry → cost reflects only re-entry, not blended avg', () => {
    // Buy 100 at ₹400, sell all, re-buy 50 at ₹360
    // Aggregate avg would be (40k + 18k) / 150 ≈ ₹386 — WRONG
    // Sequential: after exit cost=0; re-entry cost = 50×360 = ₹18k
    const txns = [
      mkTxn('X', 'buy',  100, 400),
      mkTxn('X', 'sell', 100, 450),
      mkTxn('X', 'buy',   50, 360),
    ]
    const r = seqCost(txns)
    expect(r.qty).toBe(50)
    expect(r.cost).toBe(50 * 360)
    expect(r.avgCost).toBe(360)
  })

  it('processes in date order, not array order', () => {
    // Same transactions as above but submitted in reverse array order
    const buy1  = { ...mkTxn('X', 'buy',  100, 400), trade_date: '2025-04-01' }
    const sell1 = { ...mkTxn('X', 'sell', 100, 450), trade_date: '2025-06-01' }
    const buy2  = { ...mkTxn('X', 'buy',   50, 360), trade_date: '2025-08-01' }
    const r = seqCost([buy2, sell1, buy1])   // scrambled order
    expect(r.qty).toBe(50)
    expect(r.cost).toBe(50 * 360)
  })

  it('oversell guard: qty and cost floor at 0', () => {
    // Sell 20 when only 10 held — should not go negative
    const txns = [mkTxn('X', 'buy', 10, 500), mkTxn('X', 'sell', 20, 600)]
    const r = seqCost(txns)
    expect(r.qty).toBe(0)
    expect(r.cost).toBe(0)
    expect(r.avgCost).toBe(0)
  })
})

// ── seqCost — buyAvgCost ──────────────────────────────────────────────────────

describe('seqCost — buyAvgCost (buy-only weighted average, sells ignored)', () => {
  it('no transactions → buyAvgCost = 0', () => {
    expect(seqCost([]).buyAvgCost).toBe(0)
  })

  it('single buy → buyAvgCost = buy price', () => {
    const r = seqCost([mkTxn('X', 'buy', 100, 900)])
    expect(r.buyAvgCost).toBeCloseTo(900)
  })

  it('two buys at different prices → buyAvgCost = weighted average of both', () => {
    // 100 @ 900 + 200 @ 600 → (90000 + 120000) / 300 = 700
    const txns = [mkTxn('X', 'buy', 100, 900), mkTxn('X', 'buy', 200, 600)]
    expect(seqCost(txns).buyAvgCost).toBeCloseTo(700)
  })

  it('sell does NOT affect buyAvgCost', () => {
    // User sold half their CAMS — avg cost of what they paid should not shift
    const txns = [mkTxn('X', 'buy', 100, 900), mkTxn('X', 'sell', 50, 950)]
    const r = seqCost(txns)
    expect(r.buyAvgCost).toBeCloseTo(900)   // only the buy matters
    expect(r.qty).toBe(50)                   // net qty is correct
  })

  it('full exit then re-entry: buyAvgCost spans ALL buys, not just current', () => {
    // Historical buy at 900, exit, re-buy at 700
    // The user wants to know their all-time buy average (800), not just the re-entry price
    // 100@900 + 200@700 → (90000 + 140000) / 300 = 766.67
    const txns = [
      mkTxn('X', 'buy',  100, 900),
      mkTxn('X', 'sell', 100, 950),   // irrelevant to buyAvgCost
      mkTxn('X', 'buy',  200, 700),
    ]
    const r = seqCost(txns)
    expect(r.buyAvgCost).toBeCloseTo((100 * 900 + 200 * 700) / 300)   // ≈ 766.67
    expect(r.avgCost).toBeCloseTo(700)      // only current holding (re-entry) for P&L
    expect(r.qty).toBe(200)
  })

  it('multiple buy-sell cycles: buyAvgCost accumulates all buy legs', () => {
    // 200@900, sell 100, 200@700, sell 50 → buys: (200×900 + 200×700)/400 = 800
    const txns = [
      mkTxn('X', 'buy',  200, 900),
      mkTxn('X', 'sell', 100, 950),
      mkTxn('X', 'buy',  200, 700),
      mkTxn('X', 'sell',  50, 720),
    ]
    const r = seqCost(txns)
    expect(r.buyAvgCost).toBeCloseTo((200 * 900 + 200 * 700) / 400)   // 800
    expect(r.qty).toBe(250)   // 200-100+200-50
  })

  it('sell-only ledger (no buys) → buyAvgCost = 0 and qty = 0', () => {
    // Pathological case — shouldn't occur in practice but must not crash
    const txns = [mkTxn('X', 'sell', 50, 900)]
    const r = seqCost(txns)
    expect(r.buyAvgCost).toBe(0)
    expect(r.qty).toBe(0)
  })
})
