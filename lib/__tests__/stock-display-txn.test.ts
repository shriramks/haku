import { describe, it, expect, vi } from 'vitest'
// The row component imports server actions; the mapper is pure.
vi.mock('@/app/actions', () => ({}))
vi.mock('@/app/portfolio/actions', () => ({}))
vi.mock('@/lib/supabase-browser', () => ({ getSupabaseBrowser: () => ({}) }))

import { stockToDisplayTxn } from '@/components/EditableTxnRow'
import type { Transaction } from '../types'

const t = (over: Partial<Transaction>): Transaction => ({
  id: 't1', symbol: 'VUAA', exchange: 'LSE', trade_date: '2026-10-09', trade_type: 'buy',
  quantity: 12, price: 110.42, fx_rate: 104.47, amount: 138_419.9, fy_id: null, notes: '', ...over,
})

describe('stockToDisplayTxn', () => {
  it('a USD trade is a Stocks row valued in INR at the trade-date rate', () => {
    const d = stockToDisplayTxn(t({}))
    expect(d.asset).toBe('stock')
    expect(d.amount).toBe(138_419.9)
    expect(d.signedAmount).toBe(138_419.9)
    expect(d.direction).toBe('in')
    expect(d.detail).toBe('12 sh · $110.42 · rate 104.47')
  })

  it('a sell is an outflow', () => {
    const d = stockToDisplayTxn(t({ trade_type: 'sell' }))
    expect(d.direction).toBe('out')
    expect(d.signedAmount).toBe(-138_419.9)
  })

  it('an INR trade keeps the plain price line', () => {
    const d = stockToDisplayTxn(t({ symbol: 'TCS', exchange: 'NSE', quantity: 5, price: 4000, fx_rate: 1, amount: 20_000 }))
    expect(d.detail).toBe('5 sh · 4000')
    expect(d.amount).toBe(20_000)
  })
})
