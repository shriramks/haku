import { describe, it, expect } from 'vitest'
import { xirr, computePPFBalance, stockXirr, portfolioXirr } from '../xirr'

function d(s: string): Date { return new Date(s) }

// ── Minimal record builders ────────────────────────────────────────────────────

function dep(date: string, amount: number) {
  return { trade_date: date, trade_type: 'deposit' as const, amount }
}
function withdrawal(date: string, amount: number) {
  return { trade_date: date, trade_type: 'withdrawal' as const, amount }
}
function stockBuy(date: string, amount: number) {
  return { trade_date: date, trade_type: 'buy' as const, amount }
}
function stockSell(date: string, amount: number) {
  return { trade_date: date, trade_type: 'sell' as const, amount }
}

// ── xirr solver ───────────────────────────────────────────────────────────────

describe('xirr solver', () => {
  it('returns null for fewer than 2 cashflows', () => {
    expect(xirr([])).toBeNull()
    expect(xirr([{ date: d('2023-01-01'), amount: -100 }])).toBeNull()
  })

  it('computes ~10% for a simple one-year investment', () => {
    const result = xirr([
      { date: d('2023-01-01'), amount: -10000 },
      { date: d('2024-01-01'), amount: 11000 },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.10, 3)
  })

  it('returns ~0 for break-even (same amount in and out, one year apart)', () => {
    const result = xirr([
      { date: d('2023-01-01'), amount: -10000 },
      { date: d('2024-01-01'), amount: 10000 },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0, 3)
  })

  it('handles multiple cashflows (buy, interim inflow, terminal sale)', () => {
    // Invest 10000, receive 500 at 6 months, sell at 12000 a year later
    const result = xirr([
      { date: d('2022-01-01'), amount: -10000 },
      { date: d('2022-07-01'), amount: 500 },
      { date: d('2023-01-01'), amount: 12000 },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0.20)
  })

  it('produces a negative rate for a loss', () => {
    const result = xirr([
      { date: d('2023-01-01'), amount: -10000 },
      { date: d('2024-01-01'), amount: 8000 },
    ])
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(-0.20, 3)
  })
})

// ── computePPFBalance ─────────────────────────────────────────────────────────

describe('computePPFBalance', () => {
  it('returns 0 for empty transactions', () => {
    expect(computePPFBalance([], d('2024-01-01'))).toBe(0)
  })

  it('deposit on the 1st earns 3 months of interest by March 31', () => {
    // Simple interest check: 100000 × 7.1%/12 × 3 months = 1775
    const result = computePPFBalance([dep('2020-01-01', 100000)], d('2020-03-31'))
    expect(result).toBeCloseTo(101775, 0)
  })

  it('deposit after the 5th earns no interest for that month', () => {
    // Deposited Jan 10 → only Feb + Mar interest = 100000 × 7.1%/12 × 2 = 1183.33
    const result = computePPFBalance([dep('2020-01-10', 100000)], d('2020-03-31'))
    expect(result).toBeCloseTo(101183, 0)
  })

  it('deposit on exactly the 5th qualifies for that month', () => {
    // Jan 5 deposit → Jan + Feb + Mar interest (3 months)
    const result = computePPFBalance([dep('2020-01-05', 100000)], d('2020-03-31'))
    expect(result).toBeCloseTo(101775, 0)
  })

  it('deposit on the 6th does NOT qualify for January', () => {
    // Jan 6 → only Feb + Mar (same as depositing on the 10th)
    const result = computePPFBalance([dep('2020-01-06', 100000)], d('2020-03-31'))
    expect(result).toBeCloseTo(101183, 0)
  })

  it('interest compounds annually: balance after first March credit earns interest in year 2', () => {
    // Jan 1 2020 deposit: first credit Mar 2020 → 101775
    // Apr 2020–Mar 2021: 101775 × 7.1% = 7226.03 → second credit → 109001
    const result = computePPFBalance([dep('2020-01-01', 100000)], d('2021-03-31'))
    expect(result).toBeCloseTo(109001, 0)
  })

  it('includes accrued-but-not-yet-credited interest in the mid-year estimate', () => {
    // One month after deposit: 1 month of accrued interest not yet credited (March hasn't happened)
    const result = computePPFBalance([dep('2020-01-01', 100000)], d('2020-01-31'))
    expect(result).toBeCloseTo(100000 + 100000 * 0.071 / 12, 1)
  })

  it('accrued interest resets to 0 after March credit and resumes on the new balance', () => {
    // After Mar 2020 credit: balance = 101775. In April, accrued on 101775.
    const afterMarch = computePPFBalance([dep('2020-01-01', 100000)], d('2020-03-31'))
    const afterApril = computePPFBalance([dep('2020-01-01', 100000)], d('2020-04-30'))
    expect(afterApril).toBeCloseTo(afterMarch + afterMarch * 0.071 / 12, 1)
  })

  it('handles withdrawals by reducing the interest base', () => {
    // Deposit 200000 Jan 1, withdraw 100000 Jan 3 (before 5th)
    // Effective balance for interest in Jan: 200000 − 100000 = 100000
    const withWithdrawal = computePPFBalance([
      dep('2020-01-01', 200000),
      withdrawal('2020-01-03', 100000),
    ], d('2020-03-31'))
    const singleDeposit = computePPFBalance([dep('2020-01-01', 100000)], d('2020-03-31'))
    expect(withWithdrawal).toBeCloseTo(singleDeposit, 0)
  })

  it('handles multiple deposits across years', () => {
    // Two equal deposits at start of each year; balance should exceed 2 × 100000
    const result = computePPFBalance([
      dep('2020-01-01', 100000),
      dep('2021-01-01', 100000),
    ], d('2022-03-31'))
    expect(result).toBeGreaterThan(200000)
  })
})

// ── stockXirr ─────────────────────────────────────────────────────────────────

describe('stockXirr', () => {
  it('computes ~10% for a simple one-year stock holding', () => {
    const result = stockXirr([stockBuy('2023-01-01', 100000)], 110000, d('2024-01-01'))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.10, 2)
  })

  it('returns null when currentValue is 0 and no sells (no positive flows)', () => {
    expect(stockXirr([stockBuy('2023-01-01', 100000)], 0, d('2024-01-01'))).toBeNull()
  })

  it('returns ~0 for break-even position', () => {
    const result = stockXirr([stockBuy('2023-01-01', 100000)], 100000, d('2024-01-01'))
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0, 2)
  })

  it('produces negative XIRR for a loss', () => {
    const result = stockXirr([stockBuy('2023-01-01', 100000)], 85000, d('2024-01-01'))
    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(0)
  })

  it('handles partial sell: sell proceeds + remaining value → valid XIRR', () => {
    // Buy 100000, sell 60000 at 6 months, remaining worth 60000 at 1 year → profitable
    const result = stockXirr(
      [stockBuy('2023-01-01', 100000), stockSell('2023-07-01', 60000)],
      60000,
      d('2024-01-01')
    )
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0.20) // ~27% from the math
  })

  it('handles multiple buys (averaging in)', () => {
    const result = stockXirr(
      [stockBuy('2023-01-01', 50000), stockBuy('2023-07-01', 50000)],
      120000,
      d('2024-01-01')
    )
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0) // profitable overall
  })
})

