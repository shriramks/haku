import { describe, it, expect } from 'vitest'
import { planCarryForwardReconciliation } from '../tax-reconcile'
import type { ReconcileInputs } from '../tax-reconcile'
import type { FiscalYear, Transaction } from '../types'
import type { MFund, MFTransaction } from '../portfolio-types'
import type { CarryForwardRow } from '../tax-liability'

function fy(label: string, start: string, end: string): FiscalYear {
  return { id: `fy-${label}`, label, start_date: start, end_date: end, total_budget_inr: 0, unallocated_carryover_inr: null, deploy_capital_inr: null }
}

function stockTxn(tradeDate: string, tradeType: 'buy' | 'sell', qty: number, price: number): Transaction {
  return { id: `${tradeDate}-${tradeType}`, symbol: 'X', exchange: 'NSE', trade_date: tradeDate, trade_type: tradeType, quantity: qty, price, amount: qty * price, fy_id: null, notes: '' }
}

function mfTxn(id: string, tradeDate: string, tradeType: 'buy' | 'sell', units: number, nav: number): MFTransaction {
  return { id, fund_id: 'f1', trade_date: tradeDate, trade_type: tradeType, units, nav, amount: units * nav }
}

const FUND: MFund = { id: 'f1', scheme_code: 'F1', scheme_name: 'Debt Fund', scheme_type: 'Debt' }

// FY24: 2023-04-01..2024-03-31 — stock loss year (generates 5,000 LT carryforward)
// FY25: 2024-04-01..2025-03-31 — debt MF gain year (absorbs 2,400 of that carryforward)
// FY26: 2025-04-01..2026-03-31 — left open in most tests
const FY24 = fy('24', '2023-04-01', '2024-03-31')
const FY25 = fy('25', '2024-04-01', '2025-03-31')
const FY26 = fy('26', '2025-04-01', '2026-03-31')

function baseInputs(fiscalYears: FiscalYear[], existingRows: CarryForwardRow[], asOfToday: string): ReconcileInputs {
  const stockMap = new Map([['X', [
    stockTxn('2020-01-01', 'buy', 100, 200),
    stockTxn('2023-06-01', 'sell', 50, 100),   // FY24: 50 * (100-200) = -5,000 LTCG
  ]]])
  const mfMap = new Map([['f1', [
    mfTxn('buy1', '2020-01-01', 'buy', 1000, 10),
    mfTxn('sell1', '2024-06-01', 'sell', 400, 16),  // FY25: 400 * (16-10) = 2,400 LTCG (debt)
  ]]])
  return {
    fiscalYears, existingRows,
    stockMap, mfMap, mfFunds: [FUND], goldMap: new Map(), asOfToday,
  }
}

describe('planCarryForwardReconciliation', () => {
  it('no closed FYs → empty plan', () => {
    const plan = planCarryForwardReconciliation(baseInputs([FY26], [], '2025-06-01'))
    expect(plan.decrements).toEqual([])
    expect(plan.upserts).toEqual([])
  })

  it('chains a loss-then-gain pair in one pass: FY24 generates carryforward, FY25 consumes part of it, FY26 stays untouched', () => {
    const plan = planCarryForwardReconciliation(baseInputs([FY24, FY25, FY26], [], '2025-06-01'))

    // Nothing pre-existing, so the FY24→FY25 consumption folds into FY24's
    // own upsert rather than emitting a decrement against a row that isn't
    // in the DB yet.
    expect(plan.decrements).toEqual([])

    expect(plan.upserts).toEqual([
      { fyStartDate: '2023-04-01', lossType: 'short', amount: 0,    remaining: 0    },
      { fyStartDate: '2023-04-01', lossType: 'long',  amount: 5000, remaining: 2600 },
      { fyStartDate: '2024-04-01', lossType: 'short', amount: 0,    remaining: 0    },
      { fyStartDate: '2024-04-01', lossType: 'long',  amount: 0,    remaining: 0    },
    ])
    // FY26 is open (end_date 2026-03-31 > asOfToday) — never appears, even
    // though it has real transactions sitting in the same maps.
    expect(plan.upserts.some(u => u.fyStartDate === '2025-04-01')).toBe(false)
  })

  it('is idempotent: an already-reconciled FY is skipped, and consuming a real existing row emits a decrement (not folded into a pending upsert)', () => {
    const existingRows: CarryForwardRow[] = [
      { id: 'r-short', fyStartDate: '2023-04-01', lossType: 'short', remaining: 0 },
      { id: 'r-long',  fyStartDate: '2023-04-01', lossType: 'long',  remaining: 5000 },
    ]
    const plan = planCarryForwardReconciliation(baseInputs([FY24, FY25], existingRows, '2025-06-01'))

    // FY24 already has rows (of either amount) — untouched, no re-derivation.
    expect(plan.upserts.some(u => u.fyStartDate === '2023-04-01')).toBe(false)

    // FY25 consumes 2,400 of FY24's real 5,000-remaining row → a genuine decrement.
    expect(plan.decrements).toEqual([{ id: 'r-long', newRemaining: 2600 }])
    expect(plan.upserts).toEqual([
      { fyStartDate: '2024-04-01', lossType: 'short', amount: 0, remaining: 0 },
      { fyStartDate: '2024-04-01', lossType: 'long',  amount: 0, remaining: 0 },
    ])
  })

  it('a fully-reconciled FY (both rows already present, even at 0) produces nothing at all', () => {
    const existingRows: CarryForwardRow[] = [
      { id: 'r-short', fyStartDate: '2023-04-01', lossType: 'short', remaining: 0 },
      { id: 'r-long',  fyStartDate: '2023-04-01', lossType: 'long',  remaining: 2600 },
      { id: 'r2-short', fyStartDate: '2024-04-01', lossType: 'short', remaining: 0 },
      { id: 'r2-long',  fyStartDate: '2024-04-01', lossType: 'long',  remaining: 0 },
    ]
    const plan = planCarryForwardReconciliation(baseInputs([FY24, FY25], existingRows, '2025-06-01'))
    expect(plan.decrements).toEqual([])
    expect(plan.upserts).toEqual([])
  })
})
