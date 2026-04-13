import { describe, it, expect } from 'vitest'
import { computeStockRows, computeCarryover, seqCost } from '../compute'
import type { StockAllocation, Transaction, BuyBand } from '../types'

const FY25 = 'fy25-id'
const FY26 = 'fy26-id'

function mkAlloc(symbol: string, pct: number, fyId = FY25): StockAllocation {
  return {
    id: `alloc-${symbol}`, fy_id: fyId, user_id: 'u1',
    symbol, exchange: 'NSE',
    allocation_pct: pct, category: 'large',
    two_weak_quarters: false, two_strong_quarters: false,
  }
}

function mkTxn(
  symbol: string,
  type: 'buy' | 'sell',
  qty: number,
  price: number,
  fyId = FY25,
  advFyId: string | null = null
): Transaction {
  return {
    id: Math.random().toString(), symbol, exchange: 'NSE',
    trade_date: '2025-06-01', trade_type: type,
    quantity: qty, price, amount: qty * price,
    fy_id: fyId, advance_fy_id: advFyId, notes: '',
  }
}

function mkBand(symbol: string, overrides: Partial<BuyBand> = {}): BuyBand {
  return {
    id: `band-${symbol}`, symbol, anchor_type: 'PE',
    eps: null, buy_low: null, buy_high: null, mid_low: null, mid_high: null, trim_price: null,
    manual_cmp: null, last_updated_at: '', generated_at: '', is_current: true, notes: '',
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

// ── computeStockRows — carryoverMap ───────────────────────────────────────────

describe('computeStockRows — carryoverMap', () => {
  it('positive carryover adds to budget', () => {
    const allocs = [mkAlloc('HDFC', 10)]
    const carryoverMap = new Map([['HDFC', 20_000]])
    const [row] = computeStockRows(allocs, [], noBands, totalBudget, undefined, carryoverMap)
    expect(row.budget).toBe(120_000)
  })

  it('negative carryover reduces budget', () => {
    const allocs = [mkAlloc('ITC', 10)]
    const carryoverMap = new Map([['ITC', -25_000]])
    const [row] = computeStockRows(allocs, [], noBands, totalBudget, undefined, carryoverMap)
    expect(row.budget).toBe(75_000)
  })

  it('missing symbol in carryoverMap treated as zero', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const carryoverMap = new Map([['OTHER', 50_000]])
    const [row] = computeStockRows(allocs, [], noBands, totalBudget, undefined, carryoverMap)
    expect(row.budget).toBe(100_000)
  })

  it('no carryoverMap means zero carryover', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const [row] = computeStockRows(allocs, [], noBands, totalBudget)
    expect(row.budget).toBe(100_000)
  })

  it('remaining goes negative when spend exceeds carryover-adjusted budget', () => {
    const allocs = [mkAlloc('ITC', 10)]
    const carryoverMap = new Map([['ITC', -25_000]])   // budget = 75_000
    const txns  = [mkTxn('ITC', 'buy', 80, 1000)]     // spent  = 80_000
    const [row] = computeStockRows(allocs, txns, noBands, totalBudget, undefined, carryoverMap)
    expect(row.remaining).toBe(-5_000)
  })
})

// ── computeStockRows — advance_fy_id ──────────────────────────────────────────