// ── portfolioXirr ─────────────────────────────────────────────────────────────

describe('portfolioXirr', () => {
  it('returns null for zero investments with zero terminal value', () => {
    expect(portfolioXirr([], [], [], [], 0, d('2024-01-01'))).toBeNull()
  })

  it('matches stockXirr for a stock-only portfolio', () => {
    const stocks = [stockBuy('2023-01-01', 100000)]
    const asOf   = d('2024-01-01')
    const pXirr  = portfolioXirr(stocks, [], [], [], 110000, asOf)
    const sXirr  = stockXirr(stocks, 110000, asOf)
    expect(pXirr).not.toBeNull()
    expect(pXirr!).toBeCloseTo(sXirr!, 6)
  })

  it('blended XIRR lies between per-asset XIRRs for two assets at same horizon', () => {
    // Stocks: 100000 → 110000 (~10% pa), MF: 100000 → 108000 (~8% pa)
    // Blended total: 200000 → 218000 (~9% pa)
    const stocks = [stockBuy('2023-01-01', 100000)]
    const mfs    = [{ trade_date: '2023-01-01', trade_type: 'buy' as const, amount: 100000 }]
    const asOf   = d('2024-01-01')
    const result = portfolioXirr(stocks, mfs, [], [], 218000, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.09, 2)
  })

  it('PPF deposit at 7.1% rate yields ~7.1% XIRR over one year', () => {
    const ppf    = [dep('2023-01-01', 50000)]
    const asOf   = d('2024-01-01')
    const result = portfolioXirr([], [], [], ppf, 50000 * 1.071, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.071, 3)
  })

  it('gold purchase: buy negative, current value positive', () => {
    const sgb  = [{ trade_date: '2023-01-01', trade_type: 'buy' as const, amount: 80000 }]
    const asOf = d('2024-01-01')
    const result = portfolioXirr([], [], sgb, [], 88000, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.10, 2)
  })

  it('returns null when all cashflows are outflows (no sells and zero terminal)', () => {
    const stocks = [stockBuy('2023-01-01', 100000)]
    expect(portfolioXirr(stocks, [], [], [], 0, d('2024-01-01'))).toBeNull()
  })
})
