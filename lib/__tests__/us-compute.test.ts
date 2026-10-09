import { describe, it, expect } from 'vitest'
import { computeUsPosition, computeUsPositions } from '../us-compute'
import type { UsHolding, UsTransaction } from '../portfolio-types'
import type { StockPriceInfo } from '../stock-prices'

const q = (cmp: number, prevClose: number | null): StockPriceInfo => ({ cmp, prevClose, fetchedAt: '2026-10-08T10:00:00Z' })

const holding: UsHolding = { id: 'h1', symbol: 'VUAA', yahoo_symbol: 'VUAA.L', name: 'Vanguard S&P 500', region: 'us' }

const txn = (trade_date: string, trade_type: 'buy' | 'sell', quantity: number, price: number, fx_rate: number, holding_id = 'h1'): UsTransaction => ({
  id: `${trade_date}-${trade_type}`, holding_id, trade_date, trade_type, quantity, price, fx_rate,
  amount: quantity * price, amount_inr: quantity * price * fx_rate,
})

describe('computeUsPosition', () => {
  it('fixes cost at the trade-date rate and values at today’s price and rate', () => {
    const p = computeUsPosition(holding, [txn('2025-01-01', 'buy', 10, 100, 80)], q(120, 118), { rate: 85, prevRate: 84.5 })!
    expect(p.quantity).toBe(10)
    expect(p.invested).toBe(80_000)
    expect(p.currentValue).toBe(102_000)
    expect(p.gain).toBe(22_000)
  })

  it('counts currency gain: flat USD price, weaker rupee', () => {
    const p = computeUsPosition(holding, [txn('2025-01-01', 'buy', 10, 100, 80)], q(100, 100), { rate: 88, prevRate: 88 })!
    expect(p.gain).toBe(8_000)
  })

  it('a sell reduces cost at average cost and quantity', () => {
    const p = computeUsPosition(holding, [
      txn('2025-01-01', 'buy', 10, 100, 80),
      txn('2025-06-01', 'buy', 10, 100, 90),
      txn('2025-07-01', 'sell', 10, 110, 91),
    ], q(100, null), { rate: 90, prevRate: null })!
    expect(p.quantity).toBe(10)
    expect(p.invested).toBe(85_000)   // avg 8500 INR/unit x 10
  })

  it('returns null once everything is sold', () => {
    expect(computeUsPosition(holding, [txn('2025-01-01', 'buy', 5, 100, 80), txn('2025-02-01', 'sell', 5, 100, 81)], null, null)).toBeNull()
  })

  it('has null value fields without a price or a rate, but keeps cost', () => {
    const buys = [txn('2025-01-01', 'buy', 10, 100, 80)]
    const noPrice = computeUsPosition(holding, buys, null, { rate: 85, prevRate: null })!
    expect(noPrice.invested).toBe(80_000)
    expect([noPrice.currentValue, noPrice.gain, noPrice.xirr, noPrice.gain1d]).toEqual([null, null, null, null])
    const noRate = computeUsPosition(holding, buys, q(120, 118), null)!
    expect(noRate.currentValue).toBeNull()
  })

  it('day change includes the FX move and holds the rate flat when there is no prior rate', () => {
    const buys = [txn('2025-01-01', 'buy', 10, 100, 80)]
    const withPrev = computeUsPosition(holding, buys, q(110, 100), { rate: 90, prevRate: 80 })!
    expect(withPrev.gain1d).toBe(10 * 110 * 90 - 10 * 100 * 80)
    const flat = computeUsPosition(holding, buys, q(110, 100), { rate: 90, prevRate: null })!
    expect(flat.gain1d).toBe(10 * 10 * 90)
    expect(flat.gain1dPct).toBeCloseTo(10, 6)
  })

  it('XIRR is on INR cash flows (currency gain lifts it)', () => {
    const buys = [txn('2025-01-01', 'buy', 10, 100, 80)]
    const flatUsd = computeUsPosition(holding, buys, q(100, null), { rate: 80, prevRate: null })!
    const weakerInr = computeUsPosition(holding, buys, q(100, null), { rate: 88, prevRate: null })!
    expect(Math.abs(flatUsd.xirr ?? 0)).toBeLessThan(0.001)
    expect(weakerInr.xirr!).toBeGreaterThan(0)
  })
})

describe('computeUsPositions', () => {
  it('drops sold-out holdings, looks quotes up by Yahoo symbol and sorts by value', () => {
    const other: UsHolding = { ...holding, id: 'h2', symbol: 'VWRA', yahoo_symbol: 'VWRA.L', region: 'india' }
    const sold: UsHolding = { ...holding, id: 'h3', symbol: 'OLD', yahoo_symbol: 'OLD' }
    const out = computeUsPositions([holding, other, sold], [
      txn('2025-01-01', 'buy', 1, 100, 80, 'h1'),
      txn('2025-01-01', 'buy', 1, 100, 80, 'h2'),
      txn('2025-01-01', 'buy', 1, 100, 80, 'h3'),
      txn('2025-02-01', 'sell', 1, 100, 80, 'h3'),
    ], { 'US:VUAA.L': q(100, null), 'US:VWRA.L': q(200, null) }, { rate: 80, prevRate: null })
    expect(out.map(p => p.holding.symbol)).toEqual(['VWRA', 'VUAA'])
  })
})
