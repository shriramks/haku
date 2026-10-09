import { describe, it, expect, vi } from 'vitest'
// The row component imports server actions; the mapper is pure.
vi.mock('@/app/actions', () => ({}))
vi.mock('@/app/portfolio/actions', () => ({}))
vi.mock('@/lib/supabase-browser', () => ({ getSupabaseBrowser: () => ({}) }))

import { usToDisplayTxn } from '@/components/EditableTxnRow'
import type { UsTransaction } from '../portfolio-types'

const t = (trade_type: 'buy' | 'sell'): UsTransaction => ({
  id: 'u1', holding_id: 'h1', trade_date: '2026-10-09', trade_type,
  quantity: 12, price: 110.42, fx_rate: 104.47, amount: 1325.04, amount_inr: 138_419.9,
})

describe('usToDisplayTxn', () => {
  it('is a Stocks row valued in INR at the trade-date rate', () => {
    const d = usToDisplayTxn(t('buy'), 'VUAA')
    expect(d.asset).toBe('stock')
    expect(d.amount).toBe(138_419.9)
    expect(d.signedAmount).toBe(138_419.9)
    expect(d.direction).toBe('in')
    expect(d.detail).toBe('12 sh · $110.42 · rate 104.47')
  })

  it('a sell is an outflow', () => {
    const d = usToDisplayTxn(t('sell'), 'VUAA')
    expect(d.direction).toBe('out')
    expect(d.signedAmount).toBe(-138_419.9)
  })
})
