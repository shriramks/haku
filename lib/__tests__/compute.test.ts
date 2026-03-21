import { describe, it, expect } from 'vitest'
import { computeStockRows } from '../compute'
import type { StockAllocation, Transaction, BuyBand } from '../types'

const FY25 = 'fy25-id'
const FY26 = 'fy26-id'

function mkAlloc(symbol: string, pct: number, fyId = FY25): StockAllocation {
  return {
    id: `alloc-${symbol}`, fy_id: fyId, user_id: 'u1',
    symbol, exchange: 'NSE',
    allocation_pct: pct, category: 'large',
    two_weak_quarters: false, two_strong_quarters: false,
    is_hospital_ramp_phase: false, carryover_inr: null,
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

const noBands: BuyBand[] = []
const totalBudget = 1_000_000

describe('computeStockRows — basic spend', () => {
  it('calculates spent as buy minus sell', () => {
    const allocs = [mkAlloc('INFY', 10)]
    const txns   = [mkTxn('INFY', 'buy', 100, 1500), mkTxn('INFY', 'sell', 20, 1600)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.spent).toBe(100 * 1500 - 20 * 1600)
  })

  it('remaining = budget - spent', () => {
    const allocs = [mkAlloc('INFY', 10)]   // budget = 10% of 1_000_000 = 100_000
    const txns   = [mkTxn('INFY', 'buy', 100, 500)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)
    expect(row.budget).toBe(100_000)
    expect(row.spent).toBe(50_000)
    expect(row.remaining).toBe(50_000)
  })
})

describe('computeStockRows — advance_fy_id double-count fix', () => {
  it('excludes txn from FY25 when advance_fy_id is set to FY26 and we query FY25', () => {
    const allocs = [mkAlloc('ITC', 5)]
    // Bought in FY25 but earmarked for FY26
    const txns   = [mkTxn('ITC', 'buy', 200, 400, FY25, FY26)]
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget, FY25)
    // Should NOT count this spend against FY25
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
    const [row]  = computeStockRows(allocs, txns, noBands, totalBudget)  // no fyId
    expect(row.spent).toBe(200 * 400)
  })
})

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
