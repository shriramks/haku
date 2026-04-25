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
  // Interest rows are not cash flows — they're already reflected in currentBalance
  const flows: Cashflow[] = [
    ...transactions
      .filter(t => t.trade_type !== 'interest')
      .map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'deposit' ? -t.amount : t.amount })),
    { date: new Date(), amount: currentBalance },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function epfXirr(
  transactions: Pick<import('./portfolio-types').EPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  currentBalance: number
): number | null {
  const flows: Cashflow[] = [
    ...transactions
      .filter(t => t.trade_type === 'deposit')
      .map(t => ({ date: new Date(t.trade_date), amount: -t.amount })),
    { date: new Date(), amount: currentBalance },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}

export function computeEPFBalance(
  transactions: Pick<import('./portfolio-types').EPFTransaction, 'trade_type' | 'amount'>[]
): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0)
}

// Compute PPF balance from stored transactions.
// If 'interest' rows exist (imported from passbook), sum deposits + interest directly.
// Otherwise fall back to month-by-month rate estimation using the RBI rule:
//   - Deposits on or before the 5th earn interest for that month.
//   - Interest accrues monthly, credited on 31 March each year.
export function computePPFBalance(
  transactions: Pick<import('./portfolio-types').PPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  asOfDate: Date = new Date()
): number {
  if (transactions.length === 0) return 0

  if (transactions.some(t => t.trade_type === 'interest')) {
    return transactions.reduce((sum, t) => {
      if (t.trade_type === 'deposit')    return sum + t.amount
      if (t.trade_type === 'withdrawal') return sum - t.amount
      if (t.trade_type === 'interest')   return sum + t.amount
      return sum
    }, 0)
  }

  // Legacy rate-based fallback (no interest rows stored yet)
  const RATE = 0.071
  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
  const first  = new Date(sorted[0].trade_date)

  let balance = 0
  let accrued = 0
  let y = first.getFullYear()
  let m = first.getMonth()

  while (y < asOfDate.getFullYear() || (y === asOfDate.getFullYear() && m <= asOfDate.getMonth())) {
    let interestBase = balance
    for (const t of sorted) {
      const d = new Date(t.trade_date)
      if (d.getFullYear() !== y || d.getMonth() !== m) continue
      const delta = t.trade_type === 'deposit' ? t.amount : -t.amount
      balance += delta
      if (d.getDate() <= 5) interestBase += delta
    }
    accrued += Math.max(0, interestBase) * (RATE / 12)
    if (m === 2) { balance += accrued; accrued = 0 }
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
  epfTxns:   Pick<import('./portfolio-types').EPFTransaction, 'trade_date' | 'trade_type' | 'amount'>[],
  totalCurrentValue: number,
  asOfDate: Date = new Date()
): number | null {
  const flows: Cashflow[] = [
    ...stockTxns.map(t => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy'     ? -t.amount          : t.amount })),
    ...mfTxns.map(t    => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy'     ? -t.amount          : t.amount })),
    ...sgbTxns.map(t   => ({ date: new Date(t.trade_date), amount: t.trade_type === 'buy'     ? -t.amount          : t.amount })),
    ...ppfTxns
      .filter(t => t.trade_type !== 'interest')
      .map(t             => ({ date: new Date(t.trade_date), amount: t.trade_type === 'deposit' ? -t.amount          : t.amount })),
    ...epfTxns
      .filter(t => t.trade_type === 'deposit')
      .map(t             => ({ date: new Date(t.trade_date), amount: -t.amount })),
    { date: asOfDate, amount: totalCurrentValue },
  ]
  if (!flows.some(f => f.amount > 0) || !flows.some(f => f.amount < 0)) return null
  return xirr(flows)
}
