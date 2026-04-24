// XIRR: Extended IRR that accounts for irregular transaction timing.
// Uses Newton-Raphson iteration.

interface Cashflow {
  date: Date
  amount: number
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

export function xirr(cashflows: Cashflow[], guess = 0.1): number | null {
  if (cashflows.length < 2) return null

  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime())
  const t0 = sorted[0].date.getTime()
  const times   = sorted.map(cf => (cf.date.getTime() - t0) / MS_PER_YEAR)
  const amounts = sorted.map(cf => cf.amount)

  let r = guess
  for (let iter = 0; iter < 200; iter++) {
    let f = 0, df = 0
    for (let i = 0; i < amounts.length; i++) {
      const t      = times[i]
      const factor = Math.pow(1 + r, t)
      f  += amounts[i] / factor
      df -= amounts[i] * t / (factor * (1 + r))
    }
    if (Math.abs(df) < 1e-12) return null
    const delta = f / df
    r -= delta
    if (Math.abs(delta) < 1e-7) return r
  }
  return null
}

// Build XIRR cashflows from MF transactions + notional current value sale today.
// Buys are negative (cash out), sells and current value are positive (cash in).
export function mfXirr(
  transactions: Pick<import('./portfolio-types').MFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function sgbXirr(
  transactions: Pick<import('./portfolio-types').SGBTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function ppfXirr(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentBalance: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'deposit' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentBalance },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

// Month-by-month PPF balance using the real RBI interest rule:
//   - Deposits on or before the 5th earn interest for that month;
//     deposits after the 5th earn from the next month.
//   - Interest accrues monthly but is credited once a year on 31 March.
//   - Accrued-but-not-yet-credited interest is included in the estimate.
export function computePPFBalance(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  asOfDate: Date = new Date()
): number {
  if (transactions.length === 0) return 0

  const RATE = 0.071
  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const first  = new Date(sorted[0].trade_date)

  let balance = 0
  let accrued = 0
  let y = first.getFullYear()
  let m = first.getMonth() // 0-indexed

  while (y < asOfDate.getFullYear() || (y === asOfDate.getFullYear() && m <= asOfDate.getMonth())) {
    // Walk this month's transactions: update running balance and track early deposits
    // (on/before 5th) that qualify for this month's interest.
    let interestBase = balance
    for (const t of sorted) {
      const d = new Date(t.trade_date)
      if (d.getFullYear() !== y || d.getMonth() !== m) continue
      const delta = t.trade_type === 'deposit' ? t.amount : -t.amount
      balance += delta
      if (d.getDate() <= 5) interestBase += delta
    }
    accrued += Math.max(0, interestBase) * (RATE / 12)

    if (m === 2) { // March: credit the year's accumulated interest
      balance += accrued
      accrued = 0
    }

    if (++m > 11) { m = 0; y++ }
  }

  return Math.max(0, balance + accrued)
}

// Stock XIRR: buys are negative (cash out), sells positive (cash in),
// remaining position valued at currentValue on asOfDate.
export function stockXirr(
  transactions: Pick<import('./types').Transaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentValue: number,
  asOfDate: Date = new Date()
): number | null {
  const flows: Cashflow[] = [
    ...transactions.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    { date: asOfDate, amount: currentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

// Portfolio-level XIRR across all asset classes.
// totalCurrentValue must equal the sum of equity + MF + gold + PPF current values
// used in the portfolio summary — consistency between cashflows and terminal value matters.
export function portfolioXirr(
  stockTxns: Pick<import('./types').Transaction, 'trade_date' | 'trade_type' | 'amount'>[],
  mfTxns:    Pick<import('./portfolio-types').MFTransaction,  'trade_date' | 'trade_type' | 'amount'>[],
  sgbTxns:   Pick<import('./portfolio-types').SGBTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  ppfTxns:   Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  totalCurrentValue: number,
  asOfDate: Date = new Date()
): number | null {
  const flows: Cashflow[] = [
    ...stockTxns.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy' ? -t.amount : t.amount })),
    ...mfTxns.map(t   => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy'     ? -t.amount : t.amount })),
    ...sgbTxns.map(t  => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy'     ? -t.amount : t.amount })),
    ...ppfTxns.map(t  => ({ date: new Date(t.trade_date), amount: t.trade_type === 'deposit' ? -t.amount : t.amount })),
    { date: asOfDate, amount: totalCurrentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}