describe('computeStockRows — advance_fy_id double-count fix', () => {
  it('excludes txn from FY25 when advance_fy_id is set to FY26 and we query FY25', () => {
    const allocs = [mkAlloc('ITC', 5)]
    const txns   = [mkTxn('ITC', 'buy', 200, 400, FY25, FY26)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget, FY25)
    expect(row.spent).toBe(0)
  })

  it('includes txn in FY26 when advance_fy_id = FY26 and we query FY26', () => {
    const allocs = [mkAlloc('ITC', 5, FY26)]
    const txns   = [mkTxn('ITC', 'buy', 200, 400, FY25, FY26)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget, FY26)
    expect(row.spent).toBe(200 * 400)
  })

  it('includes txn with no advance_fy_id in its own FY', () => {
    const allocs = [mkAlloc('HDFC', 8)]
    const txns   = [mkTxn('HDFC', 'buy', 50, 1800, FY25, null)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget, FY25)
    expect(row.spent).toBe(50 * 1800)
  })

  it('includes txn when no fyId passed (backward compat — no filtering)', () => {
    const allocs = [mkAlloc('ITC', 5)]
    const txns   = [mkTxn('ITC', 'buy', 200, 400, FY25, FY26)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.spent).toBe(200 * 400)
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

// ── computeCarryover ──────────────────────────────────────────────────────────

describe('computeCarryover — same stock in both FYs (direct carryover)', () => {
  it('underspent stock carries positive remaining into next FY', () => {
    // INFY: budget = 10% of 1M = 100k, spent = 60k, remaining = 40k
    const prevAllocs = [mkAlloc('INFY', 10)]
    const prevTxns   = [mkTxn('INFY', 'buy', 60, 1000)]
    const nextAllocs = [mkAlloc('INFY', 10, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)
    expect(result.adjustments.get('INFY')).toBe(40_000)
    expect(result.breakdown.direct.get('INFY')).toBe(40_000)
    expect(result.breakdown.poolTotal).toBe(0)
  })

  it('overspent stock carries negative remaining (debt) into next FY', () => {
    // ITC: budget = 10% of 1M = 100k, spent = 120k, remaining = -20k
    const prevAllocs = [mkAlloc('ITC', 10)]
    const prevTxns   = [mkTxn('ITC', 'buy', 120, 1000)]
    const nextAllocs = [mkAlloc('ITC', 10, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)
    expect(result.adjustments.get('ITC')).toBe(-20_000)
    expect(result.breakdown.direct.get('ITC')).toBe(-20_000)
  })
})

describe('computeCarryover — stock exits (orphan pool, proportional distribution)', () => {
  it('exited stock positive remaining distributes proportionally to next FY stocks', () => {
    // FY25: INFY (10%) underspent by 30k → orphan pool = 30k
    // FY26: ITC (60%) and HDFC (40%) → ITC gets 60% of 30k = 18k, HDFC gets 12k
    const prevAllocs = [mkAlloc('INFY', 10)]
    const prevTxns   = [mkTxn('INFY', 'buy', 70, 1000)]   // spent 70k, remaining 30k
    const nextAllocs = [mkAlloc('ITC', 60, FY26), mkAlloc('HDFC', 40, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)

    expect(result.breakdown.poolTotal).toBe(30_000)
    expect(result.breakdown.orphans).toHaveLength(1)
    expect(result.breakdown.orphans[0].symbol).toBe('INFY')

    // ITC: 60/(60+40) * 30k = 18k
    expect(result.adjustments.get('ITC')).toBeCloseTo(18_000)
    expect(result.breakdown.poolShares.get('ITC')).toBeCloseTo(18_000)
    // HDFC: 40/(60+40) * 30k = 12k
    expect(result.adjustments.get('HDFC')).toBeCloseTo(12_000)
    expect(result.breakdown.poolShares.get('HDFC')).toBeCloseTo(12_000)
  })

  it('exited stock negative remaining (debt) distributes proportionally as a deduction', () => {
    // FY25: INFY (10%) overspent by 20k → orphan pool = -20k
    // FY26: ITC (60%) and HDFC (40%) → each gets negative pool share
    const prevAllocs = [mkAlloc('INFY', 10)]
    const prevTxns   = [mkTxn('INFY', 'buy', 120, 1000)]  // spent 120k, remaining -20k
    const nextAllocs = [mkAlloc('ITC', 60, FY26), mkAlloc('HDFC', 40, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)

    expect(result.breakdown.poolTotal).toBe(-20_000)
    expect(result.adjustments.get('ITC')).toBeCloseTo(-12_000)   // 60% of -20k
    expect(result.adjustments.get('HDFC')).toBeCloseTo(-8_000)   // 40% of -20k
  })

  it('proportional split respects unequal allocation percentages', () => {
    // Pool = 100k, next FY has 3 stocks: 50%, 30%, 20%
    const prevAllocs = [mkAlloc('EXITED', 10)]
    const prevTxns: Transaction[] = []   // spent 0, remaining = 100k (10% of 1M)
    const nextAllocs = [
      mkAlloc('A', 50, FY26),
      mkAlloc('B', 30, FY26),
      mkAlloc('C', 20, FY26),
    ]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)
    expect(result.adjustments.get('A')).toBeCloseTo(50_000)   // 50/100 * 100k
    expect(result.adjustments.get('B')).toBeCloseTo(30_000)   // 30/100 * 100k
    expect(result.adjustments.get('C')).toBeCloseTo(20_000)   // 20/100 * 100k
  })
})

describe('computeCarryover — mix of direct and pool', () => {
  it('stock present in both FYs gets direct + pool share summed', () => {
    // FY25: INFY (20%) spent 0 → remaining 200k, EXITED (10%) spent 0 → remaining 100k
    // FY26: INFY (100%) only stock → gets 200k direct + 100k pool = 300k
    const prevAllocs = [mkAlloc('INFY', 20), mkAlloc('EXITED', 10)]
    const prevTxns: Transaction[] = []
    const nextAllocs = [mkAlloc('INFY', 100, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)

    expect(result.breakdown.direct.get('INFY')).toBe(200_000)
    expect(result.breakdown.poolTotal).toBe(100_000)
    expect(result.breakdown.poolShares.get('INFY')).toBe(100_000)  // 100% of pool
    expect(result.adjustments.get('INFY')).toBe(300_000)
  })

  it('multiple stocks continue, one exits — direct + pool distributed proportionally', () => {
    // FY25: ITC 40% (underspent 20k), HDFC 40% (underspent 40k), INFY 20% (exits, underspent 10k)
    // FY26: ITC 50%, HDFC 50% — each gets direct + 50% of 10k pool
    const prevAllocs = [mkAlloc('ITC', 40), mkAlloc('HDFC', 40), mkAlloc('INFY', 20)]
    const prevTxns   = [
      mkTxn('ITC',  'buy', 380, 1000),  // budget 400k, spent 380k, remaining 20k
      mkTxn('HDFC', 'buy', 360, 1000),  // budget 400k, spent 360k, remaining 40k
      mkTxn('INFY', 'buy', 190, 1000),  // budget 200k, spent 190k, remaining 10k (exits)
    ]
    const nextAllocs = [mkAlloc('ITC', 50, FY26), mkAlloc('HDFC', 50, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)

    expect(result.breakdown.poolTotal).toBe(10_000)
    // ITC: 20k direct + 50% of 10k = 25k
    expect(result.adjustments.get('ITC')).toBeCloseTo(25_000)
    // HDFC: 40k direct + 50% of 10k = 45k
    expect(result.adjustments.get('HDFC')).toBeCloseTo(45_000)
  })
})

describe('computeCarryover — edge cases', () => {
  it('no prev stocks → all adjustments are zero', () => {
    const nextAllocs = [mkAlloc('ITC', 50, FY26), mkAlloc('HDFC', 50, FY26)]
    const result = computeCarryover([], [], totalBudget, FY25, nextAllocs)
    expect(result.adjustments.get('ITC')).toBe(0)
    expect(result.adjustments.get('HDFC')).toBe(0)
    expect(result.breakdown.poolTotal).toBe(0)
  })

  it('no next stocks → empty adjustments map', () => {
    const prevAllocs = [mkAlloc('INFY', 10)]
    const result = computeCarryover(prevAllocs, [], totalBudget, FY25, [])
    expect(result.adjustments.size).toBe(0)
    expect(result.breakdown.poolTotal).toBe(100_000)  // still goes to pool
    expect(result.breakdown.orphans).toHaveLength(1)
  })

  it('mixed positive and negative orphans net before distribution', () => {
    // EXITED1 underspent 30k, EXITED2 overspent 10k → pool = 20k
    const prevAllocs = [mkAlloc('EXITED1', 3), mkAlloc('EXITED2', 1)]
    const prevTxns   = [
      // EXITED1: budget 30k, spent 0, remaining 30k
      // EXITED2: budget 10k, spent 20k, remaining -10k
      mkTxn('EXITED2', 'buy', 20, 1000),
    ]
    const nextAllocs = [mkAlloc('ITC', 100, FY26)]
    const result = computeCarryover(prevAllocs, prevTxns, totalBudget, FY25, nextAllocs)
    expect(result.breakdown.poolTotal).toBe(20_000)  // 30k - 10k
    expect(result.adjustments.get('ITC')).toBe(20_000)
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

  it('no FY transactions → currentCost=0 even if allTransactions has prior-FY buys', () => {
    // Stock accumulated in FY25, no activity in FY26
    const allocs  = [mkAlloc('CAMS', 10, FY26)]
    const fyTxns  : Transaction[] = []
    const allTxns = [mkTxn('CAMS', 'buy', 100, 1500, FY25)]
    const [row]   = computeStockRows(allocs, fyTxns, noBands, totalBudget, FY26, undefined, allTxns)
    expect(row.currentCost).toBe(0)       // nothing deployed this FY
    expect(row.qty).toBe(100)             // but shares are still held (all-time)
    expect(row.avgCost).toBe(1500)        // and avg cost is known for unrealised PnL
    expect(row.spent).toBe(0)
  })

  it('allTransactions does not affect currentCost — only qty/avgCost', () => {
    const allocs   = [mkAlloc('INFY', 10, FY26)]
    const fyTxns   = [mkTxn('INFY', 'buy', 50, 1800, FY26)]
    const allTxns  = [mkTxn('INFY', 'buy', 100, 1500, FY25), mkTxn('INFY', 'buy', 50, 1800, FY26)]
    const [row]    = computeStockRows(allocs, fyTxns, noBands, totalBudget, FY26, undefined, allTxns)
    expect(row.currentCost).toBe(50 * 1800)   // FY26 only
    expect(row.qty).toBe(150)                  // all-time
    expect(row.avgCost).toBe(1600)             // all-time avg
    expect(row.spent).toBe(50 * 1800)
  })
})

// ── computeStockRows — signal uses fresh computed bands ───────────────────────

describe('computeStockRows — bandSignal uses live calculateBands, not stored DB values', () => {
  it('signal is buy when CMP is in fresh buy zone, even if stale stored buy_low says deep', () => {
    // FMCG: fresh buyLow=350 (35×10), buyHigh=500 (50×10). CMP=400 → fresh: buy
    // Stored buy_low=600 (stale, old EPS) → stored signal would be: deep
    const alloc = { ...mkAlloc('HINDUNILVR', 10), category: 'FMCG' }
    const band  = mkBand('HINDUNILVR', {
      eps: 10, manual_cmp: 400,
      buy_low: 600, buy_high: 700, mid_high: 800, trim_price: 810,  // stale
    })
    const [row] = computeStockRows([alloc], [], [band], totalBudget)
    expect(row.bandSignal).toBe('buy')  // fresh: 350 ≤ 400 ≤ 500
  })

  it('signal is deep when CMP is below fresh buy zone, even if stale stored values say buy', () => {
    // FMCG: fresh buyLow=350. CMP=300 → fresh: deep
    // Stored buy_low=100 → stored signal would be: buy
    const alloc = { ...mkAlloc('HINDUNILVR', 10), category: 'FMCG' }
    const band  = mkBand('HINDUNILVR', {
      eps: 10, manual_cmp: 300,
      buy_low: 100, buy_high: 200, mid_high: 300, trim_price: 310,  // stale
    })
    const [row] = computeStockRows([alloc], [], [band], totalBudget)
    expect(row.bandSignal).toBe('deep')  // fresh: 300 < 350
  })

  it('signal is unknown when no CMP', () => {
    const alloc = { ...mkAlloc('HINDUNILVR', 10), category: 'FMCG' }
    const band  = mkBand('HINDUNILVR', { eps: 10, manual_cmp: null })
    const [row] = computeStockRows([alloc], [], [band], totalBudget)
    expect(row.bandSignal).toBe('unknown')
  })

  it('signal is unknown when no band', () => {
    const [row] = computeStockRows([mkAlloc('HINDUNILVR', 10)], [], [], totalBudget)
    expect(row.bandSignal).toBe('unknown')
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
