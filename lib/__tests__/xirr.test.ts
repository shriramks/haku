import { describe, it, expect } from 'vitest'
import { xirr, computePPFBalance, stockXirr, portfolioXirr, epfXirr, oneDayXirr } from '../xirr'

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
// A plain sum of stored rows — interest is never estimated.

describe('computePPFBalance', () => {
  const ppfInterest = (date: string, amount: number) => ({ trade_date: date, trade_type: 'interest' as const, amount })

  it('returns 0 for empty transactions', () => {
    expect(computePPFBalance([])).toBe(0)
  })

  it('deposits alone sum to exactly the deposited amount — no interest is invented', () => {
    expect(computePPFBalance([dep('2016-02-11', 100000), dep('2020-04-01', 150000)])).toBe(250000)
  })

  it('adds interest rows and subtracts withdrawals', () => {
    expect(computePPFBalance([
      dep('2020-01-01', 200000),
      ppfInterest('2020-03-31', 14200),
      withdrawal('2021-01-03', 50000),
    ])).toBe(164200)
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
    expect(portfolioXirr([], [], [], [], [], 0, d('2024-01-01'))).toBeNull()
  })

  it('matches stockXirr for a stock-only portfolio', () => {
    const stocks = [stockBuy('2023-01-01', 100000)]
    const asOf   = d('2024-01-01')
    const pXirr  = portfolioXirr(stocks, [], [], [], [], 110000, asOf)
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
    const result = portfolioXirr(stocks, mfs, [], [], [], 218000, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.09, 2)
  })

  it('PPF deposit at 7.1% rate yields ~7.1% XIRR over one year', () => {
    const ppf    = [dep('2023-01-01', 50000)]
    const asOf   = d('2024-01-01')
    const result = portfolioXirr([], [], [], ppf, [], 50000 * 1.071, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.071, 3)
  })

  it('gold purchase: buy negative, current value positive', () => {
    const sgb  = [{ trade_date: '2023-01-01', trade_type: 'buy' as const, amount: 80000 }]
    const asOf = d('2024-01-01')
    const result = portfolioXirr([], [], sgb, [], [], 88000, asOf)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.10, 2)
  })

  it('returns null when all cashflows are outflows (no sells and zero terminal)', () => {
    const stocks = [stockBuy('2023-01-01', 100000)]
    expect(portfolioXirr(stocks, [], [], [], [], 0, d('2024-01-01'))).toBeNull()
  })
})

// ── epfXirr ───────────────────────────────────────────────────────────────────
// Deposits are the only outflows; interest rows are not cashflows — they are
// already inside the terminal balance.

describe('epfXirr', () => {
  const interest = (date: string, amount: number) => ({ trade_date: date, trade_type: 'interest' as const, amount })

  it('one deposit growing 8% over a year is ~8%', () => {
    const r = epfXirr([dep('2025-01-01', 100_000)], 108_000, d('2026-01-01'))
    expect(r).toBeCloseTo(0.08, 2)
  })

  it('interest rows do not count as outflows — only the terminal balance carries them', () => {
    const withInterest = epfXirr([dep('2025-01-01', 100_000), interest('2025-12-31', 8_000)], 108_000, d('2026-01-01'))
    const without      = epfXirr([dep('2025-01-01', 100_000)], 108_000, d('2026-01-01'))
    expect(withInterest).toBeCloseTo(without!, 10)
  })

  it('a balance missing not-yet-credited interest understates the return', () => {
    const deposits = [dep('2025-04-01', 100_000)]
    const credited = epfXirr(deposits, 100_000, d('2025-10-01'))          // no interest credited yet
    const accrued  = epfXirr(deposits, 100_000 * 1.0413, d('2025-10-01')) // ~6 months at ~8.25%
    expect(credited).toBeCloseTo(0, 2)
    expect(accrued!).toBeGreaterThan(0.08)
  })

  it('returns null with no deposits', () => {
    expect(epfXirr([interest('2025-03-31', 5_000)], 5_000, d('2026-01-01'))).toBeNull()
  })
})

// ── oneDayXirr ────────────────────────────────────────────────────────────────
// Two cashflows exactly 1 day apart, fed through the same xirr() solver as
// everything else — reduces to (today/yesterday)^365.25 − 1 (MS_PER_YEAR uses
// 365.25 days, so the exponent isn't a round 365).

describe('oneDayXirr', () => {
  it('annualises a positive 1D gain', () => {
    const r = oneDayXirr(100_300, 300, d('2026-01-02'))
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(Math.pow(100_300 / 100_000, 365.25) - 1, 6)
  })

  it('annualises a negative 1D gain (loss)', () => {
    const r = oneDayXirr(99_700, -300, d('2026-01-02'))
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(Math.pow(99_700 / 100_000, 365.25) - 1, 6)
    expect(r!).toBeLessThan(0)
  })

  it('returns ~0 for a flat day (no gain)', () => {
    const r = oneDayXirr(100_000, 0, d('2026-01-02'))
    expect(r!).toBeCloseTo(0, 6)
  })

  it('returns null when currentValue is 0 or negative', () => {
    expect(oneDayXirr(0, 0, d('2026-01-02'))).toBeNull()
    expect(oneDayXirr(-100, -50, d('2026-01-02'))).toBeNull()
  })

  it('returns null when the implied 1D loss exceeds the whole portfolio', () => {
    expect(oneDayXirr(100, -500, d('2026-01-02'))).toBeNull()
  })
})
